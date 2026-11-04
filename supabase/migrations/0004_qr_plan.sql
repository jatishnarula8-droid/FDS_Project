-- 0004_qr_plan.sql — plan tomorrow's meals, get a QR pass per meal, staff scan the pass to serve + charge.
-- Biometric punches (0002) keep working; both channels share the "one meal per student per meal per day" rule.

alter table meal_events drop constraint meal_events_source_check;
alter table meal_events add constraint meal_events_source_check check (source in ('punch', 'dispute', 'qr'));

-- Students must answer before this time (IST) on the previous day. Admin-editable. 'HH:MM'.
insert into app_settings (key, value) values ('optin_cutoff', '18:00') on conflict (key) do nothing;

create type pass_status as enum ('issued', 'redeemed', 'cancelled');

create table meal_passes (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references profiles (id) on delete cascade,
  meal_date    date not null,
  meal_type_id uuid not null references meal_types (id),
  token        text not null unique default gen_random_uuid()::text, -- what the QR code contains (prefixed "MESS:")
  status       pass_status not null default 'issued',
  redeemed_at  timestamptz,
  redeemed_by  uuid references profiles (id),
  created_at   timestamptz not null default now(),
  unique (student_id, meal_date, meal_type_id)
);
create index meal_passes_date_idx on meal_passes (meal_date, meal_type_id);

