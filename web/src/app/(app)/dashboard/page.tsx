import Link from 'next/link';
import { requireProfile, getActiveSemester } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { formatINR } from '@/lib/format';
import { projectRefund } from '@/lib/projection';
import { fmtDateTime, todayIST, TZ } from '@/lib/time';
import { formatInTimeZone } from 'date-fns-tz';
import type { Balance } from '@/lib/types';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState, Flash } from '@/components/ui/states';
import { BalanceRing } from '@/components/balance-ring';
import { BalanceChart, type BalancePoint } from '@/components/balance-chart';

export const metadata = { title: 'Wallet · MNIT Mess Portal' };
const DIET: Record<string, string> = { veg: 'Vegetarian', non_veg: 'Non-vegetarian', egg: 'Eggetarian', jain: 'Jain' };

export default async function Dashboard({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  const profile = await requireProfile(['student']);
  const supabase = createClient();
  const sem = await getActiveSemester();

  const { data: bal } = sem
    ? await supabase.from('v_student_balance').select('*').eq('student_id', profile.id).eq('semester_id', sem.id).maybeSingle()
    : { data: null };
  const b = bal as Balance | null;

  const [{ data: ledger }, { data: recent }] = b
    ? await Promise.all([
        supabase.from('refund_ledger').select('amount_paise, created_at').eq('student_account_id', b.student_account_id).order('created_at'),
        supabase.from('meal_events').select('id, meal_date, eaten_at, rate_paise, meal_types(name)').eq('student_id', profile.id)
          .order('eaten_at', { ascending: false }).limit(5),
      ])
    : [{ data: [] }, { data: [] }];

  // cumulative balance, one point per IST day
  const points: BalancePoint[] = [];
  let run = 0;
  for (const row of (ledger ?? []) as { amount_paise: number; created_at: string }[]) {
    run += row.amount_paise;
    const day = formatInTimeZone(new Date(row.created_at), TZ, 'd MMM');
    if (points.length && points[points.length - 1].date === day) points[points.length - 1].balance = run / 100;
    else points.push({ date: day, balance: run / 100 });
  }

  const proj = b && sem ? projectRefund({
    balancePaise: b.balance_paise, deductedPaise: b.deducted_paise,
    semesterStart: sem.starts_on, semesterEnd: sem.ends_on, today: todayIST(),
  }) : null;

  return (
    <>
      <PageHeader title={`Hello, ${profile.full_name.split(' ')[0]}`} description={sem ? sem.name : undefined} />
      <div className="mb-4"><Flash ok={searchParams.ok} error={searchParams.error} /></div>

      {!b ? (
        <EmptyState title="No mess fee recorded yet" hint="Once mess administration records your fee for this semester, your wallet will appear here. If you have paid, please contact the mess office." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle>Refund wallet</CardTitle>
              <CardDescription>Starts at what you paid; each meal you eat takes off that meal&apos;s rate.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5">
              <BalanceRing balancePaise={b.balance_paise} paidPaise={b.amount_paid_paise} />
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Paid" value={formatINR(b.amount_paid_paise)} />
                <Stat label="Deducted so far" value={formatINR(b.deducted_paise)} />
                <Stat label="Meals eaten" value={String(b.meals_eaten)} />
                <Stat label="Avg per day" value={proj ? formatINR(proj.dailyAvgPaise) : '—'} />
              </dl>
              {proj && (
                <div className="rounded-md bg-accent p-3 text-sm text-accent-foreground">
                  <p className="font-medium">Projected refund at semester end: {formatINR(proj.projectedPaise)} <Badge variant="warning" className="ml-1 align-middle">proposed — pending approval</Badge></p>
                  <p className="mt-1 text-xs opacity-80">If you keep eating at your current pace for the remaining {proj.daysLeft} days. This is an estimate; mess administration reviews and approves final refunds.</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Balance over time</CardTitle></CardHeader>
            <CardContent>
              {points.length > 1 ? <BalanceChart data={points} /> : <p className="text-sm text-muted-foreground">The chart appears after your first meal.</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between"><CardTitle>Latest meals</CardTitle><Link href="/meals" className="text-sm text-primary underline-offset-4 hover:underline">See all</Link></CardHeader>
            <CardContent>
              {(recent ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No meals yet.</p> : (
                <ul className="divide-y">
                  {(recent as unknown as { id: string; eaten_at: string; rate_paise: number; meal_types: { name: string } | null }[]).map((m) => (
                    <li key={m.id} className="flex items-center justify-between py-2 text-sm">
                      <span><span className="font-medium">{m.meal_types?.name}</span> <span className="text-muted-foreground">· {fmtDateTime(m.eaten_at)}</span></span>
                      <span className="tabular-nums">−{formatINR(m.rate_paise)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <Card className="mt-4">
        <CardHeader><CardTitle>Your profile</CardTitle></CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
            <Stat label="Name" value={profile.full_name} />
            <Stat label="Roll number" value={profile.roll_no ?? '—'} />
            <Stat label="Hostel" value={profile.hostel ?? '—'} />
            <Stat label="Room" value={profile.room_no ?? '—'} />
            <Stat label="Diet" value={DIET[profile.diet_type] ?? profile.diet_type} />
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">No fingerprint or face data is stored here. It stays on the machine.</p>
        </CardContent>
      </Card>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (<div><dt className="text-xs text-muted-foreground">{label}</dt><dd className="font-medium">{value}</dd></div>);
}
