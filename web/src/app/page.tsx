import { redirect } from 'next/navigation';
import { getProfile } from '@/lib/session';

export default async function Home() {
  const profile = await getProfile();
  if (!profile) redirect('/login');
  if (!profile.consented_at) redirect('/consent');
  redirect(profile.role === 'student' ? '/dashboard' : '/manager');
}
