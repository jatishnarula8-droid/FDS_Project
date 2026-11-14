import Link from 'next/link';
import { UtensilsCrossed } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { Flash } from '@/components/ui/states';
import { signIn, signUp, quickSignIn } from '@/app/actions/auth';

export const metadata = { title: 'Sign in · MNIT Mess Portal' };

export default function LoginPage({ searchParams }: { searchParams: { tab?: string; error?: string; ok?: string } }) {
  const signup = searchParams.tab === 'signup';
  return (
    <main className="container flex min-h-screen max-w-md flex-col justify-center gap-4 py-8">
      <div className="flex items-center gap-2">
        <UtensilsCrossed className="h-6 w-6 text-primary" aria-hidden />
        <span className="text-lg font-semibold">MNIT Mess Portal</span>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{signup ? 'Create your account' : 'Sign in'}</CardTitle>
          <CardDescription>{signup ? 'Use your college email address.' : 'Students, mess staff and admin all sign in here.'}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Flash ok={searchParams.ok} error={searchParams.error} />
          {signup ? (
            <form action={signUp} className="grid gap-3">
              <Field label="Full name" htmlFor="full_name"><Input id="full_name" name="full_name" autoComplete="name" required /></Field>
              <Field label="Roll number (your ID)" htmlFor="roll_no"><Input id="roll_no" name="roll_no" required /></Field>
              <Field label="Email" htmlFor="email" hint="Only college addresses are accepted."><Input id="email" name="email" type="email" autoComplete="email" required /></Field>
              <Field label="Phone number" htmlFor="phone"><Input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="9876543210" required /></Field>
              <Field label="Password" htmlFor="password" hint="At least 8 characters."><Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} /></Field>
              <Button type="submit">Create account</Button>
              <p className="text-center text-sm text-muted-foreground">Already registered? <Link className="text-primary underline-offset-4 hover:underline" href="/login">Sign in</Link></p>
            </form>
          ) : (
            <form action={signIn} className="grid gap-3">
              <Field label="Email" htmlFor="email"><Input id="email" name="email" type="email" autoComplete="email" required /></Field>
              <Field label="Password" htmlFor="password"><Input id="password" name="password" type="password" autoComplete="current-password" required minLength={8} /></Field>
              <Button type="submit">Sign in</Button>
              <p className="text-center text-sm text-muted-foreground">New student? <Link className="text-primary underline-offset-4 hover:underline" href="/login?tab=signup">Create an account</Link></p>
            </form>
          )}
          {/* TODO: ERP SSO hook — add a "Sign in with ERP" button here once administrative approval is granted. */}
          {process.env.NEXT_PUBLIC_SHOW_DEMO_HINT === 'true' && (
            <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground grid gap-2">
              <span className="font-semibold text-foreground text-center">Instant 1-Click Login (Demo)</span>
              <div className="grid grid-cols-3 gap-2">
                <form action={quickSignIn}>
                  <input type="hidden" name="email" value="student01@mnit.ac.in" />
                  <Button type="submit" variant="secondary" size="sm" className="w-full text-xs">🎓 Student</Button>
                </form>
                <form action={quickSignIn}>
                  <input type="hidden" name="email" value="manager@mnit.ac.in" />
                  <Button type="submit" variant="secondary" size="sm" className="w-full text-xs">🧑‍🍳 Manager</Button>
                </form>
                <form action={quickSignIn}>
                  <input type="hidden" name="email" value="jatishnarula8@gmail.com" />
                  <Button type="submit" variant="secondary" size="sm" className="w-full text-xs">🛡️ Admin</Button>
                </form>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground text-center">
                Or sign in manually with password <code>demo1234</code>.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
