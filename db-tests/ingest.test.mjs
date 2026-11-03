import test from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, fixture, q, one, istToday, A, B, ADMIN, MANAGER, asUser } from './helpers.mjs';

const db = await freshDb();
await fixture(db);

const ingest = (serial, pin, at, received) =>
  one(db, `select ingest_punch($1, $2, $3::timestamptz, 1, '{}'::jsonb, coalesce($4::timestamptz, $3::timestamptz)) as r`,
      [serial, pin, at, received ?? null]).then((x) => x.r);
const balance = async (student) =>
  (await one(db, `select balance_paise from v_student_balance where student_id = $1`, [student])).balance_paise;

test('matched: records meal and deducts the rate', async () => {
  const r = await ingest('DEV1', '1', istToday('12:30'));
  assert.equal(r.status, 'matched');
  assert.equal(r.charged_paise, 6500);
  assert.equal(await balance(A), 100000 - 6500);
  const ev = await q(db, `select * from meal_events where student_id = $1`, [A]);
  assert.equal(ev.length, 1);
  const led = await q(db, `select entry_type, amount_paise from refund_ledger l join student_accounts a on a.id = l.student_account_id
                           where a.student_id = $1`, [A]);
  assert.deepEqual(led.map((x) => [x.entry_type, x.amount_paise]).sort(), [['meal_deduction', -6500], ['opening', 100000]]);
});

test('duplicate: second punch in the same meal is not charged', async () => {
  const r = await ingest('DEV1', '1', istToday('13:10'));
  assert.equal(r.status, 'duplicate');
  assert.equal(await balance(A), 100000 - 6500);
  assert.equal((await q(db, `select 1 from meal_events where student_id = $1`, [A])).length, 1);
});

test('different meal on the same day is charged separately', async () => {
  const r = await ingest('DEV1', '1', istToday('20:00'));
  assert.equal(r.status, 'matched');
  assert.equal(await balance(A), 100000 - 13000);
});

test('unmatched: unknown PIN', async () => {
  const before = (await q(db, `select 1 from meal_events`)).length;
  const r = await ingest('DEV1', '4242', istToday('12:31'));
  assert.equal(r.status, 'unmatched');
  assert.equal((await q(db, `select 1 from meal_events`)).length, before);
});

test('outside_window: punch between meals', async () => {
  const r = await ingest('DEV1', '2', istToday('16:00'));
  assert.equal(r.status, 'outside_window');
  assert.equal(await balance(B), 100000);
});

test('meal window is evaluated in Asia/Kolkata, not UTC', async () => {
  // 12:30 IST is 07:00 UTC; a UTC-based check would not find lunch.
  const r = await ingest('DEV1', '2', '2030-01-01T12:30:00+05:30');
  assert.ok(r.meal_type_id, 'lunch window found using IST');
});

test('idempotent resend: identical punch is replayed, nothing changes', async () => {
  const at = istToday('08:15');
  const first = await ingest('DEV1', '2', at);
  assert.equal(first.status, 'matched');
  const bal = await balance(B);
  const again = await ingest('DEV1', '2', at);
  assert.equal(again.replayed, true);
  assert.equal(again.status, 'matched');
  assert.equal(await balance(B), bal);
  assert.equal((await q(db, `select 1 from punches where device_user_id = '2' and punched_at = $1::timestamptz`, [at])).length, 1);
});

test('clock skew over 10 minutes is flagged for review but still processed', async () => {
  const r = await ingest('DEV1', '2', istToday('17:30'), new Date(Date.now() + 3600e3 * 5).toISOString());
  assert.equal(r.needs_review, true);
  assert.equal(r.status, 'matched');
});

test('unknown device is rejected and stores nothing', async () => {
  const before = (await q(db, `select 1 from punches`)).length;
  const r = await ingest('NOPE', '1', istToday('12:40'));
  assert.equal(r.status, 'rejected');
  assert.equal((await q(db, `select 1 from punches`)).length, before);
});

test('balance_exhausted: deduction is capped and balance never goes below 0', async () => {
  await db.exec(`
    insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-00000000000c', 'c@mnit.ac.in', '{"full_name":"C","roll_no":"R-C"}');
    insert into student_accounts (student_id, semester_id, amount_paid_paise)
      values ('00000000-0000-0000-0000-00000000000c', (select id from semesters), 3000);
    insert into device_users (student_id, device_id, device_user_id) values ('00000000-0000-0000-0000-00000000000c', null, '3');`);
  const C = '00000000-0000-0000-0000-00000000000c';
  const r = await ingest('DEV1', '3', istToday('12:30'));
  assert.equal(r.status, 'matched');
  assert.equal(r.charged_paise, 3000);
  assert.equal(r.reason, 'balance_exhausted');
  assert.equal(await balance(C), 0);
  const r2 = await ingest('DEV1', '3', istToday('20:00'));
  assert.equal(r2.charged_paise, 0);
  assert.equal(await balance(C), 0);
});

