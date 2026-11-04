import test from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, fixture, q, one, asUser, istToday, A, B, ADMIN, MANAGER } from './helpers.mjs';

const db = await freshDb();
await fixture(db);

const ALL = { breakfast: true, lunch: true, snacks: false, dinner: true };
const plan = (student, choices, nowIso) =>
  one(db, `select _set_meal_plan($1, $2::jsonb, $3::timestamptz) r`, [student, JSON.stringify(choices), nowIso]).then((x) => x.r);
const day = istToday('00:00').slice(0, 10);
const noon = istToday('12:00'), night = istToday('21:00');
const tomorrow = new Date(Date.parse(day) + 86400e3).toISOString().slice(0, 10);
const balance = async (s) => (await one(db, `select balance_paise from v_student_balance where student_id = $1`, [s])).balance_paise;

test('planning tomorrow before the cutoff issues one pass per chosen meal', async () => {
  const r = await plan(A, ALL, noon);
  assert.equal(r.meals, 3);
  assert.equal(r.meal_date.slice(0, 10), tomorrow);
  const passes = await q(db, `select status from meal_passes where student_id = $1`, [A]);
  assert.equal(passes.length, 3);
});

test('after the cutoff planning is refused', async () => {
  await assert.rejects(plan(B, ALL, night), /closed at 18:00/);
  assert.equal((await q(db, `select 1 from meal_passes where student_id = $1`, [B])).length, 0);
});

test('every meal must be answered', async () => {
  await assert.rejects(plan(B, { breakfast: true, lunch: true }, noon), /every meal/);
});

test('changing your mind cancels the pass and re-opting restores the same QR', async () => {
  const before = await one(db, `select token from meal_passes p join meal_types t on t.id = p.meal_type_id where student_id = $1 and t.code = 'lunch'`, [A]);
  await plan(A, { ...ALL, lunch: false }, noon);
  assert.equal((await one(db, `select status from meal_passes p join meal_types t on t.id = p.meal_type_id where student_id = $1 and t.code = 'lunch'`, [A])).status, 'cancelled');
  await plan(A, ALL, noon);
  const after = await one(db, `select token, status from meal_passes p join meal_types t on t.id = p.meal_type_id where student_id = $1 and t.code = 'lunch'`, [A]);
  assert.equal(after.status, 'issued'); assert.equal(after.token, before.token);
});

test('students cannot write opt-ins directly or plan via the internal function', async () => {
  await asUser(db, A, async () => {
    await assert.rejects(db.query(`insert into opt_ins values ($1, current_date, (select id from meal_types limit 1), true)`, [A]), /permission denied/);
    await assert.rejects(db.query(`select _set_meal_plan($1, '{}'::jsonb, now())`, [A]), /permission denied/);
    await assert.rejects(db.query(`select _redeem_pass('x', $1, now())`, [A]), /permission denied/);
  });
});

// Passes for "today": build them directly (planning only ever targets tomorrow).
async function todayPass(student, mealCode) {
  const r = await one(db, `insert into meal_passes (student_id, meal_date, meal_type_id) values ($1, $2, (select id from meal_types where code = $3)) returning token`, [student, day, mealCode]);
  return r.token;
}

test('scanning a pass serves the meal: charges the rate, marks used, staff see no balance', async () => {
  const tok = await todayPass(A, 'lunch');
  const before = await balance(A);
  const r = await asUser(db, MANAGER, async () => (await one(db, `select redeem_pass($1) r`, ['MESS:' + tok])).r);
  assert.equal(r.ok, true); assert.equal(r.meal, 'Lunch'); assert.equal(r.student_name, 'Student A');
  assert.equal('balance' in r || 'balance_paise' in r, false);
  assert.equal(await balance(A), before - 6500);
  const ev = await one(db, `select source from meal_events where student_id = $1 and meal_date = $2`, [A, day]);
  assert.equal(ev.source, 'qr');
});

test('the same QR cannot be used twice', async () => {
  const tok = (await one(db, `select token from meal_passes where student_id = $1 and status = 'redeemed'`, [A])).token;
  const before = await balance(A);
  await asUser(db, MANAGER, async () => { await assert.rejects(db.query(`select redeem_pass($1)`, [tok]), /already used/); });
  assert.equal(await balance(A), before);
});

test('students cannot scan; random codes and wrong-day passes are refused', async () => {
  await asUser(db, A, async () => { await assert.rejects(db.query(`select redeem_pass('x')`), /permission denied|Only mess staff/); });
  await asUser(db, MANAGER, async () => { await assert.rejects(db.query(`select redeem_pass('MESS:not-a-real-code')`), /Unknown QR/); });
  const tok = (await one(db, `insert into meal_passes (student_id, meal_date, meal_type_id) values ($1, $2, (select id from meal_types where code='snacks')) returning token`, [B, tomorrow])).token;
  await asUser(db, MANAGER, async () => { await assert.rejects(db.query(`select redeem_pass($1)`, [tok]), /not today/); });
});

test('a cancelled pass is refused', async () => {
  const tok = (await one(db, `select token from meal_passes p join meal_types t on t.id = p.meal_type_id where student_id = $1 and t.code = 'dinner'`, [A])).token;
  await db.exec(`update meal_passes set status = 'cancelled' where token = '${tok}'`);
  await asUser(db, MANAGER, async () => { await assert.rejects(db.query(`select redeem_pass($1)`, [tok]), /cancelled/); });
});

test('a meal already recorded by fingerprint is not charged again by QR', async () => {
  await db.query(`select ingest_punch('DEV1','2',$1::timestamptz,1,'{}'::jsonb,$1::timestamptz)`, [istToday('08:30')]); // B breakfast
  const tok = await todayPass(B, 'breakfast');
  const before = await balance(B);
  await asUser(db, MANAGER, async () => { await assert.rejects(db.query(`select redeem_pass($1)`, [tok]), /already recorded/); });
  assert.equal(await balance(B), before);
});

test('no balance, no meal', async () => {
  await db.exec(`insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-00000000000d','d@mnit.ac.in','{"full_name":"D","roll_no":"R-D"}');
    insert into student_accounts (student_id, semester_id, amount_paid_paise) values ('00000000-0000-0000-0000-00000000000d', (select id from semesters), 0);`);
  const tok = await todayPass('00000000-0000-0000-0000-00000000000d', 'dinner');
  await asUser(db, MANAGER, async () => { await assert.rejects(db.query(`select redeem_pass($1)`, [tok]), /No balance left/); });
});

test('students see only their own passes', async () => {
  await asUser(db, A, async () => {
    const rows = await q(db, `select student_id from meal_passes`);
    assert.ok(rows.length > 0); assert.ok(rows.every((r) => r.student_id === A));
  });
  await asUser(db, MANAGER, async () => { assert.equal((await q(db, `select 1 from meal_passes`)).length, 0); });
});

test('admin can correct the fee paid; the balance follows via the ledger', async () => {
  const sem = (await one(db, `select id from semesters`)).id;
  const before = await balance(B);
  await asUser(db, ADMIN, () => db.query(`select set_student_fee($1, $2, 150000)`, [B, sem]));
  assert.equal(await balance(B), before + 50000); // was 100000 paid
  assert.equal((await one(db, `select amount_paid_paise from student_accounts where student_id = $1`, [B])).amount_paid_paise, 150000);
});
