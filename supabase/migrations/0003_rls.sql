-- 0003_rls.sql — grants, Row Level Security and Realtime.
--
-- Access model
--   student : own profile / account / ledger / meal events / punches / disputes; may insert own disputes, opt-ins, ratings
--   manager : operational data (profiles, devices, PIN mapping, punches, meal events, disputes, opt-ins, ratings, cooked counts).
--             Managers can NOT read money: no student_accounts, refund_ledger, refund_proposals, audit_log.
--   admin   : everything, plus rates/windows/semesters/refunds
--   ledger / meal_events / punches / accounts are written ONLY by SECURITY DEFINER functions.

-- ───────── table privileges (belt and braces on top of RLS) ─────────
revoke all on all tables in schema public from anon, authenticated;
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;

-- Tables that only SQL functions may write:
revoke insert, update, delete on refund_ledger, student_accounts, refund_proposals, punches, meal_events, audit_log
  from authenticated;
-- profiles: users edit a small set of columns only (role can never be self-edited)
revoke insert, update, delete on profiles from authenticated;
grant update (full_name, roll_no, hostel, room_no, diet_type, consented_at) on profiles to authenticated;
-- disputes are resolved through resolve_dispute(), never by direct update
revoke update, delete on disputes from authenticated;

-- ───────── function privileges ─────────
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
grant execute on function
  public.app_role(), public.is_staff(), public.is_admin(),
  public.resolve_dispute(uuid, boolean, text),
  public.set_student_fee(uuid, uuid, integer),
  public.admin_adjust(uuid, integer, text),
  public.set_user_role(uuid, user_role),
  public.close_semester(uuid),
  public.approve_refund(uuid)
  to authenticated;
-- ingest_punch, _charge_meal, write_audit, account_balance: service_role only.

-- ───────── enable RLS everywhere ─────────
alter table app_settings      enable row level security;
alter table profiles          enable row level security;
alter table semesters         enable row level security;
alter table meal_types        enable row level security;
alter table meal_windows      enable row level security;
alter table meal_rates        enable row level security;
alter table student_accounts  enable row level security;
alter table devices           enable row level security;
alter table device_users      enable row level security;
alter table punches           enable row level security;
alter table meal_events       enable row level security;
alter table refund_ledger     enable row level security;
alter table refund_proposals  enable row level security;
alter table disputes          enable row level security;
alter table opt_ins           enable row level security;
alter table meal_ratings      enable row level security;
alter table meal_cooked       enable row level security;
alter table audit_log         enable row level security;

-- ───────── policies ─────────
-- app_settings
create policy settings_admin on app_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- profiles
create policy profiles_select on profiles for select to authenticated
  using (id = auth.uid() or public.is_staff());
create policy profiles_update_self on profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_update_admin on profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- reference data: everyone signed in can read, only admin writes
create policy semesters_read    on semesters    for select to authenticated using (true);
create policy meal_types_read   on meal_types   for select to authenticated using (true);
create policy meal_windows_read on meal_windows for select to authenticated using (true);
create policy meal_rates_read   on meal_rates   for select to authenticated using (true);
create policy semesters_admin    on semesters    for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy meal_windows_admin on meal_windows for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy meal_rates_admin   on meal_rates   for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy meal_types_admin   on meal_types   for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- money: student (own) + admin only
create policy accounts_select on student_accounts for select to authenticated
  using (student_id = auth.uid() or public.is_admin());
create policy ledger_select on refund_ledger for select to authenticated
  using (public.is_admin() or exists (
    select 1 from student_accounts a where a.id = refund_ledger.student_account_id and a.student_id = auth.uid()));
create policy proposals_select on refund_proposals for select to authenticated
  using (public.is_admin() or exists (
    select 1 from student_accounts a where a.id = refund_proposals.student_account_id and a.student_id = auth.uid()));

-- devices (managers see status; only admin edits devices)
create policy devices_select on devices for select to authenticated using (public.is_staff());
create policy devices_admin  on devices for all    to authenticated using (public.is_admin()) with check (public.is_admin());

-- PIN mapping: students see own; staff enrol
create policy device_users_select on device_users for select to authenticated
  using (student_id = auth.uid() or public.is_staff());
create policy device_users_staff_write on device_users for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- punches / meal events: own + staff
create policy punches_select on punches for select to authenticated
  using (student_id = auth.uid() or public.is_staff());
create policy meal_events_select on meal_events for select to authenticated
  using (student_id = auth.uid() or public.is_staff());

-- disputes
create policy disputes_select on disputes for select to authenticated
  using (student_id = auth.uid() or public.is_staff());
create policy disputes_insert on disputes for insert to authenticated
  with check (student_id = auth.uid() and status = 'open' and resolved_by is null and resolution_note is null);

-- opt-ins & ratings
create policy opt_ins_select on opt_ins for select to authenticated using (student_id = auth.uid() or public.is_staff());
create policy opt_ins_write  on opt_ins for all    to authenticated using (student_id = auth.uid()) with check (student_id = auth.uid());
create policy ratings_select on meal_ratings for select to authenticated using (student_id = auth.uid() or public.is_staff());
create policy ratings_write  on meal_ratings for all    to authenticated using (student_id = auth.uid()) with check (student_id = auth.uid());

-- cooked counts: staff only (read + write)
create policy cooked_select on meal_cooked for select to authenticated using (public.is_staff());
create policy cooked_write  on meal_cooked for all    to authenticated using (public.is_staff()) with check (public.is_staff());

-- audit log
create policy audit_select on audit_log for select to authenticated using (public.is_admin());

-- ───────── Realtime for the live punch feed ─────────
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.punches;
    alter publication supabase_realtime add table public.meal_events;
  end if;
end $$;