test('ledger is append-only (update, delete, truncate all fail)', async () => {
  await assert.rejects(db.exec(`update refund_ledger set amount_paise = 0`), /append-only/);
  await assert.rejects(db.exec(`delete from refund_ledger`), /append-only/);
  await assert.rejects(db.exec(`truncate refund_ledger`), /append-only/);
});

test('approving a missing-punch dispute creates the meal event + deduction and an audit row', async () => {
  const day = istToday('00:00').slice(0, 10);
  // B already has snacks today (17:30 punch above): approval must refuse rather than double-charge
  const dup = await one(db, `insert into disputes (student_id, kind, meal_date, meal_type_id, message)
     values ($1, 'missing_punch', $2, (select id from meal_types where code='snacks'), 'machine failed') returning id`, [B, day]);
  await asUser(db, MANAGER, async () => {
    await assert.rejects(db.query(`select resolve_dispute($1, true, 'already ate that day')`, [dup.id]), /duplicate|Cannot create/);
  });
  const d2 = await one(db, `insert into disputes (student_id, kind, meal_date, meal_type_id, message)
     values ($1, 'missing_punch', $2::date - 1, (select id from meal_types where code='dinner'), 'forgot to punch') returning id`, [B, day]);
  const before = await balance(B);
  await asUser(db, MANAGER, () => db.query(`select resolve_dispute($1, true, 'verified with cook')`, [d2.id]));
  assert.equal(await balance(B), before - 6500);
  const ev = await one(db, `select source from meal_events where student_id = $1 and source = 'dispute'`, [B]);
  assert.equal(ev.source, 'dispute');
  assert.equal((await one(db, `select count(*)::int n from audit_log where action = 'dispute_approved'`)).n, 1);
});

test('approving a wrong-charge dispute credits the amount exactly once', async () => {
  const ev = await one(db, `select meal_date, meal_type_id from meal_events where student_id = $1 and source = 'punch' limit 1`, [A]);
  const d = await one(db, `insert into disputes (student_id, kind, meal_date, meal_type_id, message)
     values ($1, 'wrong_charge', $2, $3, 'I was away') returning id`, [A, ev.meal_date, ev.meal_type_id]);
  const before = await balance(A);
  await asUser(db, MANAGER, () => db.query(`select resolve_dispute($1, true, 'confirmed absent')`, [d.id]));
  assert.ok((await balance(A)) > before);
  await asUser(db, MANAGER, async () => {
    await assert.rejects(db.query(`select resolve_dispute($1, true, 'again')`, [d.id]), /already resolved/);
  });
});

test('semester close creates PROPOSALS; only admin approves; approval writes refund_paid', async () => {
  const sem = (await one(db, `select id from semesters`)).id;
  await asUser(db, MANAGER, async () => {
    await assert.rejects(db.query(`select close_semester($1)`, [sem]), /permission denied|Admin only/);
  });
  const n = await asUser(db, ADMIN, async () => (await one(db, `select close_semester($1) n`, [sem])).n);
  assert.ok(n >= 3);
  const p = await one(db, `select r.id, r.proposed_paise from refund_proposals r join student_accounts a on a.id = r.student_account_id where a.student_id = $1`, [A]);
  const bal = await balance(A);
  assert.equal(p.proposed_paise, bal);
  assert.equal((await q(db, `select 1 from refund_ledger where entry_type = 'refund_paid'`)).length, 0, 'nothing paid before approval');
  await asUser(db, MANAGER, async () => { await assert.rejects(db.query(`select approve_refund($1)`, [p.id]), /Admin only/); });
  await asUser(db, ADMIN, () => db.query(`select approve_refund($1)`, [p.id]));
  assert.equal(await balance(A), 0);
  assert.equal((await q(db, `select 1 from refund_ledger where entry_type = 'refund_paid'`)).length, 1);
  await asUser(db, ADMIN, async () => { await assert.rejects(db.query(`select approve_refund($1)`, [p.id]), /already approved/); });
});
