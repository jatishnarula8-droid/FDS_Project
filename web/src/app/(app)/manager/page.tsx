import { requireProfile, getMealTypes } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDate, todayIST } from '@/lib/time';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/form';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Flash } from '@/components/ui/states';
import { LiveFeed, type FeedRow } from '@/components/live-feed';
import { MealCountsChart } from '@/components/meal-counts-chart';
import { setCooked } from '@/app/actions/staff';

export const metadata = { title: 'Live · MNIT Mess Portal' };

export default async function ManagerHome({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  await requireProfile(['manager', 'admin']);
  const supabase = createClient();
  const today = todayIST();
  const meals = await getMealTypes();

  const [{ data: feed }, { data: events }, { data: opts }, { data: cooked }] = await Promise.all([
    supabase.from('punches')
      .select('id, punched_at, status, device_user_id, needs_review, profiles(full_name, roll_no), devices(name), meal_types(name)')
      .order('punched_at', { ascending: false }).limit(30),
    supabase.from('meal_events').select('meal_type_id').eq('meal_date', today).limit(10000),
    supabase.from('opt_ins').select('meal_type_id').eq('meal_date', today).eq('will_eat', true).limit(10000),
    supabase.from('meal_cooked').select('meal_type_id, cooked_count').eq('meal_date', today),
  ]);

  const tally = (rows: { meal_type_id: string }[] | null) => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) m.set(r.meal_type_id, (m.get(r.meal_type_id) ?? 0) + 1);
    return m;
  };
  const eaten = tally(events), opted = tally(opts);
  const cookedBy = new Map((cooked ?? []).map((c) => [c.meal_type_id, c.cooked_count as number]));
  const rows = meals.map((m) => ({ meal: m.name, id: m.id, eaten: eaten.get(m.id) ?? 0, optedIn: opted.get(m.id) ?? 0, cooked: cookedBy.get(m.id) ?? 0 }));

  return (
    <>
      <PageHeader title="Live mess" description={fmtDate(today)} />
      <div className="mb-4"><Flash ok={searchParams.ok} error={searchParams.error} /></div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Today: punched vs opted-in vs cooked</CardTitle><CardDescription>&quot;Punched&quot; counts each student once per meal.</CardDescription></CardHeader>
          <CardContent className="grid gap-4">
            <MealCountsChart data={rows} />
            <Table>
              <caption className="sr-only">Counts per meal today</caption>
              <THead><TR><TH>Meal</TH><TH className="text-right">Opted in</TH><TH className="text-right">Punched</TH><TH>Cooked</TH></TR></THead>
              <TBody>
                {rows.map((r) => (
                  <TR key={r.id}>
                    <TD className="font-medium">{r.meal}</TD>
                    <TD className="text-right tabular-nums">{r.optedIn}</TD>
                    <TD className="text-right tabular-nums">{r.eaten}</TD>
                    <TD>
                      <form action={setCooked} className="flex items-center gap-1.5">
                        <input type="hidden" name="meal_type_id" value={r.id} />
                        <Input name="cooked_count" type="number" min={0} defaultValue={r.cooked || ''} aria-label={`${r.meal} portions cooked`} className="h-9 w-20" />
                        <Button type="submit" size="sm" variant="secondary">Save</Button>
                      </form>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Punch feed</CardTitle></CardHeader>
          <CardContent><LiveFeed initial={(feed ?? []) as unknown as FeedRow[]} /></CardContent>
        </Card>
      </div>
    </>
  );
}
