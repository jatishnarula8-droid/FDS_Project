-- seed.sql — DEMO DATA ONLY. Do not run against a production project with real students.
-- Creates: meal types, placeholder windows & rates, an active demo semester, 2 devices,
-- 1 admin + 1 manager + 30 fake students (password for all demo logins: demo1234),
-- two weeks of fake punches processed through the real ingest_punch() function.

select setseed(0.42);

-- ───────── meal types, windows (PLACEHOLDERS — admin must confirm) ─────────
insert into meal_types (code, name) values
  ('breakfast', 'Breakfast'), ('lunch', 'Lunch'), ('snacks', 'Snacks'), ('dinner', 'Dinner');

insert into meal_windows (meal_type_id, start_time, end_time, is_placeholder)
select id, s, e, true from meal_types t join (values
  ('breakfast'::meal_code, time '07:30', time '09:30'),
  ('lunch',               time '12:00', time '14:30'),
  ('snacks',              time '17:00', time '18:30'),
  ('dinner',              time '19:30', time '21:30')
) w(code, s, e) on w.code = t.code;

-- ───────── demo semester + PLACEHOLDER per-meal rates (paise) ─────────
insert into semesters (name, starts_on, ends_on, is_active)
values ('Demo Semester', current_date - 30, current_date + 90, true);

insert into meal_rates (semester_id, meal_type_id, rate_paise)
select (select id from semesters where is_active), t.id, r.rate
from meal_types t join (values
  ('breakfast'::meal_code, 3000), ('lunch', 6500), ('snacks', 2000), ('dinner', 6500)
) r(code, rate) on r.code = t.code;

-- ───────── devices (serials match the bridge's mock config) ─────────
insert into devices (name, location, device_serial, ip_address, last_seen_at) values
  ('Mess 7 Counter 1', 'Mess 7 entrance, left',  'MOCK-DEV-001', '192.168.1.201', now()),
  ('Mess 7 Counter 2', 'Mess 7 entrance, right', 'MOCK-DEV-002', '192.168.1.202', now());

-- ───────── users (local/demo only: direct insert into auth.users) ─────────
create temp table _names (n int, name text);
insert into _names values
 (1,'Aarav Sharma'),(2,'Vivaan Gupta'),(3,'Aditya Verma'),(4,'Vihaan Singh'),(5,'Arjun Mehta'),
 (6,'Sai Reddy'),(7,'Reyansh Jain'),(8,'Ayaan Khan'),(9,'Krishna Yadav'),(10,'Ishaan Agarwal'),
 (11,'Ananya Joshi'),(12,'Diya Patel'),(13,'Saanvi Rao'),(14,'Myra Kapoor'),(15,'Aadhya Nair'),
 (16,'Kabir Malhotra'),(17,'Rohan Bansal'),(18,'Nikhil Chauhan'),(19,'Pranav Mishra'),(20,'Tanmay Saxena'),
 (21,'Riya Choudhary'),(22,'Kavya Shekhawat'),(23,'Meera Pandey'),(24,'Harsh Rathore'),(25,'Devansh Soni'),
 (26,'Yash Tiwari'),(27,'Shreya Bhatt'),(28,'Manav Goyal'),(29,'Neha Kulkarni'),(30,'Dev Rajput');

create temp table _users (email text, full_name text, roll_no text, hostel text, room_no text, id uuid default gen_random_uuid());
insert into _users (email, full_name) values ('admin@mnit.ac.in', 'Demo Admin'), ('manager@mnit.ac.in', 'Demo Mess Manager');
insert into _users (email, full_name, roll_no, hostel, room_no)
select format('student%s@mnit.ac.in', lpad(n::text, 2, '0')), name, '2023UCP' || (1000 + n),
       (array['Hostel A','Hostel B','Hostel C'])[1 + n % 3], (100 + n)::text
from _names;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                        confirmation_token, recovery_token, email_change_token_new, email_change)
select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', email,
       extensions.crypt('demo1234', extensions.gen_salt('bf')), now(),
       '{"provider":"email","providers":["email"]}'::jsonb,
       jsonb_build_object('full_name', full_name, 'roll_no', roll_no, 'hostel', hostel, 'room_no', room_no),
       now(), now(), '', '', '', ''
from _users;

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), id, id::text, jsonb_build_object('sub', id::text, 'email', email), 'email', now(), now(), now()
from _users;

