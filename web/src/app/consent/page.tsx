import { redirect } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';
import { getProfile } from '@/lib/session';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/form';
import { Flash } from '@/components/ui/states';
import { saveConsent } from '@/app/actions/student';

export const metadata = { title: 'Privacy notice · MNIT Mess Portal' };

export default async function ConsentPage({ searchParams }: { searchParams: { error?: string } }) {
  const profile = await getProfile();
  if (!profile) redirect('/login');
  if (profile.consented_at) redirect('/');
  const isStudent = profile.role === 'student';

  return (
    <main className="container max-w-2xl py-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" aria-hidden /><CardTitle>Before you start: what we store</CardTitle></div>
          <CardDescription>Please read this short notice and confirm your details.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <section className="grid gap-3 text-sm">
            <div>
              <h2 className="font-medium">What is stored</h2>
              <p className="text-muted-foreground">Your name, roll number, email, phone number, hostel and room, the numeric ID your fingerprint machine uses for you, the <strong>time of each punch</strong>, and the mess fee balance derived from them.</p>
            </div>
            <div>
              <h2 className="font-medium">What is never stored</h2>
              <p className="text-muted-foreground"><strong>Fingerprints or face data.</strong> They stay inside the biometric machine. This portal only sees &quot;ID 1017 punched at 1:05 pm&quot;. It also cannot know how much food you ate, only which meals you attended.</p>
            </div>
            <div>
              <h2 className="font-medium">Who can see it</h2>
              <ul className="list-disc pl-5 text-muted-foreground">
                <li><strong>You</strong>: everything about yourself.</li>
                <li><strong>Mess manager</strong>: your name, roll number, punches and meals, to run the mess and resolve disputes. Managers cannot see fee balances.</li>
                <li><strong>Mess administration</strong>: all of the above plus fee balances, for the end-of-semester refund review.</li>
              </ul>
            </div>
            <div>
              <h2 className="font-medium">If something looks wrong</h2>
              <p className="text-muted-foreground">Use <em>Disputes</em> in the menu: tell us you ate but it did not register, or that a charge is wrong. A mess manager reviews it and records the decision with a reason.</p>
            </div>
            <p className="rounded-md bg-muted p-3 text-muted-foreground">Refund amounts shown here are <strong>proposals pending approval</strong> by mess administration. This portal never moves money.</p>
          </section>

          <Flash error={searchParams.error} />
          <form action={saveConsent} className="grid gap-3 sm:grid-cols-2">
            <Field label="Full name" htmlFor="full_name"><Input id="full_name" name="full_name" defaultValue={profile.full_name} required /></Field>
            <Field label="Roll number" htmlFor="roll_no" hint={profile.roll_no ? 'Set already. Ask the mess office to change it.' : isStudent ? 'You can set this once.' : undefined}>
              <Input id="roll_no" name="roll_no" defaultValue={profile.roll_no ?? ''} readOnly={!!profile.roll_no} required={isStudent && !profile.roll_no} />
            </Field>
            <Field label="Phone number" htmlFor="phone"><Input id="phone" name="phone" type="tel" inputMode="tel" defaultValue={profile.phone ?? ''} required /></Field>
            <Field label="Hostel" htmlFor="hostel"><Input id="hostel" name="hostel" defaultValue={profile.hostel ?? ''} /></Field>
            <Field label="Room" htmlFor="room_no"><Input id="room_no" name="room_no" defaultValue={profile.room_no ?? ''} /></Field>
            <Field label="Diet" htmlFor="diet_type">
              <Select id="diet_type" name="diet_type" defaultValue={profile.diet_type}>
                <option value="veg">Vegetarian</option><option value="non_veg">Non-vegetarian</option>
                <option value="egg">Eggetarian</option><option value="jain">Jain</option>
              </Select>
            </Field>
            <label className="flex items-start gap-2 text-sm sm:col-span-2">
              <input type="checkbox" name="agree" required className="mt-1 h-4 w-4" />
              <span>I have read this notice and I understand what is stored and who can see it.</span>
            </label>
            <Button type="submit" className="sm:col-span-2">Agree and continue</Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
