import { requireProfile, getMealTypes } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDate, todayIST } from '@/lib/time';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { StatusBadge } from '@/components/ui/badge';
import { EmptyState, Flash } from '@/components/ui/states';
import { createDispute } from '@/app/actions/student';

export const metadata = { title: 'Disputes · MNIT Mess Portal' };

export default async function DisputesPage({ searchParams }: { searchParams: { kind?: string; date?: string; meal?: string; ok?: string; error?: string } }) {
  const profile = await requireProfile(['student']);
  const meals = await getMealTypes();
  const { data: disputes } = await createClient().from('disputes')
    .select('id, kind, meal_date, message, status, resolution_note, created_at, meal_types(name)')
    .eq('student_id', profile.id).order('created_at', { ascending: false }).limit(50);

  const kind = searchParams.kind === 'wrong_charge' ? 'wrong_charge' : 'missing_punch';
  const defMeal = meals.find((m) => m.code === searchParams.meal)?.id ?? '';

  return (
    <>
      <PageHeader title="Disputes" description="Tell the mess office if a punch did not register, or a charge looks wrong." />
      <div className="mb-4"><Flash ok={searchParams.ok} error={searchParams.error} /></div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card id="new">
          <CardHeader><CardTitle>New dispute</CardTitle><CardDescription>A mess manager will review it and record the decision with a reason.</CardDescription></CardHeader>
          <CardContent>
            <form action={createDispute} className="grid gap-3">
              <Field label="What happened?" htmlFor="kind">
                <Select id="kind" name="kind" defaultValue={kind}>
                  <option value="missing_punch">I ate, but it did not register</option>
                  <option value="wrong_charge">I was charged for a meal I did not eat</option>
                </Select>
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Date" htmlFor="meal_date"><Input id="meal_date" name="meal_date" type="date" max={todayIST()} defaultValue={searchParams.date ?? todayIST()} required /></Field>
                <Field label="Meal" htmlFor="meal_type_id">
                  <Select id="meal_type_id" name="meal_type_id" defaultValue={defMeal} required>
                    <option value="" disabled>Choose…</option>
                    {meals.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </Select>
                </Field>
              </div>
              <Field label="Details" htmlFor="message" hint="E.g. which counter, what the machine showed, who saw you.">
                <Textarea id="message" name="message" required minLength={3} maxLength={1000} />
              </Field>
              <Button type="submit">Submit dispute</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Your disputes</CardTitle></CardHeader>
          <CardContent>
            {(disputes ?? []).length === 0 ? <EmptyState title="Nothing raised yet" /> : (
              <ul className="divide-y">
                {(disputes as unknown as { id: string; kind: string; meal_date: string; message: string; status: string; resolution_note: string | null; meal_types: { name: string } | null }[]).map((d) => (
                  <li key={d.id} className="grid gap-1 py-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{d.meal_types?.name} · {fmtDate(d.meal_date)}</span>
                      <StatusBadge status={d.status} kind="dispute" />
                    </div>
                    <p className="text-xs text-muted-foreground">{d.kind === 'missing_punch' ? 'Ate, but not registered' : 'Wrongly charged'}</p>
                    <p>{d.message}</p>
                    {d.resolution_note && <p className="rounded bg-muted p-2 text-xs"><span className="font-medium">Staff note:</span> {d.resolution_note}</p>}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
