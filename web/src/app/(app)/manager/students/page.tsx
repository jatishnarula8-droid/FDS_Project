import { requireProfile } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/form';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { EmptyState, Flash } from '@/components/ui/states';
import { Badge } from '@/components/ui/badge';
import { enrolStudent, removeEnrolment } from '@/app/actions/staff';

export const metadata = { title: 'Students · MNIT Mess Portal' };

interface Row {
  id: string; full_name: string; roll_no: string | null; hostel: string | null; room_no: string | null;
  device_users: { id: string; device_user_id: string; device_id: string | null }[];
}

export default async function StudentsPage({ searchParams }: { searchParams: { q?: string; ok?: string; error?: string } }) {
  await requireProfile(['manager', 'admin']);
  const supabase = createClient();
  const q = (searchParams.q ?? '').trim().slice(0, 60).replace(/[%,()]/g, ' ');

  let query = supabase.from('profiles').select('id, full_name, roll_no, hostel, room_no, device_users(id, device_user_id, device_id)')
    .eq('role', 'student').order('full_name').limit(50);
  if (q) query = query.or(`full_name.ilike.%${q}%,roll_no.ilike.%${q}%,hostel.ilike.%${q}%`);
  const [{ data: students }, { data: devices }] = await Promise.all([query, supabase.from('devices').select('id, name').order('name')]);
  const deviceName = new Map((devices ?? []).map((d) => [d.id, d.name]));
  const rows = (students ?? []) as unknown as Row[];

  return (
    <>
      <PageHeader title="Students" description="Enrol a student by linking the PIN shown on the biometric machine to their profile." />
      <div className="mb-4 grid gap-3">
        <Flash ok={searchParams.ok} error={searchParams.error} />
        <form className="flex gap-2" role="search">
          <Input name="q" defaultValue={q} placeholder="Search name, roll number or hostel" aria-label="Search students" className="max-w-sm" />
          <Button type="submit" variant="secondary">Search</Button>
        </form>
      </div>
      <Card>
        <CardContent className="pt-4 sm:pt-6">
          {rows.length === 0 ? <EmptyState title="No students found" hint={q ? 'Try a different search.' : 'Students appear here after they sign up.'} /> : (
            <Table>
              <caption className="sr-only">Students and their machine PINs</caption>
              <THead><TR><TH>Student</TH><TH>Hostel / room</TH><TH>Machine PIN</TH><TH>Enrol a PIN</TH></TR></THead>
              <TBody>
                {rows.map((s) => (
                  <TR key={s.id}>
                    <TD><p className="font-medium">{s.full_name}</p><p className="text-xs text-muted-foreground">{s.roll_no ?? 'no roll no.'}</p></TD>
                    <TD className="whitespace-nowrap">{s.hostel ?? '—'}{s.room_no ? ` / ${s.room_no}` : ''}</TD>
                    <TD>
                      {s.device_users.length === 0 ? <Badge variant="warning">Not enrolled</Badge> : (
                        <ul className="grid gap-1">
                          {s.device_users.map((d) => (
                            <li key={d.id} className="flex items-center gap-2">
                              <span className="font-mono">{d.device_user_id}</span>
                              <span className="text-xs text-muted-foreground">{d.device_id ? deviceName.get(d.device_id) : 'all machines'}</span>
                              <form action={removeEnrolment}><input type="hidden" name="id" value={d.id} />
                                <button className="text-xs text-destructive underline-offset-4 hover:underline" type="submit" aria-label={`Remove PIN ${d.device_user_id} from ${s.full_name}`}>remove</button></form>
                            </li>
                          ))}
                        </ul>
                      )}
                    </TD>
                    <TD>
                      <form action={enrolStudent} className="flex flex-wrap items-center gap-1.5">
                        <input type="hidden" name="student_id" value={s.id} />
                        <Input name="device_user_id" inputMode="numeric" pattern="\d{1,9}" placeholder="PIN" aria-label={`PIN for ${s.full_name}`} className="h-9 w-20" required />
                        <Select name="device_id" aria-label="Machine" className="h-9 w-36"><option value="">All machines</option>
                          {(devices ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>
                        <Button type="submit" size="sm">Enrol</Button>
                      </form>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
          {rows.length === 50 && <p className="mt-2 text-xs text-muted-foreground">Showing the first 50. Narrow the search to see others.</p>}
        </CardContent>
      </Card>
    </>
  );
}
