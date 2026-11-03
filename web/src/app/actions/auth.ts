'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { fail, friendly, parseForm } from './helpers';

// TODO: ERP SSO hook. Logging in through the institute ERP / SSO needs administrative approval and API access that we
// do not have. When approved, add a provider here (e.g. supabase.auth.signInWithOAuth / signInWithSSO), map the ERP
// roll number to profiles.roll_no, and keep the college-domain check in the database. Do NOT assume ERP API access.

const appUrl = () => process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
const creds = z.object({ email: z.string().email('Enter a valid email'), password: z.string().min(8, 'Password must be at least 8 characters') });

export async function signIn(fd: FormData) {
  const { email, password } = parseForm(creds, fd, '/login');
  const { error } = await createClient().auth.signInWithPassword({ email, password });
  if (error) fail('/login', friendly(error.message));
  redirect('/');
}

export async function signUp(fd: FormData) {
  const input = parseForm(creds.extend({ full_name: z.string().min(2, 'Enter your name'), roll_no: z.string().optional() }), fd, '/login?tab=signup');
  const { data, error } = await createClient().auth.signUp({
    email: input.email, password: input.password,
    options: { data: { full_name: input.full_name, roll_no: input.roll_no ?? '' }, emailRedirectTo: `${appUrl()}/auth/callback` },
  });
  // The database rejects sign-ups outside the allowed college domain; surface that message.
  if (error) fail('/login?tab=signup', friendly(error.message));
  if (data.session) redirect('/');
  redirect('/login?ok=' + encodeURIComponent('Account created. Check your email to confirm, then sign in.'));
}

export async function sendMagicLink(fd: FormData) {
  const { email } = parseForm(z.object({ email: z.string().email('Enter a valid email') }), fd, '/login?tab=link');
  const { error } = await createClient().auth.signInWithOtp({ email, options: { emailRedirectTo: `${appUrl()}/auth/callback`, shouldCreateUser: false } });
  if (error) fail('/login?tab=link', friendly(error.message));
  redirect('/login?ok=' + encodeURIComponent('If that address has an account, a sign-in link is on its way.'));
}

export async function signOut() {
  await createClient().auth.signOut();
  redirect('/login');
}
