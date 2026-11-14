// End-to-end smoke test WITHOUT Supabase/Docker/Deno:
//   mock bridge  --HTTP-->  local stand-in for the edge function  -->  real ingest_punch() in PGlite (seeded)
// The stand-in mirrors supabase/functions/ingest-punches/index.ts (secret check + per-punch results).
// Run: npm --prefix db-tests run e2e
import http from 'node:http';
import { spawn } from 'node:child_process';
import { freshDb, q, one } from './helpers.mjs';

const SECRET = 'e2e-secret-value';
const db = await freshDb({ seed: true });
const before = await one(db, `select count(*)::int n from punches`);

const server = http.createServer(async (req, res) => {
  if (req.headers['x-device-secret'] !== SECRET) { res.writeHead(401).end('{"error":"unauthorized"}'); return; }
  let body = ''; for await (const c of req) body += c;
  const { punches } = JSON.parse(body);
  const results = [];
  for (const [index, p] of punches.entries()) {
    const r = await one(db, `select ingest_punch($1,$2,$3::timestamptz,$4,$5::jsonb,now()) r`,
      [p.device_serial, p.device_user_id, p.punched_at, p.verify_mode ?? null, JSON.stringify(p.raw ?? {})]);
    results.push({ index, ...r.r });
  }
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ results }));
}).listen(0);
await new Promise((r) => server.once('listening', r));
const port = server.address().port;

const student = await one(db, `select p.id, b.balance_paise from profiles p join v_student_balance b on b.student_id = p.id where roll_no = '2023UCP1001'`);

const bridge = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
  cwd: new URL('../bridge', import.meta.url),
  env: { ...process.env, ADAPTER: 'mock', INGEST_URL: `http://localhost:${port}/ingest`, DEVICE_INGEST_SECRET: SECRET,
         DEVICES: '[]',
         MOCK_INTERVAL_SECONDS: '0.5', MOCK_MEAL_TIME: process.env.MOCK_MEAL_TIME ?? '12:30', MOCK_FIRST_PIN: '1001', MOCK_LAST_PIN: '1003',
         DATA_DIR: `./data-e2e-${Date.now()}` },
  stdio: ['ignore', 'pipe', 'inherit'],
});
bridge.stdout.on('data', (d) => process.stdout.write(d));
await new Promise((r) => setTimeout(r, 12000));
bridge.kill();
server.close();

const st = await q(db, `select status, count(*)::int n from punches group by 1 order by 1`);
const after = await one(db, `select count(*)::int n from punches`);
console.log('\npunch statuses overall:', Object.fromEntries(st.map((s) => [s.status, s.n])));
console.log(`new punches received via bridge: ${after.n - before.n}`);
const bal = await one(db, `select balance_paise from v_student_balance where student_id = $1`, [student.id]);
console.log(`student 1001 balance: ${student.balance_paise} -> ${bal.balance_paise} paise`);
const dupes = await one(db, `select count(*)::int n from (select student_id, meal_date, meal_type_id from meal_events group by 1,2,3 having count(*) > 1) x`);
if (after.n - before.n < 3 || dupes.n !== 0) { console.error('E2E FAILED'); process.exit(1); }
console.log('E2E OK: punches ingested, no double charges.');
process.exit(0);
