-- 0006_contact_and_money_left.sql — email + phone on the profile, and a one-step "set money left" for the admin panel.

alter table profiles add column email text;
alter table profiles add column phone text;
update profiles p set email = u.email from auth.users u where u.id = p.id;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name, roll_no, hostel, room_no, email, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email, ''), '@', 1)),
    nullif(new.raw_user_meta_data ->> 'roll_no', ''),
    nullif(new.raw_user_meta_data ->> 'hostel', ''),
    nullif(new.raw_user_meta_data ->> 'room_no', ''),
    new.email,
    nullif(new.raw_user_meta_data ->> 'phone', '')
  );
  return new;
end $$;

-- Users may edit their own phone number (email comes from Supabase Auth and is not editable here).
grant update (phone) on profiles to authenticated;

-- Admin sets how much money a student has left. The ledger stays append-only: the difference is recorded
-- as a manual_adjustment (visible in the audit log), so history is never rewritten.
create or replace function public.set_money_left(p_student uuid, p_new_balance_paise integer, p_reason text default 'Set by admin')
returns integer language plpgsql security definer set search_path = public as $$
declare v_sem uuid; v_acct uuid; v_old integer; v_diff integer;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if p_new_balance_paise is null or p_new_balance_paise < 0 then raise exception 'Money left cannot be negative'; end if;
  select id into v_sem from semesters where is_active;
  if v_sem is null then raise exception 'There is no active semester'; end if;

  select id into v_acct from student_accounts where student_id = p_student and semester_id = v_sem;
  if v_acct is null then
    perform public.set_student_fee(p_student, v_sem, p_new_balance_paise);   -- first fee = opening balance
    return p_new_balance_paise;
  end if;

  v_old := public.account_balance(v_acct);
  v_diff := p_new_balance_paise - v_old;
  if v_diff <> 0 then
    insert into refund_ledger (student_account_id, entry_type, amount_paise, reason, created_by)
    values (v_acct, 'manual_adjustment', v_diff, coalesce(nullif(trim(p_reason), ''), 'Set by admin'), auth.uid());
    perform public.write_audit('set_money_left', 'student_accounts', v_acct::text,
      jsonb_build_object('student_id', p_student, 'from_paise', v_old, 'to_paise', p_new_balance_paise));
  end if;
  return p_new_balance_paise;
end $$;

revoke execute on function public.set_money_left(uuid, integer, text) from public, anon;
grant execute on function public.set_money_left(uuid, integer, text) to authenticated, service_role;
