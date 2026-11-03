import { requireProfile } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDate, fmtDateTime } from '@/lib/time';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/form';
import { StatusBadge } from '@/components/ui/badge';
import { EmptyState, Flash } from '@/components/ui/states';
import { resolveDispute } from '@/app/actions/staff';

export const metadata = { title: 'Disputes · MNIT Mess Portal' };

interface D {
  id: string; kind: string; meal_date: string; message: string; status: string; created_at: string; resolution_note: string | null;
  profiles: { full_name: string; roll_no: string | null } | null; meal_types: { name: string } | null;
}
const SELECT = 'id, kind, meal_date, message, status, created_at, resolution_note, profiles!disputes_student_id_fkey(full_name, roll_no), meal_types(name)';

export default async function ManagerDisputes({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  await requireProfile(['manager', 'admin']);
  const supabase = createClient();
  const [{ data: open }, { data: closed }] = await Promise.all([
    supabase.from('disputes').select(SELECT).eq('status', 'open').order('created_at'),
    supabase.from('disputes').select(SELECT).neq('status', 'open').order('created_at', { ascending: false }).limit(15),
  ]);

  return (
    <>
      <PageHeader title="Dispute queue" description="Approving a dispute writes to the ledger and the audit log. A reason is required for either decision." />
      <div className="mb-4"><Flash ok={searchParams.ok} error={searchParams.error} /></div>
      <div className="grid gap-4">
        {((open ?? []) as unknown as D[]).length === 0 ? <EmptyState title="No open disputes" hint="Nice. Everything is resolved." /> :
          ((open ?? []) as unknown as D[]).map((d) => (
            <Card key={d.id}>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle>{d.profiles?.full_name} <span className="text-sm font-normal text-muted-foreground">{d.profiles?.roll_no}</span></CardTitle>
                  <StatusBadge status="open" />
                </div>
                <p className="text-sm text-muted-foreground">
                  {d.kind === 'missing_punch' ? 'Says they ate, but the punch did not register' : 'Says they were charged for a meal they did not eat'} · {d.meal_types?.name} on {fmtDate(d.meal_date)} · raised {fmtDateTime(d.created_at)}
                </p>
              </CardHeader>
              <CardContent className="grid gap-3">
                <blockquote className="rounded-md bg-muted p-3 text-sm">{d.message}</blockquote>
                <form action={resolveDispute} className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                  <input type="hidden" name="id" value={d.id} />
                  <Input name="note" required minLength={3} maxLength={500} placeholder="Reason for your decision (required)" aria-label="Reason for your decision" />
                  <Button type="submit" name="decision" value="approve">Approve</Button>
                  <Button type="submit" name="decision" value="reject" variant="outline">Reject</Button>
                </form>
                <p className="text-xs text-muted-foreground">
                  {d.kind === 'missing_punch' ? 'Approve = record the missing meal and deduct its rate.' : 'Approve = credit the meal rate back to the student.'}
                </p>
              </CardContent>
            </Card>
          ))}

        {((closed ?? []) as unknown as D[]).length > 0 && (
          <Card>
            <CardHeader><CardTitle>Recently resolved</CardTitle></CardHeader>
            <CardContent>
              <ul className="divide-y">
                {((closed ?? []) as unknown as D[]).map((d) => (
                  <li key={d.id} className="grid gap-0.5 py-2 text-sm">
                    <div className="flex items-center justify-between gap-2"><span>{d.profiles?.full_name} · {d.meal_types?.name} · {fmtDate(d.meal_date)}</span><StatusBadge status={d.status} kind="dispute" /></div>
                    <p className="text-xs text-muted-foreground">{d.resolution_note}</p>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
