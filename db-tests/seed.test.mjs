import test from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, one, q } from './helpers.mjs';

test('seed.sql loads: 30 students, devices, two weeks of punches, balances non-negative', { timeout: 280000 }, async () => {
  const db = await freshDb({ seed: true });
  assert.equal((await one(db, `select count(*)::int n from profiles where role='student'`)).n, 30);
  assert.equal((await one(db, `select count(*)::int n from devices`)).n, 2);
  assert.ok((await one(db, `select count(*)::int n from punches`)).n > 1000);
  const st = await q(db, `select status, count(*)::int n from punches group by 1`);
  for (const s of ['matched', 'unmatched', 'duplicate', 'outside_window']) assert.ok(st.find((x) => x.status === s), s);
  assert.equal((await one(db, `select count(*)::int n from v_student_balance where balance_paise < 0`)).n, 0);
  const poor = await one(db, `select balance_paise from v_student_balance b join profiles p on p.id=b.student_id where roll_no='2023UCP1030'`);
  assert.equal(poor.balance_paise, 0, 'student 30 exhausted their small balance');
  assert.equal((await one(db, `select count(*)::int n from disputes where status='open'`)).n, 2);
});
