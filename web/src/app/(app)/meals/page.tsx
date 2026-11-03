import Link from 'next/link';
import { requireProfile, getActiveSemester } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { formatINR } from '@/lib/format';
import { fmtDate, fmtTime, isMonth, monthBounds, todayIST } from '@/lib/time';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/form';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/states';
import { CalendarHeat } from '@/components/calendar-heat';

export const metadata = { title: 'Meal log · MNIT Mess Portal' };

const shiftMonth = (m: string, by: number) => {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

interface EventRow { id: string; meal_date: string; eaten_at: string; rate_paise: number; source: string; meal_types: { name: string; code: string } | null }

export default async function MealsPage({ searchParams }: { searchParams: { month?: string } }) {
  const profile = await requireProfile(['student']);
  const supabase = createClient();
  const today = todayIST();
  const month = isMonth(searchParams.month) ? searchParams.month : today.slice(0, 7);
  const { from, to } = monthBounds(month);
  const sem = await getActiveSemester();

  const { data: acct } = sem
    ? await supabase.from('student_accounts').select('id').eq('student_id', profile.id).eq('semester_id', sem.id).maybeSingle()
    : { data: null };

  const [{ data: events }, { data: ledger }] = await Promise.all([
    supabase.from('meal_events').select('id, meal_date, eaten_at, rate_paise, source, meal_types(name, code)')
      .eq('student_id', profile.id).gte('meal_date', from).lte('meal_date', to).order('eaten_at', { ascending: false }),
    acct
      ? supabase.from('refund_ledger').select('amount_paise, meal_event_id, created_at').eq('student_account_id', acct.id).order('created_at')
      : Promise.resolve({ data: [] as { amount_paise: number; meal_event_id: string | null }[] }),
  ]);

  // balance after each meal = running sum of the ledger up to and including that meal's deduction
  const after = new Map<string, number>();
  let run = 0;
  for (const l of (ledger ?? []) as { amount_paise: number; meal_event_id: string | null }[]) {
    run += l.amount_paise;
    if (l.meal_event_id) after.set(l.meal_event_id, run);
  }

  const rows = (events ?? []) as unknown as EventRow[];
  const counts: Record<string, number> = {};
  for (const e of rows) counts[e.meal_date] = (counts[e.meal_date] ?? 0) + 1;
  const total = rows.reduce((s, e) => s + e.rate_paise, 0);

  return (
    <>
      <PageHeader title="Meal log" description="Every meal you have eaten, with what was deducted." />
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <Link href={`/meals?month=${shiftMonth(month, -1)}`} className="rounded-md border px-3 py-2 text-sm" aria-label="Previous month">‹</Link>
        <form className="flex items-end gap-2" action="/meals">
          <div className="grid gap-1"><label htmlFor="month" className="text-xs text-muted-foreground">Month</label>
            <Input id="month" name="month" type="month" defaultValue={month} className="w-44" /></div>
          <Button type="submit" variant="secondary">Show</Button>
        </form>
        <Link href={`/meals?month=${shiftMonth(month, 1)}`} className="rounded-md border px-3 py-2 text-sm" aria-label="Next month">›</Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,360px)_1fr]">
        <Card>
          <CardHeader><CardTitle>{month} at a glance</CardTitle></CardHeader>
          <CardContent>
            {sem && <CalendarHeat month={month} counts={counts} today={today} semesterStart={sem.starts_on} semesterEnd={sem.ends_on} />}
            <p className="mt-3 text-sm"><span className="font-medium">{rows.length}</span> meals · <span className="font-medium">{formatINR(total)}</span> deducted this month</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Meals</CardTitle></CardHeader>
          <CardContent>
            {rows.length === 0 ? (
              <EmptyState title="No meals in this month" hint="If you ate but nothing shows, tap the day in the calendar to report a missed punch." />
            ) : (
              <Table>
                <caption className="sr-only">Meals eaten in {month}</caption>
                <THead><TR><TH>Date</TH><TH>Meal</TH><TH>Time</TH><TH className="text-right">Deducted</TH><TH className="text-right">Balance after</TH><TH><span className="sr-only">Actions</span></TH></TR></THead>
                <TBody>
                  {rows.map((e) => (
                    <TR key={e.id}>
                      <TD className="whitespace-nowrap">{fmtDate(e.meal_date)}</TD>
                      <TD>{e.meal_types?.name}{e.source === 'dispute' ? <span className="ml-1 text-xs text-muted-foreground">(added via dispute)</span> : null}</TD>
                      <TD className="whitespace-nowrap">{fmtTime(e.eaten_at)}</TD>
                      <TD className="text-right tabular-nums">−{formatINR(e.rate_paise)}</TD>
                      <TD className="text-right tabular-nums">{after.has(e.id) ? formatINR(after.get(e.id)!) : '—'}</TD>
                      <TD><Link className="text-xs text-primary underline-offset-4 hover:underline"
                        href={`/disputes?kind=wrong_charge&date=${e.meal_date}&meal=${e.meal_types?.code ?? ''}#new`}>Dispute</Link></TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
