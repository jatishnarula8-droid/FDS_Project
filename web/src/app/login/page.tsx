import Link from 'next/link';
import { UtensilsCrossed } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { Flash } from '@/components/ui/states';
import { signIn, signUp, sendMagicLink } from '@/app/actions/auth';

export const metadata = { title: 'Sign in · MNIT Mess Portal' };

const tabs = [
  { id: 'signin', label: 'Sign in' },
  { id: 'signup', label: 'Create account' },
  { id: 'link', label: 'Email link' },
];

export default function LoginPage({ searchParams }: { searchParams: { tab?: string; error?: string; ok?: string } }) {
  const tab = tabs.some((t) => t.id === searchParams.tab) ? searchParams.tab! : 'signin';
  return (
    <main className="container flex min-h-screen max-w-md flex-col justify-center gap-4 py-8">
      <div className="flex items-center gap-2">
        <UtensilsCrossed className="h-6 w-6 text-primary" aria-hidden />
        <span className="text-lg font-semibold">MNIT Mess Portal</span>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Welcome</CardTitle>
          <CardDescription>Use your college email address.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <nav aria-label="Login method" className="grid grid-cols-3 gap-1 rounded-md bg-muted p-1 text-sm">
            {tabs.map((t) => (
              <Link key={t.id} href={`/login?tab=${t.id}`} aria-current={t.id === tab ? 'page' : undefined}
                className={`rounded px-2 py-2 text-center ${t.id === tab ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground'}`}>
                {t.label}
              </Link>
            ))}
          </nav>
          <Flash ok={searchParams.ok} error={searchParams.error} />

          {tab === 'signin' && (
            <form action={signIn} className="grid gap-3">
              <Field label="Email" htmlFor="email"><Input id="email" name="email" type="email" autoComplete="email" required /></Field>
              <Field label="Password" htmlFor="password"><Input id="password" name="password" type="password" autoComplete="current-password" required minLength={8} /></Field>
              <Button type="submit">Sign in</Button>
            </form>
          )}
          {tab === 'signup' && (
            <form action={signUp} className="grid gap-3">
              <Field label="Full name" htmlFor="full_name"><Input id="full_name" name="full_name" autoComplete="name" required /></Field>
              <Field label="Roll number" htmlFor="roll_no" hint="Optional now; you can add it on the next screen."><Input id="roll_no" name="roll_no" /></Field>
              <Field label="College email" htmlFor="su_email" hint="Only addresses from the college domain are accepted."><Input id="su_email" name="email" type="email" autoComplete="email" required /></Field>
              <Field label="Password" htmlFor="su_password" hint="At least 8 characters."><Input id="su_password" name="password" type="password" autoComplete="new-password" required minLength={8} /></Field>
              <Button type="submit">Create account</Button>
            </form>
          )}
          {tab === 'link' && (
            <form action={sendMagicLink} className="grid gap-3">
              <Field label="Email" htmlFor="ml_email"><Input id="ml_email" name="email" type="email" autoComplete="email" required /></Field>
              <Button type="submit">Email me a sign-in link</Button>
            </form>
          )}
          {/* TODO: ERP SSO hook — add a "Sign in with ERP" button here once administrative approval is granted. */}
          {process.env.NEXT_PUBLIC_SHOW_DEMO_HINT === 'true' && (
            <p className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
              Demo logins (password <code>demo1234</code>): <code>student01@mnit.ac.in</code>, <code>manager@mnit.ac.in</code>, <code>admin@mnit.ac.in</code>
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
