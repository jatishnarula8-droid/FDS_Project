-- The four meal types and placeholder windows must exist in every project, not only when the demo seed is loaded.
-- Without them the "Tomorrow's meals" page has nothing to show.
insert into meal_types (code, name) values
  ('breakfast', 'Breakfast'), ('lunch', 'Lunch'), ('snacks', 'Snacks'), ('dinner', 'Dinner')
on conflict (code) do nothing;

insert into meal_windows (meal_type_id, start_time, end_time, is_placeholder)
select t.id, w.s, w.e, true
from meal_types t
join (values
  ('breakfast'::meal_code, time '07:30', time '09:30'),
  ('lunch',               time '12:00', time '14:30'),
  ('snacks',              time '17:00', time '18:30'),
  ('dinner',              time '19:30', time '21:30')
) w(code, s, e) on w.code = t.code
on conflict (meal_type_id) do nothing;
