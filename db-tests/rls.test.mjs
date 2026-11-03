import test from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, fixture, q, asUser, asAnon, istToday, A, B, ADMIN, MANAGER } from './helpers.mjs';

const db = await freshDb();
await fixture(db);
await db.query(`select ingest_punch('DEV1','1',$1::timestamptz,1,'{}'::jsonb,$1::timestamptz)`, [istToday('12:30')]);
await db.query(`select ingest_punch('DEV1','2',$1::timestamptz,1,'{}'::jsonb,$1::timestamptz)`, [istToday('12:35')]);
await db.exec(`insert into disputes (student_id, meal_date, message) values ('${B}', current_date, 'B dispute')`);

const asA = (fn) => asUser(db, A, fn);
const denied = /permission denied|row-level security|Only mess staff|Admin only/;

test('student A sees only their own profile', async () => {
  const rows = await asA(() => q(db, `select id from profiles`));
  assert.deepEqual(rows.map((r) => r.id), [A]);
});

test("student A cannot read B's profile, account, ledger, meal events, punches or disputes", async () => {
  await asA(async () => {
    for (const t of ['profiles where id', 'student_accounts where student_id', 'meal_events where student_id', 'punches where student_id', 'disputes where student_id']) {
      assert.equal((await q(db, `select 1 from ${t} = '${B}'`)).length, 0, t);
    }
    assert.equal((await q(db, `select 1 from refund_ledger l join student_accounts a on a.id = l.student_account_id where a.student_id = '${B}'`)).length, 0);
    assert.ok((await q(db, `select 1 from refund_ledger`)).length >= 2, 'but sees their own ledger');
    assert.equal((await q(db, `select 1 from v_student_balance`)).length, 1);
  });
});

test('student A cannot create a dispute / opt-in for B, but can for self', async () => {
  await asA(async () => {
    await assert.rejects(db.query(`insert into disputes (student_id, meal_date, message) values ($1, current_date, 'x as B')`, [B]), denied);
    await assert.rejects(db.query(`insert into opt_ins values ($1, current_date, (select id from meal_types limit 1), true)`, [B]), denied);
    await db.query(`insert into disputes (student_id, meal_date, message) values ($1, current_date, 'mine')`, [A]);
    await db.query(`insert into meal_ratings values ($1, current_date, (select id from meal_types limit 1), 4)`, [A]);
  });
});

test('student cannot forge a resolved dispute or resolve one', async () => {
  await asA(async () => {
    await assert.rejects(db.query(`insert into disputes (student_id, meal_date, message, status) values ($1, current_date, 'sneaky', 'approved')`, [A]), denied);
    await assert.rejects(db.query(`update disputes set status = 'approved' where student_id = $1`, [A]), denied);
    await assert.rejects(db.query(`select resolve_dispute(gen_random_uuid(), true, 'nope')`), denied);
  });
});

test('student cannot write the ledger, escalate role, change roll number, or call ingest_punch', async () => {
  await asA(async () => {
    await assert.rejects(db.query(`insert into refund_ledger (student_account_id, entry_type, amount_paise) select id, 'manual_adjustment', 999999 from student_accounts`), denied);
    await assert.rejects(db.query(`update profiles set role = 'admin' where id = $1`, [A]), denied);
    await assert.rejects(db.query(`select ingest_punch('DEV1','1',now())`), denied);
    await assert.rejects(db.query(`insert into meal_events (student_id, semester_id, meal_type_id, meal_date, eaten_at, rate_paise)
       select $1, id, (select id from meal_types limit 1), current_date, now(), 0 from semesters`, [A]), denied);
    await assert.rejects(db.query(`update profiles set roll_no = 'HACK' where id = $1`, [A]), /roll_no can only be changed/);
    assert.equal((await q(db, `select 1 from audit_log`)).length, 0);
    await db.query(`update profiles set hostel = 'Hostel Z' where id = $1`, [A]); // allowed column
  });
});

test('student cannot edit rates / windows / semesters', async () => {
  await asA(async () => {
    assert.equal((await db.query(`update meal_rates set rate_paise = 1`)).affectedRows, 0);
    await assert.rejects(db.query(`insert into semesters (name, starts_on, ends_on) values ('x', current_date, current_date + 1)`), denied);
  });
});

test('anonymous users read nothing', async () => {
  await asAnon(db, async () => {
    await assert.rejects(db.query(`select 1 from profiles`), denied);
    await assert.rejects(db.query(`select 1 from refund_ledger`), denied);
  });
});

test('manager sees operational data but NOT money', async () => {
  await asUser(db, MANAGER, async () => {
    assert.ok((await q(db, `select 1 from profiles`)).length >= 4);
    assert.ok((await q(db, `select 1 from punches`)).length >= 2);
    assert.ok((await q(db, `select 1 from disputes`)).length >= 1);
    assert.equal((await q(db, `select 1 from refund_ledger`)).length, 0);
    assert.equal((await q(db, `select 1 from student_accounts`)).length, 0);
    assert.equal((await q(db, `select 1 from v_student_balance`)).length, 0);
    assert.equal((await q(db, `select 1 from audit_log`)).length, 0);
    assert.equal((await db.query(`update meal_rates set rate_paise = 1`)).affectedRows, 0);
    await assert.rejects(db.query(`select approve_refund(gen_random_uuid())`), denied);
  });
});

test('admin sees everything and rate changes are audited', async () => {
  await asUser(db, ADMIN, async () => {
    assert.ok((await q(db, `select 1 from refund_ledger`)).length >= 4);
    assert.equal((await q(db, `select 1 from v_student_balance`)).length, 2);
    await db.query(`update meal_rates set rate_paise = rate_paise + 100 where meal_type_id = (select id from meal_types where code='lunch')`);
    assert.ok((await q(db, `select 1 from audit_log where entity = 'meal_rates'`)).length >= 1);
  });
});

test('sign-up is restricted to the configured email domain', async () => {
  await assert.rejects(db.exec(`insert into auth.users (id, email) values (gen_random_uuid(), 'x@gmail.com')`), /restricted/);
  await db.exec(`insert into auth.users (id, email) values (gen_random_uuid(), 'ok@mnit.ac.in')`);
});
