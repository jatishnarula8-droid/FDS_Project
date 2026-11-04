-- 0005_single_admin.sql — exactly one admin, identified by email.
-- The address may sign up even though it is outside the college domain, and becomes admin
-- ONLY after its email is confirmed (so nobody can claim it by signing up with someone else's address
-- while "Confirm email" is on). Keep "Confirm email" ENABLED in Supabase Auth settings.

insert into app_settings (key, value) values ('admin_email', 'jatishnarula8@gmail.com')
  on conflict (key) do update set value = excluded.value;

create or replace function public.enforce_email_domain() returns trigger
language plpgsql security definer set search_path = public as $$
declare d text; a text;
begin
  select value into d from app_settings where key = 'allowed_email_domain';
  select value into a from app_settings where key = 'admin_email';
  if a is not null and lower(coalesce(new.email, '')) = lower(a) then return new; end if;
  if d is not null and d <> '*' and lower(split_part(coalesce(new.email, ''), '@', 2)) <> lower(d) then
    raise exception 'Sign-ups are restricted to @% email addresses', d;
  end if;
  return new;
end $$;

create or replace function public.promote_configured_admin() returns trigger
language plpgsql security definer set search_path = public as $$
declare a text;
begin
  select value into a from app_settings where key = 'admin_email';
  if a is not null and new.email_confirmed_at is not null and lower(coalesce(new.email, '')) = lower(a) then
    update profiles set role = 'admin' where id = new.id and role <> 'admin';
  end if;
  return new;
end $$;

-- runs after b_handle_new_user (alphabetical trigger order), so the profile row exists
create trigger c_promote_configured_admin after insert or update of email_confirmed_at on auth.users
  for each row execute function public.promote_configured_admin();

-- Remove every other admin (e.g. any demo admin from an earlier seed).
update profiles set role = 'student'
 where role = 'admin'
   and id not in (select id from auth.users where lower(email) = lower((select value from app_settings where key = 'admin_email')));
update profiles p set role = 'admin'
  from auth.users u
 where u.id = p.id and u.email_confirmed_at is not null
   and lower(u.email) = lower((select value from app_settings where key = 'admin_email'));

revoke execute on function public.promote_configured_admin() from public, anon, authenticated;
