# ASSUMPTIONS & decisions

Placeholders you must confirm are marked **⚠ CONFIRM**.

## Placeholders (not real data)
- ⚠ **College email domain** `@mnit.ac.in` — stored in `app_settings.allowed_email_domain`, enforced by a DB trigger on sign-up.
- ⚠ **Meal windows** breakfast 07:30–09:30, lunch 12:00–14:30, snacks 17:00–18:30, dinner 19:30–21:30 (IST). Flagged `is_placeholder` until an admin saves them.
- ⚠ **Rates** (seed only): breakfast ₹30, lunch ₹65, snacks ₹20, dinner ₹65. **Fee** ₹25,000 per student in the seed. Real values come from the admin screens / CSV.
- Hostel names, student names, device serials (`MOCK-DEV-00x`) and all seeded punches are fake.

## Product interpretation
- **"How much a student ate" = which meals they attended**, counted once per student per meal per day. No portion data is invented.
- A punch inside a meal window is a "meal eaten" and charges that meal's rate. A second punch in the same meal is `duplicate` (free).
- **Balance** = sum of the append-only ledger. Opening row = amount paid. If a deduction would go below zero, the meal is still recorded but the charge is capped and the ledger reason is `balance_exhausted`.
- **Refunds are proposals.** Closing a semester creates `refund_proposals` (= remaining balance). An admin approval writes a `refund_paid` ledger row (so the balance reads 0) — this records sign-off only. **No money moves in the system**, and the UI says "proposed refund (pending approval)" everywhere.
- **Projected refund** = balance − (average spend per elapsed day × days left), floored at 0. It is an estimate.
- **Disputes have two kinds** (I added `dispute_kind`): *missing_punch* ("I ate, it didn't register") → approval creates the meal event and deducts its rate; *wrong_charge* → approval credits the rate back as `dispute_credit`. Both need a written reason and are audited.
- **Cooked count** (`meal_cooked`) is a manager-entered number for the "cooked vs punched vs opted-in" view; the brief mentioned "cooked" without a source, so it is manual.

## Privacy & access (a deliberate tightening of the brief)
- The brief says managers "can read all" but also that staff must not browse student data beyond what they need. I resolved it so: **managers can see operational data** (names, roll numbers, punches, meals, disputes, opt-ins, ratings, PIN mappings) **but not money** (no `student_accounts`, `refund_ledger`, refund proposals, or audit log). Admins see everything. Change in `0003_rls.sql` if the institute wants otherwise.
- No biometric templates are stored or transmitted. The ADMS adapter explicitly discards `USERINFO/FP/FACE` tables unparsed.
- Students can edit only name, roll number (once), hostel, room, diet and consent. Roles are admin-only via `set_user_role`.
- First-login **consent screen** is mandatory before any other page.

## Technical decisions
- **Business rules in SQL** (`ingest_punch`, `_charge_meal`, `resolve_dispute`, `close_semester`, `approve_refund`, …). The ledger, meal events, punches and accounts are writable **only** by `SECURITY DEFINER` functions; the browser/session cannot insert into them.
- `ingest_punch` is callable only by `service_role` (the edge function). It takes the server clock as `received_at`; punches whose device time differs from server time by > 10 minutes are processed but flagged `needs_review`. (A bridge that was offline for hours and then re-sends old punches will therefore flag them too — intended, so staff can eyeball them.)
- Idempotency: unique `(device_id, device_user_id, punched_at)` plus an advisory lock; re-sent punches return `replayed: true` with the original status.
- A punch is matched to a student via `device_users`; `device_id = NULL` means the PIN is valid on every machine (simplest for 2+ machines sharing one user list). Per-machine mappings take precedence.
- Meals are charged to the **active** semester's account. A student with no account for it gets `rejected` (`no_active_account`).
- **Web app uses no service-role key.** All privileged operations go through SQL functions that check the caller's role, so the key stays out of the web tier. It remains in `.env.example` as the brief requested.
- **UI components** are shadcn/ui-style (Tailwind + class-variance-authority), written by hand rather than via `npx shadcn add`, to keep the dependency list small. Charts: Recharts. Times: date-fns-tz, all `Asia/Kolkata`.
- The **bridge heartbeat** (extra, beyond the brief) lets the Devices page show online/offline even when nobody is punching.
- ERP/SSO login is **not** implemented: marked `// TODO: ERP SSO hook` in `web/src/app/actions/auth.ts` and the login page. No ERP API access is assumed.

## What has and hasn't been verified (honest status)
| Verified here | Not verifiable here |
|---|---|
| All migrations + seed + RLS + business rules, via 25 automated tests on a real Postgres engine (PGlite) with a Supabase stub | Running on actual Supabase (Auth, Realtime delivery, `supabase db push`) |
| Bridge: queue, retry/backoff, offline persistence, ADMS parser (8 tests); end-to-end mock bridge → ingest → ledger (`db-tests` e2e) | The Deno edge function itself (no Deno here); it is a thin wrapper over the tested SQL — **run the SETUP step 7 check** |
| Web app: TypeScript, lint, production build, unit tests for money/projection/CSV; login page + auth redirect smoke test | Authenticated screens against live data; browser/UX review; phone testing |
| — | **Real eSSL hardware.** `PullAdapter` and `AdmsPushAdapter` are written from the public ZKTeco protocol conventions and are clearly marked `// TODO: verify against your eSSL model's protocol` |
