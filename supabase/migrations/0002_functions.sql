-- 0002_functions.sql — business rules live in the database, not only in app code.

-- ───────────────────────── role helpers ─────────────────────────
create or replace function public.app_role() returns user_role
language sql stable security definer set search_path = public as
$$ select role from public.profiles where id = auth.uid() $$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce(public.app_role() in ('manager', 'admin'), false) $$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce(public.app_role() = 'admin', false) $$;

-- ───────────────────────── sign-up: domain check + profile row ─────────────────────────
create or replace function public.enforce_email_domain() returns trigger
language plpgsql security definer set search_path = public as $$
declare d text;
begin
  select value into d from app_settings where key = 'allowed_email_domain';
  if d is not null and d <> '*' and lower(split_part(coalesce(new.email, ''), '@', 2)) <> lower(d) then
    raise exception 'Sign-ups are restricted to @% email addresses', d;
  end if;
  return new;
end $$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name, roll_no, hostel, room_no)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email, ''), '@', 1)),
    nullif(new.raw_user_meta_data ->> 'roll_no', ''),
    nullif(new.raw_user_meta_data ->> 'hostel', ''),
    nullif(new.raw_user_meta_data ->> 'room_no', '')
  );
  return new;
end $$;

create trigger a_enforce_email_domain before insert on auth.users
  for each row execute function public.enforce_email_domain();
create trigger b_handle_new_user after insert on auth.users
  for each row execute function public.handle_new_user();

-- Students may fill in their roll number once; only admins may change it afterwards.
create or replace function public.profiles_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.roll_no is not null and new.roll_no is distinct from old.roll_no
     and coalesce(public.app_role()::text, 'admin') <> 'admin' then
    raise exception 'roll_no can only be changed by an admin';
  end if;
  if new.role is distinct from old.role and auth.uid() is not null and not public.is_admin() then
    raise exception 'role can only be changed by an admin';
  end if;
  return new;
end $$;
create trigger profiles_guard_trg before update on profiles
  for each row execute function public.profiles_guard();

-- ───────────────────────── audit ─────────────────────────
create or replace function public.write_audit(p_action text, p_entity text, p_entity_id text, p_details jsonb)
returns void language sql security definer set search_path = public as
$$ insert into audit_log (actor_id, action, entity, entity_id, details)
   values (auth.uid(), p_action, p_entity, p_entity_id, coalesce(p_details, '{}'::jsonb)) $$;

create or replace function public.audit_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log (actor_id, action, entity, entity_id, details)
  values (
    auth.uid(), lower(tg_op), tg_table_name,
    coalesce((to_jsonb(new) ->> 'id'), (to_jsonb(old) ->> 'id')),
    jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new))
  );
  return coalesce(new, old);
end $$;

create trigger audit_meal_rates   after insert or update or delete on meal_rates   for each row execute function public.audit_trigger();
create trigger audit_meal_windows after insert or update or delete on meal_windows for each row execute function public.audit_trigger();
create trigger audit_semesters    after insert or update or delete on semesters    for each row execute function public.audit_trigger();
create trigger audit_devices      after insert or update or delete on devices      for each row execute function public.audit_trigger();
create trigger audit_device_users after insert or update or delete on device_users for each row execute function public.audit_trigger();

-- ───────────────────────── ledger: append-only ─────────────────────────
create or replace function public.ledger_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'refund_ledger is append-only (% not allowed)', tg_op;
end $$;
create trigger refund_ledger_no_update_delete before update or delete on refund_ledger
  for each row execute function public.ledger_append_only();
create trigger refund_ledger_no_truncate before truncate on refund_ledger
  for each statement execute function public.ledger_append_only();

-- Opening row = +amount paid, written automatically when an account is created.
create or replace function public.account_opening_entry() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into refund_ledger (student_account_id, entry_type, amount_paise, reason, created_by)
  values (new.id, 'opening', new.amount_paid_paise, 'Mess fee paid', auth.uid());
  return new;
end $$;
create trigger student_accounts_opening after insert on student_accounts
  for each row execute function public.account_opening_entry();

create or replace function public.account_balance(p_account uuid) returns integer
language sql stable security definer set search_path = public as
$$ select coalesce(sum(amount_paise), 0)::integer from refund_ledger where student_account_id = p_account $$;

-- ───────────────────────── views ─────────────────────────
-- security_invoker: RLS of the caller applies, so a student only sees their own row.
create view v_student_balance with (security_invoker = true) as
select
  a.id                                   as student_account_id,
  a.student_id,
  a.semester_id,
  a.amount_paid_paise,
  coalesce(sum(l.amount_paise), 0)::int  as balance_paise,
  coalesce(-sum(l.amount_paise) filter (where l.entry_type = 'meal_deduction'), 0)::int as deducted_paise,
  (select count(*) from meal_events e where e.student_id = a.student_id and e.semester_id = a.semester_id)::int as meals_eaten