update profiles set role = 'admin',   consented_at = now() where id = (select id from _users where email = 'admin@mnit.ac.in');
update profiles set role = 'manager', consented_at = now() where id = (select id from _users where email = 'manager@mnit.ac.in');
update profiles set consented_at = now(), diet_type = (array['veg','non_veg','veg','egg']::diet_type[])[1 + (random()*3)::int]
 where role = 'student';

-- ───────── accounts (₹25,000 placeholder fee; student 30 paid only ₹500 to demo balance_exhausted) ─────────
insert into student_accounts (student_id, semester_id, amount_paid_paise)
select p.id, (select id from semesters where is_active),
       case when p.roll_no = '2023UCP1030' then 50000 else 2500000 end
from profiles p where p.role = 'student';

-- ───────── PIN mapping: PIN 1001..1030 valid on every device ─────────
insert into device_users (student_id, device_id, device_user_id)
select id, null, right(roll_no, 4) from profiles where role = 'student';

-- ───────── two weeks of fake punches, via the real ingest_punch() ─────────
do $$
declare
  s record; m record; d date; v_at timestamptz; p numeric; dev text;
begin
  for d in select (current_date - g)::date from generate_series(14, 1, -1) g loop
    for s in select pr.roll_no, right(pr.roll_no, 4) as pin, right(pr.roll_no, 2)::int as k
               from profiles pr where pr.role = 'student' loop
      for m in select mt.code, w.start_time, w.end_time
                 from meal_types mt join meal_windows w on w.meal_type_id = mt.id loop
        p := case m.code when 'breakfast' then 0.30 when 'lunch' then 0.85 when 'snacks' then 0.45 else 0.80 end
             + (s.k % 5) * 0.03;
        if s.k = 30 then p := 0.95; end if;  -- heavy eater on a small balance
        if random() < p then
          v_at := ((d + m.start_time) + random() * (m.end_time - m.start_time)) at time zone 'Asia/Kolkata';
          dev  := case when random() < 0.5 then 'MOCK-DEV-001' else 'MOCK-DEV-002' end;
          perform ingest_punch(dev, s.pin, v_at, 1, '{"seed":true}', v_at + interval '1 second');
          if random() < 0.04 then   -- accidental double punch
            perform ingest_punch(dev, s.pin, v_at + interval '3 minutes', 1, '{"seed":true}', v_at + interval '3 minutes 1 second');
          end if;
        end if;
      end loop;
    end loop;
    -- a stranger's PIN and an off-hours punch every day
    perform ingest_punch('MOCK-DEV-001', '9999', (d + time '12:30') at time zone 'Asia/Kolkata', 1, '{"seed":true}', (d + time '12:30') at time zone 'Asia/Kolkata');
    perform ingest_punch('MOCK-DEV-002', '1003', (d + time '23:15') at time zone 'Asia/Kolkata', 1, '{"seed":true}', (d + time '23:15') at time zone 'Asia/Kolkata');
  end loop;
end $$;

-- ───────── ratings (dinner scores lowest, as in the survey), opt-ins, cooked counts, disputes ─────────
insert into meal_ratings (student_id, meal_date, meal_type_id, rating)
select e.student_id, e.meal_date, e.meal_type_id,
       greatest(1, least(5, round(case t.code when 'dinner' then 2.6 when 'breakfast' then 3.4 else 3.8 end + (random() - 0.5) * 3)::int))
from meal_events e join meal_types t on t.id = e.meal_type_id
where random() < 0.35;

insert into opt_ins (student_id, meal_date, meal_type_id, will_eat)
select p.id, current_date, t.id, random() < 0.8
from profiles p cross join meal_types t where p.role = 'student' and random() < 0.7;

insert into meal_cooked (meal_date, meal_type_id, cooked_count)
select current_date, id, case code when 'breakfast' then 15 when 'lunch' then 28 when 'snacks' then 18 else 27 end
from meal_types;

insert into disputes (student_id, kind, meal_date, meal_type_id, message)
select (select id from profiles where roll_no = '2023UCP1003'), 'missing_punch', current_date - 2,
       (select id from meal_types where code = 'dinner'), 'I had dinner but the machine showed an error and did not register.';
insert into disputes (student_id, kind, meal_date, meal_type_id, message)
select e.student_id, 'wrong_charge', e.meal_date, e.meal_type_id, 'I was charged but I was at home that day.'
from meal_events e join profiles p on p.id = e.student_id
where p.roll_no = '2023UCP1005' order by e.meal_date desc limit 1;
