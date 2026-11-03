import { requireProfile, getMealTypes } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtClock, fmtDate, todayIST } from '@/lib/time';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Flash } from '@/components/ui/states';
import { Badge } from '@/components/ui/badge';
import { rateMeal, setOptIn } from '@/app/actions/student';

export const metadata = { title: 'Today · MNIT Mess Portal' };

export default async function TodayPage({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  const profile = await requireProfile(['student']);
  const supabase = createClient();
  const today = todayIST();
  const meals = await getMealTypes();

  const [{ data: windows }, { data: opts }, { data: eaten }, { data: ratings }] = await Promise.all([
    supabase.from('meal_windows').select('meal_type_id, start_time, end_time, active'),
    supabase.from('opt_ins').select('meal_type_id, will_eat').eq('student_id', profile.id).eq('meal_date', today),
    supabase.from('meal_events').select('meal_type_id').eq('student_id', profile.id).eq('meal_date', today),
    supabase.from('meal_ratings').select('meal_type_id, rating').eq('student_id', profile.id).eq('meal_date', today),
  ]);
  const win = new Map((windows ?? []).map((w) => [w.meal_type_id, w]));
  const opt = new Map((opts ?? []).map((o) => [o.meal_type_id, o.will_eat]));
  const ate = new Set((eaten ?? []).map((e) => e.meal_type_id));
  const rated = new Map((ratings ?? []).map((r) => [r.meal_type_id, r.rating]));

  return (
    <>
      <PageHeader title="Today" description={`${fmtDate(today)} · Tell the mess if you will eat, and rate meals you have had.`} />
      <div className="mb-4"><Flash ok={searchParams.ok} error={searchParams.error} /></div>
      <div className="grid gap-4 sm:grid-cols-2">
        {meals.map((m) => {
          const w = win.get(m.id);
          const choice = opt.get(m.id);
          const myRating = rated.get(m.id);
          return (
            <Card key={m.id}>
              <CardHeader>
                <div className="flex items-center justify-between"><CardTitle>{m.name}</CardTitle>{ate.has(m.id) && <Badge variant="success">Eaten</Badge>}</div>
                <CardDescription>{w ? `${fmtClock(w.start_time)} – ${fmtClock(w.end_time)}` : 'Time not set'}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div>
                  <p className="mb-1.5 text-sm font-medium" id={`optin-${m.code}`}>Will you eat?</p>
                  <div className="flex gap-2" role="group" aria-labelledby={`optin-${m.code}`}>
                    {[true, false].map((v) => (
                      <form key={String(v)} action={setOptIn}>
                        <input type="hidden" name="meal_type_id" value={m.id} /><input type="hidden" name="will_eat" value={String(v)} />
                        <Button type="submit" variant={choice === v ? 'default' : 'outline'} size="sm" aria-pressed={choice === v}>{v ? 'Yes' : 'No'}</Button>
                      </form>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-1.5 text-sm font-medium" id={`rate-${m.code}`}>How was it?</p>
                  {ate.has(m.id) ? (
                    <div className="flex gap-1.5" role="group" aria-labelledby={`rate-${m.code}`}>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <form key={n} action={rateMeal}>
                          <input type="hidden" name="meal_type_id" value={m.id} /><input type="hidden" name="rating" value={n} />
                          <Button type="submit" size="sm" variant={myRating === n ? 'default' : 'outline'} className="w-10 px-0" aria-pressed={myRating === n} aria-label={`${n} out of 5`}>{n}</Button>
                        </form>
                      ))}
                    </div>
                  ) : <p className="text-sm text-muted-foreground">You can rate after you have eaten this meal.</p>}
                  {myRating ? <p className="mt-1 text-xs text-muted-foreground">You rated {myRating}/5.</p> : null}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </>
  );
}
