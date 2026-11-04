import { requireProfile, getMealTypes } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtClock, fmtDate } from '@/lib/time';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Flash } from '@/components/ui/states';
import { savePlan } from '@/app/actions/student';

export const metadata = { title: "Tomorrow's meals · MNIT Mess Portal" };

export default async function PlanPage({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  const profile = await requireProfile(['student']);
  const supabase = createClient();
  const meals = await getMealTypes();
  const { data: st } = await supabase.rpc('my_plan_status');
  const status = st as { target_date: string; cutoff: string; open: boolean };

  const [{ data: opts }, { data: wins }] = await Promise.all([
    supabase.from('opt_ins').select('meal_type_id, will_eat').eq('student_id', profile.id).eq('meal_date', status.target_date),
    supabase.from('meal_windows').select('meal_type_id, start_time, end_time'),
  ]);
  const chosen = new Map((opts ?? []).map((o) => [o.meal_type_id, o.will_eat as boolean]));
  const win = new Map((wins ?? []).map((w) => [w.meal_type_id, w]));
  const answered = chosen.size === meals.length;

  return (
    <>
      <PageHeader title="Tomorrow's meals" description={`${fmtDate(status.target_date)} · answer before ${fmtClock(status.cutoff)} today`} />
      <div className="mb-4 grid gap-3">
        <Flash ok={searchParams.ok} error={searchParams.error} />
        {!status.open && (
          <p role="status" className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
            Planning for tomorrow closed at {fmtClock(status.cutoff)}. {answered ? 'Your answers are below.' : 'You did not answer in time, so you have no QR passes for tomorrow. Ask the mess office if you need one.'}
          </p>
        )}
      </div>

      <form action={savePlan}>
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle>Which meals will you eat?</CardTitle>
            <CardDescription>You get a QR pass for each &quot;Yes&quot;. The mess only serves students who show a pass, and each served meal is deducted from your balance.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {meals.map((m) => {
              const w = win.get(m.id);
              const cur = chosen.get(m.id);
              return (
                <fieldset key={m.id} disabled={!status.open} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
                  <legend className="sr-only">{m.name}</legend>
                  <div><p className="font-medium">{m.name}</p><p className="text-xs text-muted-foreground">{w ? `${fmtClock(w.start_time)} – ${fmtClock(w.end_time)}` : ''}</p></div>
                  <div className="flex gap-2">
                    {(['yes', 'no'] as const).map((v) => (
                      <label key={v} className="cursor-pointer">
                        <input type="radio" name={`meal_${m.code}`} value={v} required defaultChecked={cur === (v === 'yes')} className="peer sr-only" />
                        <span className="inline-flex min-h-10 min-w-16 items-center justify-center rounded-md border px-4 text-sm font-medium peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:opacity-60">
                          {v === 'yes' ? 'Yes' : 'No'}
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              );
            })}
            {status.open ? <Button type="submit" size="lg">{answered ? 'Update my plan' : 'Save my plan'}</Button> : (answered && <Badge variant="secondary" className="w-fit">Locked</Badge>)}
            <p className="text-xs text-muted-foreground">You can change your answers until {fmtClock(status.cutoff)}. Your QR passes show on the <strong>Today</strong> page on the day.</p>
          </CardContent>
        </Card>
      </form>
    </>
  );
}
