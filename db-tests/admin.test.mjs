import test from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, fixture, q, one, asUser, A, B, ADMIN, MANAGER } from './helpers.mjs';

const db = await freshDb();
await fixture(db);
const balance = async (s) => (await one(db, `select balance_paise from v_student_balance where student_id = $1`, [s])).balance_paise;

test('profile keeps name, roll no, email and phone from sign-up', async () => {
  await db.exec(`insert into auth.users (id, email, raw_user_meta_data) values
    ('00000000-0000-0000-0000-0000000000e1', 'e@mnit.ac.in', '{"full_name":"Eve","roll_no":"R-E","phone":"9876543210"}')`);
  const p = await one(db, `select full_name, roll_no, email, phone from profiles where id = '00000000-0000-0000-0000-0000000000e1'`);
  assert.deepEqual(p, { full_name: 'Eve', roll_no: 'R-E', email: 'e@mnit.ac.in', phone: '9876543210' });
});

test('a student can change their own phone but not their email', async () => {
  await asUser(db, A, async () => {
    await db.query(`update profiles set phone = '9000000001' where id = $1`, [A]);
    await assert.rejects(db.query(`update profiles set email = 'x@y.z' where id = $1`, [A]), /permission denied/);
  });
  assert.equal((await one(db, `select phone from profiles where id = $1`, [A])).phone, '9000000001');
});

test('admin sets money left; ledger records the difference and stays append-only', async () => {
  const before = await balance(A); // 100000
  await asUser(db, ADMIN, () => db.query(`select set_money_left($1, 55000, 'Cash correction')`, [A]));
  assert.equal(await balance(A), 55000);
  const last = await one(db, `select entry_type, amount_paise, reason from refund_ledger l join student_accounts a on a.id = l.student_account_id where a.student_id = $1 order by l.created_at desc, l.amount_paise limit 1`, [A]);
  assert.equal(last.entry_type, 'manual_adjustment'); assert.equal(last.amount_paise, 55000 - before);
  assert.ok((await one(db, `select count(*)::int n from audit_log where action = 'set_money_left'`)).n >= 1);
  await assert.rejects(db.exec(`delete from refund_ledger`), /append-only/);
});

test('setting money left for a student with no account creates it', async () => {
  await asUser(db, ADMIN, () => db.query(`select set_money_left('00000000-0000-0000-0000-0000000000e1', 120000)`));
  assert.equal(await balance('00000000-0000-0000-0000-0000000000e1'), 120000);
});

test('only the admin can set money left; negatives are refused', async () => {
  await asUser(db, MANAGER, async () => { await assert.rejects(db.query(`select set_money_left($1, 1)`, [B]), /Admin only/); });
  await asUser(db, B, async () => { await assert.rejects(db.query(`select set_money_left($1, 99999999)`, [B]), /Admin only/); });
  await asUser(db, ADMIN, async () => { await assert.rejects(db.query(`select set_money_left($1, -5)`, [B]), /negative/); });
  assert.equal(await balance(B), 100000);
});
