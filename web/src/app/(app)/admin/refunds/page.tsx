import Link from 'next/link';
import { Download } from 'lucide-react';
import { requireProfile } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { formatINR } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { Select } from '@/components/ui/form';
import { StatusBadge } from '@/components/ui/badge';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { EmptyState, Flash } from '@/components/ui/states';
import { approveAllRefunds, approveRefund, closeSemester } from '@/app/actions/admin';

export const metadata = { title: 'Refunds · MNIT Mess Portal' };

interface R {
  student_account_id: string; full_name: string; roll_no: string | null; hostel: string | null;
  amount_paid_paise: number; deducted_paise: number; meals_eaten: number; balance_paise: number;
  proposal_id: string | null; proposed_paise: number | null; proposal_status: 'proposed' | 'approved' | null;
}

export default async function RefundsPage({ searchParams }: { searchParams: { semester?: string; hostel?: string; ok?: string; error?: string } }) {
  await requireProfile(['admin']);
  const supabase = createClient();
  const { data: sems } = await supabase.from('semesters').select('id, name, is_active').order('starts_on', { ascending: false });
  const sem = (sems ?? []).find((s) => s.id === searchParams.semester) ?? (sems ?? []).find((s) => s.is_active) ?? (sems ?? [])[0];
  if (!sem) return <EmptyState title="No semesters yet" hint="Create one under Setup." />;

  const { data } = await supabase.from('v_refund_report').select('*').eq('semester_id', sem.id).order('hostel').order('full_name').limit(5000);
  const all = (data ?? []) as R[];
  const hostels = [...new Set(all.map((r) => r.hostel ?? '(none)'))].sort();
  const rows = searchParams.hostel ? all.filter((r) => (r.hostel ?? '(none)') === searchParams.hostel) : all;

  const money = (r: R) => (r.proposal_status ? r.proposed_paise ?? 0 : r.balance_paise);
  const byHostel = hostels.map((h) => {
    const list = all.filter((r) => (r.hostel ?? '(none)') === h);
    return { h, n: list.length, paid: sum(list, (r) => r.amount_paid_paise), spent: sum(list, (r) => r.deducted_paise), refund: sum(list, money) };
  });
  const pending = all.filter((r) => r.proposal_status === 'proposed').length;
  const hasProposals = all.some((r) => r.proposal_id);
  const exportHref = `/api/refunds/export?semester=${sem.id}${searchParams.hostel ? `&hostel=${encodeURIComponent(searchParams.hostel)}` : ''}`;

  return (
    <>
      <PageHeader title="Refund report" description="Every amount here is a proposal. The system never moves money; approval records the admin's sign-off in the ledger."
        actions={<Link href={exportHref} className={buttonVariants({ variant: 'outline' })}><Download className="h-4 w-4" aria-hidden />Export CSV</Link>} />
      <div className="mb-4 grid gap-3"><Flash ok={searchParams.ok} error={searchParams.error} /></div>

      <form className="mb-4 flex flex-wrap items-end gap-2" action="/admin/refunds">
        <div className="grid gap-1"><label htmlFor="semester" className="text-xs text-muted-foreground">Semester</label>
          <Select id="semester" name="semester" defaultValue={sem.id} className="w-56">{(sems ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}{s.is_active ? ' (active)' : ''}</option>)}</Select></div>
        <div className="grid gap-1"><label htmlFor="hostel" className="text-xs text-muted-foreground">Hostel</label>
          <Select id="hostel" name="hostel" defaultValue={searchParams.hostel ?? ''} className="w-44"><option value="">All hostels</option>{hostels.map((h) => <option key={h}>{h}</option>)}</Select></div>
        <Button type="submit" variant="secondary">Apply</Button>
      </form>

      <div className="grid gap-4">
        <Card>
          <CardHeader><CardTitle>Semester close &amp; approval</CardTitle>
            <CardDescription>{hasProposals ? `${pending} proposal(s) awaiting approval.` : sem.is_active ? 'Closing the semester stops charging meals and creates a proposed refund (remaining balance) for every student.' : 'This semester is not active and has no proposals yet.'}</CardDescription></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {!hasProposals && (
              <form action={closeSemester}><input type="hidden" name="semester_id" value={sem.id} />
                <Button type="submit" variant="destructive">Close semester &amp; create proposals</Button></form>)}
            {pending > 0 && (
              <form action={approveAllRefunds}><input type="hidden" name="semester_id" value={sem.id} />
                <Button type="submit">Approve all {pending} proposed</Button></form>)}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>By hostel</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <caption className="sr-only">Refund totals by hostel</caption>
              <THead><TR><TH>Hostel</TH><TH className="text-right">Students</TH><TH className="text-right">Paid</TH><TH className="text-right">Spent</TH><TH className="text-right">Proposed refund</TH></TR></THead>
              <TBody>{byHostel.map((h) => (
                <TR key={h.h}><TD className="font-medium">{h.h}</TD><TD className="text-right tabular-nums">{h.n}</TD><TD className="text-right tabular-nums">{formatINR(h.paid)}</TD>
                  <TD className="text-right tabular-nums">{formatINR(h.spent)}</TD><TD className="text-right tabular-nums">{formatINR(h.refund)}</TD></TR>))}</TBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Per student</CardTitle></CardHeader>
          <CardContent>
            {rows.length === 0 ? <EmptyState title="No student accounts for this selection" /> : (
              <Table>
                <caption className="sr-only">Per-student refund report</caption>
                <THead><TR><TH>Student</TH><TH>Hostel</TH><TH className="text-right">Paid</TH><TH className="text-right">Meals</TH><TH className="text-right">Spent</TH><TH className="text-right">Proposed refund</TH><TH>Status</TH><TH><span className="sr-only">Action</span></TH></TR></THead>
                <TBody>{rows.map((r) => (
                  <TR key={r.student_account_id}>
                    <TD><p className="font-medium">{r.full_name}</p><p className="text-xs text-muted-foreground">{r.roll_no}</p></TD>
                    <TD>{r.hostel ?? '—'}</TD>
                    <TD className="text-right tabular-nums">{formatINR(r.amount_paid_paise)}</TD>
                    <TD className="text-right tabular-nums">{r.meals_eaten}</TD>
                    <TD className="text-right tabular-nums">{formatINR(r.deducted_paise)}</TD>
                    <TD className="text-right font-medium tabular-nums">{formatINR(money(r))}</TD>
                    <TD>{r.proposal_status ? <StatusBadge status={r.proposal_status} /> : <span className="text-xs text-muted-foreground">Running balance</span>}</TD>
                    <TD>{r.proposal_status === 'proposed' && r.proposal_id && (
                      <form action={approveRefund}><input type="hidden" name="id" value={r.proposal_id} /><input type="hidden" name="semester_id" value={sem.id} />
                        <Button size="sm" type="submit" aria-label={`Approve refund for ${r.full_name}`}>Approve</Button></form>)}</TD>
                  </TR>))}</TBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

const sum = <T,>(list: T[], f: (x: T) => number) => list.reduce((s, x) => s + f(x), 0);
