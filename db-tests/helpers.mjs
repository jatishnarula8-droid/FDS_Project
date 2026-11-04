// Runs the REAL migrations against an in-process Postgres (PGlite) with a tiny Supabase stub
// (roles, auth.uid(), auth.users). No Docker needed. `npm run test:db` from the repo root.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase');

const STUB = `
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema auth; create schema extensions;
create table auth.users (instance_id uuid, id uuid primary key default gen_random_uuid(), aud text, role text, email text,
  encrypted_password text, email_confirmed_at timestamptz, raw_app_meta_data jsonb, raw_user_meta_data jsonb,
  created_at timestamptz, updated_at timestamptz, confirmation_token text, recovery_token text,
  email_change_token_new text, email_change text);
create table auth.identities (id uuid primary key, user_id uuid, provider_id text, identity_data jsonb, provider text,
  last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function extensions.crypt(text, text) returns text language sql as $$ select $1 $$;
create function extensions.gen_salt(text) returns text language sql as $$ select 'x' $$;
grant usage on schema auth, extensions to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
`;

export async function freshDb({ seed = false } = {}) {
  const db = new PGlite();
  await db.exec(STUB);
  for (const f of readdirSync(join(root, 'migrations')).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(root, 'migrations', f), 'utf8'));
  }
  if (seed) await db.exec(readFileSync(join(root, 'seed.sql'), 'utf8'));
  return db;
}

/** Run fn with Postgres role `authenticated` and auth.uid() = uid (like a Supabase JWT). */
export async function asUser(db, uid, fn) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`);
  try { return await fn(); }
  finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
}
export async function asAnon(db, fn) {
  await db.exec(`set role anon;`);
  try { return await fn(); } finally { await db.exec(`reset role;`); }
}

export const q = async (db, sql, params) => (await db.query(sql, params)).rows;
export const one = async (db, sql, params) => (await q(db, sql, params))[0];

/** Minimal deterministic fixture: active semester, 4 meals, rates, 1 device, admin, manager, students A & B. */
export async function fixture(db) {
  await db.exec(`
    insert into semesters (name, starts_on, ends_on, is_active) values ('T', current_date - 20, current_date + 60, true);
    -- meal types and windows come from migration 0007
    insert into meal_rates (semester_id, meal_type_id, rate_paise)
      select (select id from semesters), id, case code when 'lunch' then 6500 when 'dinner' then 6500 when 'breakfast' then 3000 else 2000 end from meal_types;
    insert into devices (name, device_serial) values ('Test Dev', 'DEV1');
    insert into auth.users (id, email, raw_user_meta_data) values
      ('00000000-0000-0000-0000-0000000000a1', 'admin@mnit.ac.in',   '{"full_name":"Admin"}'),
      ('00000000-0000-0000-0000-0000000000b1', 'manager@mnit.ac.in', '{"full_name":"Manager"}'),
      ('00000000-0000-0000-0000-00000000000a', 'a@mnit.ac.in', '{"full_name":"Student A","roll_no":"R-A"}'),
      ('00000000-0000-0000-0000-00000000000b', 'b@mnit.ac.in', '{"full_name":"Student B","roll_no":"R-B"}');
  `);
  await db.exec(`
    update profiles set role='admin'   where id = '00000000-0000-0000-0000-0000000000a1';
    update profiles set role='manager' where id = '00000000-0000-0000-0000-0000000000b1';
    insert into student_accounts (student_id, semester_id, amount_paid_paise)
      select id, (select id from semesters), 100000 from profiles where role = 'student';
    insert into device_users (student_id, device_id, device_user_id) values
      ('00000000-0000-0000-0000-00000000000a', null, '1'), ('00000000-0000-0000-0000-00000000000b', null, '2');
  `);
}
export const A = '00000000-0000-0000-0000-00000000000a';
export const B = '00000000-0000-0000-0000-00000000000b';
export const ADMIN = '00000000-0000-0000-0000-0000000000a1';
export const MANAGER = '00000000-0000-0000-0000-0000000000b1';

/** ISO timestamp for today (IST) at HH:MM. */
export function istToday(hhmm) {
  const d = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  return `${d}T${hhmm}:00+05:30`;
}
