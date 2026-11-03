import { requireProfile, getMealTypes } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/time';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { Badge } from '@/components/ui/badge';
import { Flash } from '@/components/ui/states';
import { activateSemester, createDevice, createSemester, importFees, saveRates, saveWindows } from '@/app/actions/admin';

export const metadata = { title: 'Setup · MNIT Mess Portal' };

export default async function AdminSetup({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  await requireProfile(['admin']);
  const supabase = createClient();
  const meals = await getMealTypes();
  const [{ data: sems }, { data: windows }] = await Promise.all([
    supabase.from('semesters').select('id, name, starts_on, ends_on, is_active').order('starts_on', { ascending: false }),
    supabase.from('meal_windows').select('id, meal_type_id, start_time, end_time, active, is_placeholder'),
  ]);
  const active = (sems ?? []).find((s) => s.is_active);
  const { data: rates } = active ? await supabase.from('meal_rates').select('meal_type_id, rate_paise').eq('semester_id', active.id) : { data: [] };
  const rateBy = new Map((rates ?? []).map((r) => [r.meal_type_id, r.rate_paise as number]));
  const winBy = new Map((windows ?? []).map((w) => [w.meal_type_id, w]));
  const rupees = (p?: number) => (p === undefined ? '' : (p / 100).toFixed(2));

  return (
    <>
      <PageHeader title="Setup" description="Semesters, per-meal rates, meal windows and student fees." />
      <div className="mb-4"><Flash ok={searchParams.ok} error={searchParams.error} /></div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Semesters</CardTitle><CardDescription>Only one can be active. Meals are charged against the active semester.</CardDescription></CardHeader>
          <CardContent className="grid gap-4">
            <ul className="divide-y text-sm">
              {(sems ?? []).map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span><span className="font-medium">{s.name}</span> <span className="text-muted-foreground">{fmtDate(s.starts_on)} → {fmtDate(s.ends_on)}</span></span>
                  {s.is_active ? <Badge variant="success">Active</Badge> : (
                    <form action={activateSemester}><input type="hidden" name="id" value={s.id} /><Button size="sm" variant="outline" type="submit">Make active</Button></form>)}
                </li>
              ))}
            </ul>
            <form action={createSemester} className="grid gap-3 sm:grid-cols-3">
              <Field label="Name" htmlFor="sem_name"><Input id="sem_name" name="name" placeholder="Even Sem 2025-26" required /></Field>
              <Field label="Starts" htmlFor="starts_on"><Input id="starts_on" name="starts_on" type="date" required /></Field>
              <Field label="Ends" htmlFor="ends_on"><Input id="ends_on" name="ends_on" type="date" required /></Field>
              <Button type="submit" variant="secondary" className="sm:col-span-3">Add semester</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Per-meal rates (₹)</CardTitle><CardDescription>{active ? `For ${active.name}. Charged each time a student eats that meal.` : 'Create and activate a semester first.'}</CardDescription></CardHeader>
          <CardContent>
            {active && (
              <form action={saveRates} className="grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="semester_id" value={active.id} />
                {meals.map((m) => (
                  <Field key={m.id} label={m.name} htmlFor={`rate_${m.id}`}>
                    <Input id={`rate_${m.id}`} name={`rate_${m.id}`} inputMode="decimal" defaultValue={rupees(rateBy.get(m.id))} required />
                  </Field>
                ))}
                <Button type="submit" className="sm:col-span-2">Save rates</Button>
              </form>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Meal windows</CardTitle><CardDescription>Times are Asia/Kolkata. A punch counts toward the meal whose window contains it. <Badge variant="warning">placeholder</Badge> means not yet confirmed.</CardDescription></CardHeader>
          <CardContent>
            <form action={saveWindows} className="grid gap-3">
              {meals.map((m) => {
                const w = winBy.get(m.id);
                if (!w) return null;
                return (
                  <fieldset key={m.id} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2 sm:grid-cols-[100px_1fr_1fr_auto]">
                    <legend className="sr-only">{m.name}</legend>
                    <span className="col-span-3 flex items-center gap-2 text-sm font-medium sm:col-span-1">{m.name}{w.is_placeholder && <Badge variant="warning">placeholder</Badge>}</span>
                    <Field label="Start" htmlFor={`start_${w.id}`}><Input id={`start_${w.id}`} name={`start_${w.id}`} type="time" defaultValue={String(w.start_time).slice(0, 5)} required /></Field>
                    <Field label="End" htmlFor={`end_${w.id}`}><Input id={`end_${w.id}`} name={`end_${w.id}`} type="time" defaultValue={String(w.end_time).slice(0, 5)} required /></Field>
                    <label className="flex items-center gap-1.5 pb-2 text-sm"><input type="checkbox" name={`active_${w.id}`} defaultChecked={w.active} className="h-4 w-4" />Active</label>
                  </fieldset>
                );
              })}
              <Button type="submit">Save windows</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Import student fees (CSV)</CardTitle><CardDescription>Columns: <code>roll_no,amount_paid</code> (rupees). Students must have signed up already. Re-importing corrects amounts via a ledger adjustment.</CardDescription></CardHeader>
          <CardContent>
            {active ? (
              <form action={importFees} className="grid gap-3" encType="multipart/form-data">
                <input type="hidden" name="semester_id" value={active.id} />
                <Field label={`Fee file for ${active.name}`} htmlFor="file"><Input id="file" name="file" type="file" accept=".csv,text/csv" required /></Field>
                <Button type="submit">Import</Button>
              </form>
            ) : <p className="text-sm text-muted-foreground">Activate a semester first.</p>}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Add a biometric machine</CardTitle><CardDescription>The serial number must match what the bridge sends (shown in the machine&apos;s device-info menu).</CardDescription></CardHeader>
          <CardContent>
            <form action={createDevice} className="grid gap-3 sm:grid-cols-4">
              <Field label="Name" htmlFor="d_name"><Input id="d_name" name="name" required /></Field>
              <Field label="Location" htmlFor="d_loc"><Input id="d_loc" name="location" /></Field>
              <Field label="Serial" htmlFor="d_serial"><Input id="d_serial" name="device_serial" required /></Field>
              <Field label="IP address" htmlFor="d_ip"><Input id="d_ip" name="ip_address" placeholder="192.168.1.201" /></Field>
              <Button type="submit" variant="secondary" className="sm:col-span-4">Add machine</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