-- ───────── plan status (what the student UI needs to know) ─────────
create or replace function public.plan_status(p_now timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_local timestamp := p_now at time zone 'Asia/Kolkata'; v_cut time;
begin
  select value::time into v_cut from app_settings where key = 'optin_cutoff';
  v_cut := coalesce(v_cut, time '18:00');
  return jsonb_build_object('target_date', (v_local::date + 1), 'cutoff', to_char(v_cut, 'HH24:MI'),
                            'open', v_local::time < v_cut);
end $$;

-- ───────── planning ─────────
-- Internal worker with an injectable clock (for tests). NOT callable by users.
create or replace function public._set_meal_plan(p_student uuid, p_choices jsonb, p_now timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_status jsonb := public.plan_status(p_now);
  v_date date := (v_status ->> 'target_date')::date;
  m record; v_will boolean; n_yes integer := 0;
begin
  if not (v_status ->> 'open')::boolean then
    raise exception 'Planning for tomorrow closed at % today. Ask the mess office if you need a change.', v_status ->> 'cutoff';
  end if;

  for m in select id, code from meal_types loop
    if jsonb_typeof(p_choices -> m.code::text) is distinct from 'boolean' then
      raise exception 'Please answer yes or no for every meal (missing: %)', m.code;
    end if;
  end loop;

  for m in select id, code from meal_types loop
    v_will := (p_choices ->> m.code::text)::boolean;
    insert into opt_ins (student_id, meal_date, meal_type_id, will_eat) values (p_student, v_date, m.id, v_will)
      on conflict (student_id, meal_date, meal_type_id) do update set will_eat = excluded.will_eat;
    if v_will then
      n_yes := n_yes + 1;
      insert into meal_passes (student_id, meal_date, meal_type_id) values (p_student, v_date, m.id)
        on conflict (student_id, meal_date, meal_type_id) do update set status = 'issued' where meal_passes.status = 'cancelled';
    else
      update meal_passes set status = 'cancelled'
       where student_id = p_student and meal_date = v_date and meal_type_id = m.id and status = 'issued';
    end if;
  end loop;
  return jsonb_build_object('meal_date', v_date, 'meals', n_yes);
end $$;

-- p_choices e.g. {"breakfast":true,"lunch":true,"snacks":false,"dinner":true} — always for TOMORROW (IST).
create or replace function public.set_meal_plan(p_choices jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  return public._set_meal_plan(auth.uid(), p_choices, now());
end $$;

-- ───────── redeeming a QR pass (mess staff) ─────────
create or replace function public._redeem_pass(p_token text, p_actor uuid, p_now timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_tok text := regexp_replace(trim(coalesce(p_token, '')), '^MESS:', '');
  ps meal_passes%rowtype; v_today date := (p_now at time zone 'Asia/Kolkata')::date;
  v_acct uuid; v_bal integer; v_res jsonb; v_name text; v_roll text; v_meal text;
begin
  select * into ps from meal_passes where token = v_tok for update;
  if not found then raise exception 'Unknown QR code'; end if;
  select full_name, roll_no into v_name, v_roll from profiles where id = ps.student_id;
  select name into v_meal from meal_types where id = ps.meal_type_id;

  if ps.status = 'redeemed' then raise exception '% already used this % pass at %', v_name, v_meal, to_char(ps.redeemed_at at time zone 'Asia/Kolkata', 'HH12:MI AM'); end if;
  if ps.status = 'cancelled' then raise exception 'This pass was cancelled (% opted out of %)', v_name, v_meal; end if;
  if ps.meal_date <> v_today then raise exception 'This pass is for %, not today', to_char(ps.meal_date, 'DD Mon'); end if;

  select a.id into v_acct from student_accounts a join semesters s on s.id = a.semester_id
   where a.student_id = ps.student_id and s.is_active and ps.meal_date between s.starts_on and s.ends_on;
  if v_acct is null then raise exception 'No mess fee recorded for % — send them to the mess office', v_name; end if;
  v_bal := public.account_balance(v_acct);
  if v_bal <= 0 then raise exception 'No balance left for %. Do not serve; send them to the mess office', v_name; end if;

  v_res := public._charge_meal(v_acct, ps.meal_type_id, ps.meal_date, p_now, null, 'qr', p_actor);
  if (v_res ->> 'ok')::boolean is not true then
    raise exception 'Cannot serve: %', case v_res ->> 'error' when 'duplicate' then 'this meal is already recorded for ' || v_name || ' (e.g. fingerprint punch)' else v_res ->> 'error' end;
  end if;

  update meal_passes set status = 'redeemed', redeemed_at = p_now, redeemed_by = p_actor where id = ps.id;
  insert into audit_log (actor_id, action, entity, entity_id, details)
  values (p_actor, 'qr_redeemed', 'meal_passes', ps.id::text, jsonb_build_object('student_id', ps.student_id, 'meal', v_meal));
  -- staff see who/what, never the balance
  return jsonb_build_object('ok', true, 'student_name', v_name, 'roll_no', v_roll, 'meal', v_meal,
                            'low_balance', (v_res ->> 'balance_after_paise')::int < (v_res ->> 'rate_paise')::int);
end $$;

create or replace function public.redeem_pass(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Only mess staff can scan passes'; end if;
  return public._redeem_pass(p_token, auth.uid(), now());
end $$;

-- ───────── security ─────────
alter table meal_passes enable row level security;
create policy passes_select on meal_passes for select to authenticated using (student_id = auth.uid() or public.is_admin());

revoke all on meal_passes from anon, authenticated;
grant select on meal_passes to authenticated;
grant all on meal_passes to service_role;

-- Opt-ins can now only be written through set_meal_plan() so the cutoff cannot be bypassed.
drop policy opt_ins_write on opt_ins;
revoke insert, update, delete on opt_ins from authenticated;

revoke execute on function public.plan_status(timestamptz), public._set_meal_plan(uuid, jsonb, timestamptz),
  public.set_meal_plan(jsonb), public._redeem_pass(text, uuid, timestamptz), public.redeem_pass(text) from public, anon, authenticated;
grant execute on function public.plan_status(timestamptz), public._set_meal_plan(uuid, jsonb, timestamptz),
  public.set_meal_plan(jsonb), public._redeem_pass(text, uuid, timestamptz), public.redeem_pass(text) to service_role;
grant execute on function public.set_meal_plan(jsonb), public.redeem_pass(text) to authenticated;
-- plan_status() takes a clock argument, so expose a no-argument wrapper to users:
create or replace function public.my_plan_status() returns jsonb language sql stable security definer set search_path = public as
$$ select public.plan_status(now()) $$;
revoke execute on function public.my_plan_status() from public, anon;
grant execute on function public.my_plan_status() to authenticated, service_role;