from student_accounts a
left join refund_ledger l on l.student_account_id = a.id
group by a.id;

create view v_refund_report with (security_invoker = true) as
select
  b.student_account_id, b.semester_id, b.student_id,
  p.full_name, p.roll_no, p.hostel, p.room_no,
  b.amount_paid_paise, b.deducted_paise, b.meals_eaten, b.balance_paise,
  r.id as proposal_id, r.proposed_paise, r.status as proposal_status
from v_student_balance b
join profiles p on p.id = b.student_id
left join refund_proposals r on r.student_account_id = b.student_account_id;

-- ───────────────────────── charging a meal (shared by punches and disputes) ─────────────────────────
-- Records the meal and deducts the rate, capped so the balance never goes below 0.
create or replace function public._charge_meal(
  p_account_id uuid, p_meal_type uuid, p_meal_date date, p_eaten_at timestamptz,
  p_punch_id uuid, p_source text, p_actor uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_acct student_accounts%rowtype;
  v_rate integer; v_balance integer; v_charge integer; v_event uuid; v_reason text;
begin
  select * into v_acct from student_accounts where id = p_account_id for update; -- serialises per student
  select rate_paise into v_rate from meal_rates where semester_id = v_acct.semester_id and meal_type_id = p_meal_type;
  if v_rate is null then
    return jsonb_build_object('ok', false, 'error', 'no_rate');
  end if;
  if exists (select 1 from meal_events where student_id = v_acct.student_id and meal_date = p_meal_date and meal_type_id = p_meal_type) then
    return jsonb_build_object('ok', false, 'error', 'duplicate');
  end if;

  v_balance := public.account_balance(p_account_id);
  v_charge  := least(v_rate, greatest(v_balance, 0));
  v_reason  := case when v_charge < v_rate then 'balance_exhausted'
                    when p_source = 'dispute' then 'dispute_approved' else 'meal_eaten' end;

  insert into meal_events (student_id, semester_id, meal_type_id, meal_date, punch_id, eaten_at, rate_paise, source)
  values (v_acct.student_id, v_acct.semester_id, p_meal_type, p_meal_date, p_punch_id, p_eaten_at, v_charge, p_source)
  returning id into v_event;

  insert into refund_ledger (student_account_id, entry_type, amount_paise, meal_event_id, reason, created_by)
  values (p_account_id, 'meal_deduction', -v_charge, v_event, v_reason, p_actor);

  return jsonb_build_object('ok', true, 'meal_event_id', v_event, 'charged_paise', v_charge,
                            'rate_paise', v_rate, 'reason', v_reason, 'balance_after_paise', v_balance - v_charge);
end $$;

-- Bridge heartbeat: lets the Devices page show online/offline even when nobody is eating. service_role only.
create or replace function public.device_heartbeat(p_serial text, p_at timestamptz default now())
returns void language sql security definer set search_path = public as
$$ update devices set last_seen_at = greatest(coalesce(last_seen_at, '-infinity'::timestamptz), p_at)
   where device_serial = p_serial and is_active $$;

-- ───────────────────────── ingest_punch ─────────────────────────
-- Called ONLY by the ingest-punches edge function (service_role). Idempotent: re-sending a punch is safe.
create or replace function public.ingest_punch(
  p_device_serial  text,
  p_device_user_id text,
  p_punched_at     timestamptz,
  p_verify_mode    integer default null,
  p_raw            jsonb default '{}'::jsonb,
  p_received_at    timestamptz default now()
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_device devices%rowtype;
  v_existing punches%rowtype;
  v_student uuid; v_meal uuid; v_acct uuid; v_sem uuid;
  v_local timestamp; v_date date;
  v_status punch_status; v_note text;
  v_review boolean; v_review_reason text;
  v_punch uuid; v_charge jsonb;
begin
  select * into v_device from devices where device_serial = p_device_serial and is_active;
  if not found then
    return jsonb_build_object('status', 'rejected', 'reason', 'unknown_device');
  end if;

  -- serialise identical punches so concurrent re-sends cannot double-process
  perform pg_advisory_xact_lock(hashtextextended(v_device.id::text || '|' || p_device_user_id || '|' || p_punched_at::text, 0));

  update devices set last_seen_at = greatest(coalesce(last_seen_at, '-infinity'::timestamptz), p_received_at)
   where id = v_device.id;

  select * into v_existing from punches
   where device_id = v_device.id and device_user_id = p_device_user_id and punched_at = p_punched_at;
  if found then
    return jsonb_build_object('status', v_existing.status, 'replayed', true, 'punch_id', v_existing.id);
  end if;

  -- never trust device clocks blindly
  if abs(extract(epoch from (p_punched_at - p_received_at))) > 600 then
    v_review := true; v_review_reason := 'device_clock_skew_over_10_min';
  else
    v_review := false;
  end if;

  v_local := p_punched_at at time zone 'Asia/Kolkata';
  v_date  := v_local::date;

  select student_id into v_student from device_users
   where device_user_id = p_device_user_id and (device_id = v_device.id or device_id is null)
   order by device_id nulls last limit 1;

  select meal_type_id into v_meal from meal_windows
   where active and v_local::time between start_time and end_time limit 1;

  if v_student is not null then
    select a.id, a.semester_id into v_acct, v_sem
      from student_accounts a join semesters s on s.id = a.semester_id
     where a.student_id = v_student and s.is_active and v_date between s.starts_on and s.ends_on;
    if v_acct is not null then
      perform 1 from student_accounts where id = v_acct for update;
    end if;
  end if;

  if v_student is null then
    v_status := 'unmatched';
  elsif v_meal is null then
    v_status := 'outside_window';
  elsif v_acct is null then
    v_status := 'rejected'; v_note := 'no_active_account';
  elsif exists (select 1 from meal_events where student_id = v_student and meal_date = v_date and meal_type_id = v_meal) then
    v_status := 'duplicate';
  else
    v_status := 'matched';
  end if;

  insert into punches (device_id, device_user_id, punched_at, verify_mode, raw, received_at, status,
                       student_id, meal_type_id, needs_review, review_reason)
  values (v_device.id, p_device_user_id, p_punched_at, p_verify_mode, coalesce(p_raw, '{}'::jsonb), p_received_at,
          v_status, v_student, v_meal, v_review, v_review_reason)
  returning id into v_punch;

  if v_status = 'matched' then
    v_charge := public._charge_meal(v_acct, v_meal, v_date, p_punched_at, v_punch, 'punch', null);
    if (v_charge ->> 'ok')::boolean is not true then
      -- e.g. no rate configured: keep the punch but do not charge
      v_status := case when v_charge ->> 'error' = 'duplicate' then 'duplicate' else 'rejected' end;
      v_note := v_charge ->> 'error';
      update punches set status = v_status where id = v_punch;
    end if;
  end if;

  return jsonb_build_object(
    'status', v_status, 'punch_id', v_punch, 'student_id', v_student, 'meal_type_id', v_meal,
    'meal_date', v_date, 'needs_review', v_review, 'note', v_note,
    'charged_paise', v_charge -> 'charged_paise', 'balance_after_paise', v_charge -> 'balance_after_paise',
    'reason', v_charge -> 'reason');
end $$;

-- ───────────────────────── disputes ─────────────────────────
create or replace function public.resolve_dispute(p_dispute uuid, p_approve boolean, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  d disputes%rowtype; v_acct uuid; v_sem uuid; v_start time; v_res jsonb; v_event meal_events%rowtype;
begin
  if not public.is_staff() then raise exception 'Only mess staff can resolve disputes'; end if;
  if p_note is null or char_length(trim(p_note)) < 3 then raise exception 'A reason is required'; end if;

  select * into d from disputes where id = p_dispute for update;
  if not found then raise exception 'Dispute not found'; end if;
  if d.status <> 'open' then raise exception 'Dispute already resolved'; end if;

  if p_approve then
    select a.id, a.semester_id into v_acct, v_sem
      from student_accounts a join semesters s on s.id = a.semester_id
     where a.student_id = d.student_id and d.meal_date between s.starts_on and s.ends_on;
    if v_acct is null then raise exception 'Student has no account for that date'; end if;

    if d.kind = 'missing_punch' then
      if d.meal_type_id is null then raise exception 'Dispute has no meal selected'; end if;
      select start_time into v_start from meal_windows where meal_type_id = d.meal_type_id;
      v_res := public._charge_meal(v_acct, d.meal_type_id, d.meal_date,
                 ((d.meal_date + coalesce(v_start, time '12:00')) at time zone 'Asia/Kolkata'),
                 null, 'dispute', auth.uid());
      if (v_res ->> 'ok')::boolean is not true then
        raise exception 'Cannot create meal event: %', v_res ->> 'error';
      end if;
    else -- wrong_charge: credit the amount back
      select * into v_event from meal_events
       where student_id = d.student_id and meal_date = d.meal_date and meal_type_id = d.meal_type_id;
      if not found then raise exception 'No meal event exists to credit'; end if;
      if exists (select 1 from refund_ledger where meal_event_id = v_event.id and entry_type = 'dispute_credit') then
        raise exception 'This meal was already credited';
      end if;
      insert into refund_ledger (student_account_id, entry_type, amount_paise, meal_event_id, reason, created_by)
      values (v_acct, 'dispute_credit', v_event.rate_paise, v_event.id, 'Dispute approved: ' || p_note, auth.uid());
      v_res := jsonb_build_object('ok', true, 'credited_paise', v_event.rate_paise);
    end if;
  end if;

  update disputes set status = case when p_approve then 'approved'::dispute_status else 'rejected'::dispute_status end,
         resolved_by = auth.uid(), resolution_note = p_note where id = d.id;

  perform public.write_audit(case when p_approve then 'dispute_approved' else 'dispute_rejected' end,
                             'disputes', d.id::text,
                             jsonb_build_object('student_id', d.student_id, 'kind', d.kind, 'note', p_note, 'result', v_res));
  return coalesce(v_res, jsonb_build_object('ok', true));
end $$;

-- ───────────────────────── admin operations ─────────────────────────
create or replace function public.set_student_fee(p_student uuid, p_semester uuid, p_amount_paise integer)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_acct student_accounts%rowtype; v_id uuid;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if p_amount_paise < 0 then raise exception 'Amount cannot be negative'; end if;

  select * into v_acct from student_accounts where student_id = p_student and semester_id = p_semester for update;
  if not found then
    insert into student_accounts (student_id, semester_id, amount_paid_paise)
    values (p_student, p_semester, p_amount_paise) returning id into v_id;
  else
    v_id := v_acct.id;
    if v_acct.amount_paid_paise <> p_amount_paise then
      update student_accounts set amount_paid_paise = p_amount_paise where id = v_id;
      insert into refund_ledger (student_account_id, entry_type, amount_paise, reason, created_by)
      values (v_id, 'manual_adjustment', p_amount_paise - v_acct.amount_paid_paise, 'Fee amount corrected', auth.uid());
    end if;
  end if;
  perform public.write_audit('set_student_fee', 'student_accounts', v_id::text,
                             jsonb_build_object('student_id', p_student, 'amount_paise', p_amount_paise));
  return v_id;
end $$;

create or replace function public.admin_adjust(p_account uuid, p_amount_paise integer, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if p_reason is null or char_length(trim(p_reason)) < 3 then raise exception 'A reason is required'; end if;
  if public.account_balance(p_account) + p_amount_paise < 0 then raise exception 'Balance cannot go below 0'; end if;
  insert into refund_ledger (student_account_id, entry_type, amount_paise, reason, created_by)
  values (p_account, 'manual_adjustment', p_amount_paise, p_reason, auth.uid());
  perform public.write_audit('manual_adjustment', 'student_accounts', p_account::text,
                             jsonb_build_object('amount_paise', p_amount_paise, 'reason', p_reason));
end $$;

create or replace function public.set_user_role(p_user uuid, p_role user_role)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  update profiles set role = p_role where id = p_user;
  perform public.write_audit('set_user_role', 'profiles', p_user::text, jsonb_build_object('role', p_role));
end $$;

-- Semester close → PROPOSED refunds (= remaining balance). Nothing is paid by the system.
create or replace function public.close_semester(p_semester uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  update semesters set is_active = false where id = p_semester;
  insert into refund_proposals (student_account_id, proposed_paise)
  select a.id, greatest(public.account_balance(a.id), 0)
    from student_accounts a
   where a.semester_id = p_semester
  on conflict (student_account_id) do nothing;
  get diagnostics n = row_count;
  perform public.write_audit('close_semester', 'semesters', p_semester::text, jsonb_build_object('proposals_created', n));
  return n;
end $$;

-- Approving records that admin has signed off the refund amount. The payout itself happens outside this system.
create or replace function public.approve_refund(p_proposal uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r refund_proposals%rowtype; v_bal integer; v_amt integer;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  select * into r from refund_proposals where id = p_proposal for update;
  if not found then raise exception 'Proposal not found'; end if;
  if r.status <> 'proposed' then raise exception 'Proposal already approved'; end if;
  v_bal := public.account_balance(r.student_account_id);
  v_amt := least(r.proposed_paise, greatest(v_bal, 0));
  if v_amt > 0 then
    insert into refund_ledger (student_account_id, entry_type, amount_paise, reason, created_by)
    values (r.student_account_id, 'refund_paid', -v_amt, 'Refund approved by admin (payout handled outside the portal)', auth.uid());
  end if;
  update refund_proposals set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = r.id;
  perform public.write_audit('approve_refund', 'refund_proposals', r.id::text, jsonb_build_object('amount_paise', v_amt));
end $$;
