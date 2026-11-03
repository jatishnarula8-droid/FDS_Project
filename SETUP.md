# SETUP — step by step (for a beginner)

You will: create a free Supabase project, load the database, deploy one function, run the website and run the "bridge" in **mock mode** to prove everything works without any fingerprint machine. Plan ~45 minutes.

**You need:** Node.js 20+ ([nodejs.org](https://nodejs.org)), a free [supabase.com](https://supabase.com) account, and this folder.

> **Demo data warning.** `supabase/seed.sql` creates fake students and demo logins with the password `demo1234`. Use it on a throw-away/demo project. For production, skip the seed and enter real data (see "Going live" below).

---

## 1. Create the Supabase project and copy your keys

1. At supabase.com click **New project**. Pick a name, a strong database password (save it) and the region nearest to you (e.g. *Mumbai*).
2. When it is ready open **Project Settings → API**. Note three things:
   - **Project URL** (looks like `https://abcdxyz.supabase.co`) — the part before `.supabase.co` is your **project ref**.
   - **anon public** key.
   - **service_role** key (secret!). Never put it in a website or commit it.
3. Create your env files from the examples and paste the values over the `YOUR_...` placeholders:

   ```bash
   cp web/.env.example web/.env.local      # Windows PowerShell: Copy-Item web\.env.example web\.env.local
   cp bridge/.env.example bridge/.env
   ```
   - `web/.env.local` → `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`. (The service-role key is **not needed** by the current web app; you can leave it.)
   - `bridge/.env` → `INGEST_URL=https://<project-ref>.supabase.co/functions/v1/ingest-punches`, and `DEVICE_INGEST_SECRET` (make up a long random string, e.g. run `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`). Remember it for step 5.

`.env*` files are git-ignored. Never commit real keys.

## 2. Install the Supabase CLI and link the project

```bash
npm i -g supabase
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

## 3. Create the tables and load the demo data

```bash
supabase db push
```
This applies `supabase/migrations/0001…0003` (tables, business rules, security policies).

Then load the seed. Easiest is the dashboard: **SQL Editor → New query**, paste the whole of `supabase/seed.sql`, **Run** (takes ~20 s; it creates 30 students, 2 machines, 2 weeks of punches). Or with the CLI: `supabase db push --include-seed`.

> **If the seed errors with `extensions.crypt does not exist`:** in the SQL editor run `create extension if not exists pgcrypto with schema extensions;` and re-run.
> **If it errors that sign-ups are restricted:** the demo emails end in `@mnit.ac.in`; the allowed domain is set in step 4.

## 4. Authentication

1. **Authentication → Providers →** make sure **Email** is enabled. For a quick demo, under *Authentication → Sign In / Providers → Email* you may turn off "Confirm email" so new accounts can sign in immediately.
2. **Authentication → URL Configuration:** set *Site URL* to `http://localhost:3000` (your real URL later) and add `http://localhost:3000/auth/callback` to *Redirect URLs*.
3. **College-domain restriction** is enforced in the database (a trigger on sign-up that checks the email domain). The placeholder is `mnit.ac.in` — **confirm with the institute**, then change it if needed:
   ```sql
   update app_settings set value = 'mnit.ac.in' where key = 'allowed_email_domain';
   -- value '*' switches the check off
   ```
4. **Create the first admin.** If you loaded the seed, `admin@mnit.ac.in` / `demo1234` already exists. For a real admin: sign up through the website, then run in the SQL editor:
   ```sql
   update profiles set role = 'admin'
   where id = (select id from auth.users where email = 'YOUR_EMAIL@mnit.ac.in');
   ```
   (If your own email is not on the college domain, temporarily set `allowed_email_domain` to `*` to sign up, then set it back.) Mess managers: same snippet with `role = 'manager'`; or log in as admin and use `select set_user_role('<user uuid>', 'manager')`.

## 5. Deploy the ingest function

```bash
supabase functions deploy ingest-punches --no-verify-jwt
supabase secrets set DEVICE_INGEST_SECRET=PASTE_THE_SAME_SECRET_AS_IN_bridge/.env
```
`--no-verify-jwt` is intentional: the bridge authenticates with the `x-device-secret` header instead of a user login (also pinned in `supabase/config.toml`).

## 6. Enable Realtime (live punch feed)

The migration already adds `punches` and `meal_events` to the `supabase_realtime` publication. Verify at **Database → Replication → supabase_realtime** — both tables should be ticked. If not, tick them.

## 7. Run it and verify end-to-end

Terminal 1 — the website:
```bash
cd web && npm install && npm run dev        # http://localhost:3000
```
Terminal 2 — the bridge in mock mode (fake punches every ~4 s):
```bash
cd bridge && npm install && npm run mock
```
(or from the repo root: `npm run bridge:mock`). Meals only count inside a meal window (IST). If you test outside meal hours, start the bridge with a time inside a window: `MOCK_MEAL_TIME=12:30 npm run mock` (PowerShell: `$env:MOCK_MEAL_TIME="12:30"; npm run mock`). Such punches are flagged "Check clock" — that is the 10-minute clock-skew safeguard working.

Check these three things:

| Check | How | Expected |
|---|---|---|
| **Punch appears live** | Log in as `manager@mnit.ac.in` / `demo1234` → **Live** | New rows pop in without refreshing; statuses *Matched / Duplicate / Unmatched* |
| **Balance drops** | Log in as `student01@mnit.ac.in` in a private window → **Wallet** (note the balance), wait for a *Matched* punch for ID 1001, refresh | Balance fell by that meal's rate (e.g. ₹65.00) and the meal shows in **Meal log** |
| **Repeat = duplicate** | In the feed, a second punch by the same person in the same meal | Marked **Duplicate**, balance unchanged |

Handy logins (password `demo1234`): `admin@mnit.ac.in`, `manager@mnit.ac.in`, `student01@mnit.ac.in` … `student30@mnit.ac.in`. Student 30 has a tiny balance to demo the "balance exhausted" cap.

You can also run the database and bridge tests without Supabase: `npm run test:db`, `npm run test:bridge`, and the in-process demo `npm --prefix db-tests run e2e`.

## 8. Going live with real eSSL machines — checklist

See **`bridge/README.md` → "Hardware test checklist"** for the full list. In short:

1. Give each machine a **static IP** (router DHCP reservation or the machine's network menu). Note its **serial number** (machine menu → Device Info).
2. Choose the mode your model supports: **push / ADMS (Cloud Server)** or **pull (TCP 4370)**.
3. In the web app (Admin → Setup) add each machine with its exact serial; remove/disable the `MOCK-DEV-…` demo machines.
4. On a PC/Raspberry Pi in the mess LAN: fill `bridge/.env` (`DEVICES=[…]`), set `ADAPTER=pull` or `adms`, run `npm start` (use `pm2`/a Windows service to keep it running).
5. **Test with one staff member first**: manager → Students → enrol their PIN → they punch → confirm the feed and the balance.
6. Only then **enrol students** (manager → Students) and import fees (Admin → Setup → CSV).
7. Remove the demo data: use a fresh project without `seed.sql`, or delete the fake users in *Authentication → Users*. Set `NEXT_PUBLIC_SHOW_DEMO_HINT` to empty.

### Troubleshooting
- *Login says "restricted to @mnit.ac.in":* the domain setting (step 4.3).
- *Bridge: `FATAL: HTTP 401`:* `DEVICE_INGEST_SECRET` differs between `bridge/.env` and `supabase secrets`.
- *Punch status `unmatched`:* the PIN is not enrolled (Manager → Students). *`outside_window`:* check meal windows (Admin → Setup). *`rejected`:* unknown device serial or the student has no fee recorded for the active semester.
- *Devices page says Offline:* the bridge is not running, or cannot reach the machine.
