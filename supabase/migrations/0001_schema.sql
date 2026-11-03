-- 0001_schema.sql — core tables for the MNIT Mess Portal.
-- Money is ALWAYS integer paise. All timestamps are timestamptz. Meal windows are interpreted in Asia/Kolkata.

-- ───────────────────────── enums ─────────────────────────
create type user_role         as enum ('student', 'manager', 'admin');
create type diet_type         as enum ('veg', 'non_veg', 'egg', 'jain');
create type meal_code         as enum ('breakfast', 'lunch', 'snacks', 'dinner');
create type punch_status      as enum ('matched', 'unmatched', 'duplicate', 'outside_window', 'rejected');
create type ledger_entry_type as enum ('opening', 'meal_deduction', 'manual_adjustment', 'dispute_credit', 'refund_paid');
create type dispute_status    as enum ('open', 'approved', 'rejected');
create type dispute_kind      as enum ('missing_punch', 'wrong_charge');
create type refund_status     as enum ('proposed', 'approved');

-- ───────────────────────── settings ─────────────────────────
create table app_settings (
  key   text primary key,
  value text not null
);
-- PLACEHOLDER domain — confirm with the institute before go-live. Set to '*' to disable the check.
insert into app_settings (key, value) values ('allowed_email_domain', 'mnit.ac.in');

-- ───────────────────────── people ─────────────────────────
create table profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  full_name    text not null default '',
  roll_no      text unique,
  hostel       text,
  room_no      text,
  diet_type    diet_type not null default 'veg',
  role         user_role not null default 'student',
  consented_at timestamptz,
  created_at   timestamptz not null default now()
);

-- ───────────────────────── semesters / meals / rates ─────────────────────────
create table semesters (
  id        uuid primary key default gen_random_uuid(),
  name      text not null,
  starts_on date not null,
  ends_on   date not null,
  is_active boolean not null default false,
  check (ends_on > starts_on)
);
create unique index semesters_one_active on semesters (is_active) where is_active;

create table meal_types (
  id   uuid primary key default gen_random_uuid(),
  code meal_code not null unique,
  name text not null
);

create table meal_windows (
  id             uuid primary key default gen_random_uuid(),
  meal_type_id   uuid not null unique references meal_types (id),
  start_time     time not null,
  end_time       time not null,
  active         boolean not null default true,
  is_placeholder boolean not null default true, -- admin should confirm real timings
  check (start_time < end_time)
);

create table meal_rates (
  id           uuid primary key default gen_random_uuid(),
  semester_id  uuid not null references semesters (id) on delete cascade,
  meal_type_id uuid not null references meal_types (id),
  rate_paise   integer not null check (rate_paise >= 0),
  unique (semester_id, meal_type_id)
);

create table student_accounts (
  id                uuid primary key default gen_random_uuid(),
  student_id        uuid not null references profiles (id) on delete cascade,
  semester_id       uuid not null references semesters (id),
  amount_paid_paise integer not null check (amount_paid_paise >= 0),
  created_at        timestamptz not null default now(),
  unique (student_id, semester_id)
);

-- ───────────────────────── devices & punches ─────────────────────────
create table devices (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  location      text,
  device_serial text not null unique,
  ip_address    text,
  last_seen_at  timestamptz,
  is_active     boolean not null default true
);

-- Maps the numeric PIN on a machine to a student. NO biometric templates are ever stored.
-- device_id NULL = the PIN is valid on every machine.
create table device_users (
  id             uuid primary key default gen_random_uuid(),
  student_id     uuid not null references profiles (id) on delete cascade,
  device_id      uuid references devices (id) on delete cascade,
  device_user_id text not null,
  unique (device_id, device_user_id)
);
create unique index device_users_global_pin on device_users (device_user_id) where device_id is null;

create table punches (
  id             uuid primary key default gen_random_uuid(),
  device_id      uuid not null references devices (id),
  device_user_id text not null,
  punched_at     timestamptz not null,
  verify_mode    integer,
  raw            jsonb not null default '{}'::jsonb,
  received_at    timestamptz not null default now(),
  status         punch_status not null,
  student_id     uuid references profiles (id),
  meal_type_id   uuid references meal_types (id),
  needs_review   boolean not null default false,
  review_reason  text,
  unique (device_id, device_user_id, punched_at)
);
create index punches_punched_at_idx on punches (punched_at desc);
create index punches_student_idx    on punches (student_id, punched_at desc);

create table meal_events (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references profiles (id) on delete cascade,
  semester_id  uuid not null references semesters (id),
  meal_type_id uuid not null references meal_types (id),
  meal_date    date not null,
  punch_id     uuid references punches (id),
  eaten_at     timestamptz not null,
  rate_paise   integer not null check (rate_paise >= 0), -- amount actually deducted (may be capped)
  source       text not null default 'punch' check (source in ('punch', 'dispute')),
  unique (student_id, meal_date, meal_type_id)
);
create index meal_events_date_idx on meal_events (meal_date, meal_type_id);

-- ───────────────────────── ledger (append-only) ─────────────────────────
create table refund_ledger (
  id                 uuid primary key default gen_random_uuid(),
  student_account_id uuid not null references student_accounts (id),
  entry_type         ledger_entry_type not null,
  amount_paise       integer not null, -- negative reduces balance
  meal_event_id      uuid references meal_events (id),
  reason             text,
  created_by         uuid references profiles (id),
  created_at         timestamptz not null default now()
);
create index refund_ledger_account_idx on refund_ledger (student_account_id, created_at);

create table refund_proposals (
  id                 uuid primary key default gen_random_uuid(),
  student_account_id uuid not null unique references student_accounts (id),
  proposed_paise     integer not null check (proposed_paise >= 0),
  status             refund_status not null default 'proposed',
  created_at         timestamptz not null default now(),
  approved_by        uuid references profiles (id),
  approved_at        timestamptz
);

-- ───────────────────────── disputes, opt-in, ratings, cooked ─────────────────────────
create table disputes (
  id              uuid primary key default gen_random_uuid(),
  student_id      uuid not null references profiles (id) on delete cascade,
  kind            dispute_kind not null default 'missing_punch',
  meal_date       date not null,
  meal_type_id    uuid references meal_types (id),
  message         text not null check (char_length(message) between 3 and 1000),
  status          dispute_status not null default 'open',
  resolved_by     uuid references profiles (id),
  resolution_note text,
  created_at      timestamptz not null default now()
);
create index disputes_status_idx on disputes (status, created_at desc);

create table opt_ins (
  student_id   uuid not null references profiles (id) on delete cascade,
  meal_date    date not null,
  meal_type_id uuid not null references meal_types (id),
  will_eat     boolean not null,
  primary key (student_id, meal_date, meal_type_id)
);

create table meal_ratings (
  student_id   uuid not null references profiles (id) on delete cascade,
  meal_date    date not null,
  meal_type_id uuid not null references meal_types (id),
  rating       smallint not null check (rating between 1 and 5),
  primary key (student_id, meal_date, meal_type_id)
);

create table meal_cooked (
  meal_date    date not null,
  meal_type_id uuid not null references meal_types (id),
  cooked_count integer not null check (cooked_count >= 0),
  updated_by   uuid references profiles (id),
  primary key (meal_date, meal_type_id)
);

create table audit_log (
  id         uuid primary key default gen_random_uuid(),
  actor_id   uuid,
  action     text not null,
  entity     text not null,
  entity_id  text,
  details    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_created_idx on audit_log (created_at desc);
