import Link from 'next/link';
import { requireProfile, getMealTypes } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtClock, fmtDate, fmtTime, todayIST } from '@/lib/time';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState, Flash } from '@/components/ui/states';
import { QrPass } from '@/components/qr-pass';
import { rateMeal } from '@/app/actions/student';

export const metadata = { title: 'Today · MNIT Mess Portal' };

export default async function TodayPage({ searchParams }: { searchParams: { ok?: string; error?: string; day?: string } }) {
  const profile = await requireProfile(['student']);
  const supabase = createClient();
  const realToday = todayIST();
  const today = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.day ?? '') ? searchParams.day! : realToday;
  const isTomorrow = today > realToday;
  const meals = await getMealTypes();

  const [{ data: windows }, { data: passes }, { data: eaten }, { data: ratings }] = await Promise.all([
    supabase.from('meal_windows').select('meal_type_id, start_time, end_time'),
    supabase.from('meal_passes').select('meal_type_id, token, status, redeemed_at').eq('student_id', profile.id).eq('meal_date', today),
    supabase.from('meal_events').select('meal_type_id').eq('student_id', profile.id).eq('meal_date', today),
    supabase.from('meal_ratings').select('meal_type_id, rating').eq('student_id', profile.id).eq('meal_date', today),
  ]);
  const win = new Map((windows ?? []).map((w) => [w.meal_type_id, w]));
  const pass = new Map((passes ?? []).map((p) => [p.meal_type_id, p]));
  const ate = new Set((eaten ?? []).map((e) => e.meal_type_id));
  const rated = new Map((ratings ?? []).map((r) => [r.meal_type_id, r.rating]));
  const live = meals.filter((m) => pass.get(m.id)?.status === 'issued' || pass.get(m.id)?.status === 'redeemed' || ate.has(m.id));

  const [{ data: st }] = await Promise.all([
    supabase.rpc('my_plan_status'),
  ]);
  const tomorrow = (st as { target_date?: string })?.target_date;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PageHeader title={isTomorrow ? "Tomorrow's Passes (Preview)" : "Today's Passes"} description={`${fmtDate(today)} · show the QR to the mess staff to get your meal.`} />
        {tomorrow && (
          <div className="flex items-center gap-1.5 rounded-lg border bg-muted/30 p-1 text-xs">
            <Link href="/today" className={`rounded-md px-3 py-1.5 font-medium transition ${!isTomorrow ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
              Today
            </Link>
            <Link href={`/today?day=${tomorrow}`} className={`rounded-md px-3 py-1.5 font-medium transition ${isTomorrow ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
              Tomorrow (Preview)
            </Link>
          </div>
        )}
      </div>
      <div className="mb-4"><Flash ok={searchParams.ok} error={searchParams.error} /></div>
      {live.length === 0 ? (
        <EmptyState title={isTomorrow ? "No meals chosen for tomorrow" : "No meals planned for today"} hint={isTomorrow ? "Go to 'Plan tomorrow' to choose which meals you will eat." : "You choose a day ahead. Plan tomorrow's meals to get QR passes."} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {live.map((m) => {
            const p = pass.get(m.id);
            const w = win.get(m.id);
            const served = ate.has(m.id);
            const myRating = rated.get(m.id);
            return (
              <Card key={m.id}>
                <CardHeader>
                  <div className="flex items-center justify-between"><CardTitle>{m.name}</CardTitle>{served && <Badge variant="success">Served{p?.redeemed_at ? ` · ${fmtTime(p.redeemed_at)}` : ''}</Badge>}</div>
                  <CardDescription>{w ? `${fmtClock(w.start_time)} – ${fmtClock(w.end_time)}` : ''}</CardDescription>
                </CardHeader>
                <CardContent className="grid justify-items-start gap-3">
                  {p?.status === 'issued' && !served && (<><QrPass token={p.token} label={m.name} /><p className="text-xs text-muted-foreground">Show this to the mess staff. It works once.</p></>)}
                  {served && (
                    <div>
                      <p className="mb-1.5 text-sm font-medium" id={`rate-${m.code}`}>How was it?</p>
                      <div className="flex gap-1.5" role="group" aria-labelledby={`rate-${m.code}`}>
                        {[1, 2, 3, 4, 5].map((n) => (
                          <form key={n} action={rateMeal}>
                            <input type="hidden" name="meal_type_id" value={m.id} /><input type="hidden" name="rating" value={n} />
                            <Button type="submit" size="sm" variant={myRating === n ? 'default' : 'outline'} className="w-10 px-0" aria-pressed={myRating === n} aria-label={`${n} out of 5`}>{n}</Button>
                          </form>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
      <p className="mt-4 text-sm text-muted-foreground">Want to eat tomorrow? <Link href="/plan" className="text-primary underline-offset-4 hover:underline">Choose tomorrow&apos;s meals</Link>.</p>
    </>
  );
}
