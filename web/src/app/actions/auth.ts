'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { phoneSchema } from '@/lib/validation';
import { fail, friendly, parseForm } from './helpers';

// TODO: ERP SSO hook. Logging in through the institute ERP / SSO needs administrative approval and API access that we
// do not have. When approved, add a provider here (e.g. supabase.auth.signInWithOAuth / signInWithSSO), map the ERP
// roll number to profiles.roll_no, and keep the college-domain check in the database. Do NOT assume ERP API access.

const appUrl = () => process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
const creds = z.object({ email: z.string().trim().email('Enter a valid email'), password: z.string().min(8, 'Password must be at least 8 characters') });

export async function signIn(fd: FormData) {
  const { email, password } = parseForm(creds, fd, '/login');
  const { error } = await createClient().auth.signInWithPassword({ email, password });
  if (error) fail('/login', friendly(error.message));
  redirect('/');
}

export async function quickSignIn(fd: FormData) {
  const email = String(fd.get('email') ?? '').trim();
  const { error } = await createClient().auth.signInWithPassword({ email, password: 'demo1234' });
  if (error) fail('/login', friendly(error.message));
  redirect('/');
}

export async function signUp(fd: FormData) {
  const back = '/login?tab=signup';
  const input = parseForm(creds.extend({
    full_name: z.string().trim().min(2, 'Enter your name'),
    roll_no: z.string().trim().min(1, 'Enter your roll number'),
    phone: phoneSchema,
  }), fd, back);
  const { data, error } = await createClient().auth.signUp({
    email: input.email, password: input.password,
    options: { data: { full_name: input.full_name, roll_no: input.roll_no, phone: input.phone }, emailRedirectTo: `${appUrl()}/auth/callback` },
  });
  // The database rejects sign-ups outside the allowed college domain; surface that message.
  if (error) fail(back, friendly(error.message));
  if (data.session) redirect('/');
  redirect('/login?ok=' + encodeURIComponent('Account created. Check your email to confirm it, then sign in.'));
}

export async function signOut() {
  await createClient().auth.signOut();
  redirect('/login');
}
