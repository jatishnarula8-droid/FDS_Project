import { requireProfile, getActiveSemester } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { formatINR } from '@/lib/format';
import { fmtDate, fmtTime, todayIST } from '@/lib/time';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/form';
import { Badge } from '@/components/ui/badge';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { EmptyState, Flash } from '@/components/ui/states';
import { Scanner } from '@/components/scanner';
import { setMoneyLeft } from '@/app/actions/admin';

export const metadata = { title: 'Admin · MNIT Mess Portal' };

interface Student { id: string; full_name: string; roll_no: string | null; email: string | null; phone: string | null }
interface Scan { id: string; eaten_at: string; meal_types: { name: string } | null; profiles: { full_name: string; roll_no: string | null } | null }

/** The admin panel: scan QRs, see today's scans, and edit each student's money left. Admin sign-in required. */
export default async function AdminHome({ searchParams }: { searchParams: { q?: string; day?: string; ok?: string; error?: string } }) {
  await requireProfile(['admin']);
  const supabase = createClient();
  const sem = await getActiveSemester();
  const today = todayIST();
  const day = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.day ?? '') ? searchParams.day! : today;
  const q = (searchParams.q ?? '').trim().slice(0, 60).replace(/[%,()]/g, ' ');

  let students = supabase.from('profiles').select('id, full_name, roll_no, email, phone').eq('role', 'student').order('full_name').limit(100);
  if (q) students = students.or(`full_name.ilike.%${q}%,roll_no.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%`);

  const [{ data: studs }, { data: bal }, { data: scans }] = await Promise.all([
    students,
    sem ? supabase.from('v_student_balance').select('student_id, balance_paise').eq('semester_id', sem.id) : Promise.resolve({ data: [] }),
    supabase.from('meal_events').select('id, eaten_at, meal_types(name), profiles(full_name, roll_no)').eq('source', 'qr').eq('meal_date', day)
      .order('eaten_at', { ascending: false }).limit(300),
  ]);
  const left = new Map((bal ?? []).map((b: { student_id: string; balance_paise: number }) => [b.student_id, b.balance_paise]));
  const scanRows = (scans ?? []) as unknown as Scan[];

  return (
    <>
      <PageHeader title="Admin panel" description={sem ? `${sem.name} · all amounts in ₹` : 'No active semester: create one under Setup.'} />
      <div className="mb-4"><Flash ok={searchParams.ok} error={searchParams.error} /></div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,420px)_1fr]">
        <Card>
          <CardHeader><CardTitle>Scan QR</CardTitle><CardDescription>Scan a student&apos;s pass to serve the meal and deduct its rate.</CardDescription></CardHeader>
          <CardContent><Scanner /></CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>Scans on {fmtDate(day)} <Badge variant="secondary" className="ml-1 align-middle">{scanRows.length}</Badge></CardTitle>
              <form className="flex items-center gap-2" action="/admin">
                <Input type="date" name="day" defaultValue={day} max={today} aria-label="Day" className="h-9 w-40" />
                <input type="hidden" name="q" value={q} />
                <Button type="submit" size="sm" variant="secondary">Show</Button>
              </form>
            </div>
          </CardHeader>
          <CardContent>
            {scanRows.length === 0 ? <EmptyState title="No QR scans on this day" /> : (
              <div className="max-h-[420px] overflow-y-auto">
                <Table>
                  <caption className="sr-only">QR scans</caption>
                  <THead><TR><TH>Time</TH><TH>Student</TH><TH>Meal</TH></TR></THead>
                  <TBody>{scanRows.map((s) => (
                    <TR key={s.id}><TD className="whitespace-nowrap">{fmtTime(s.eaten_at)}</TD>
                      <TD>{s.profiles?.full_name} <span className="text-xs text-muted-foreground">{s.profiles?.roll_no}</span></TD><TD>{s.meal_types?.name}</TD></TR>))}</TBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Students</CardTitle>
          <CardDescription>Edit &quot;Money left&quot; and press Save. The change is recorded in the ledger and the audit log; each scanned meal reduces it automatically.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <form className="flex gap-2" role="search" action="/admin">
            <Input name="q" defaultValue={q} placeholder="Search name, ID, email or phone" aria-label="Search students" className="max-w-sm" />
            <Button type="submit" variant="secondary">Search</Button>
          </form>
          {((studs ?? []) as Student[]).length === 0 ? <EmptyState title="No students found" hint="Students appear here after they sign up." /> : (
            <Table>
              <caption className="sr-only">Students</caption>
              <THead><TR><TH>Name</TH><TH>ID</TH><TH>Email</TH><TH>Phone</TH><TH>Money left (₹)</TH></TR></THead>
              <TBody>{((studs ?? []) as Student[]).map((s) => {
                const p = left.get(s.id);
                return (
                  <TR key={s.id}>
                    <TD className="whitespace-nowrap font-medium">{s.full_name}</TD>
                    <TD className="whitespace-nowrap">{s.roll_no ?? '—'}</TD>
                    <TD className="text-xs">{s.email}</TD>
                    <TD className="whitespace-nowrap">{s.phone ?? '—'}</TD>
                    <TD>
                      <form action={setMoneyLeft} className="flex items-center gap-1.5">
                        <input type="hidden" name="student_id" value={s.id} /><input type="hidden" name="q" value={q} />
                        <Input name="amount" inputMode="decimal" required defaultValue={p === undefined ? '' : (p / 100).toFixed(2)} placeholder="0.00"
                          aria-label={`Money left for ${s.full_name}`} className="h-9 w-28" />
                        <Button type="submit" size="sm">Save</Button>
                        {p !== undefined && <span className="sr-only">{formatINR(p)}</span>}
                      </form>
                    </TD>
                  </TR>
                );
              })}</TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
