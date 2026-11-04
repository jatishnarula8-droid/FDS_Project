import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { MealType, Profile, Role } from '@/lib/types';

/** The signed-in user's profile (RLS lets a user read their own row). Cached per request. */
export const getProfile = cache(async (): Promise<Profile | null> => {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from('profiles')
    .select('id, full_name, email, phone, roll_no, hostel, room_no, diet_type, role, consented_at')
    .eq('id', user.id)
    .single();
  return (data as Profile | null) ?? null;
});

/** Require a signed-in, consented user, optionally with one of the given roles. */
export async function requireProfile(roles?: Role[]): Promise<Profile> {
  const profile = await getProfile();
  if (!profile) redirect('/login');
  if (!profile.consented_at) redirect('/consent');
  if (roles && !roles.includes(profile.role)) redirect('/');
  return profile;
}

export const getMealTypes = cache(async (): Promise<MealType[]> => {
  const { data } = await createClient().from('meal_types').select('id, code, name');
  const order = ['breakfast', 'lunch', 'snacks', 'dinner'];
  return ((data ?? []) as MealType[]).sort((a, b) => order.indexOf(a.code) - order.indexOf(b.code));
});

export const getActiveSemester = cache(async () => {
  const { data } = await createClient().from('semesters').select('id, name, starts_on, ends_on, is_active').eq('is_active', true).maybeSingle();
  return data as { id: string; name: string; starts_on: string; ends_on: string; is_active: boolean } | null;
});
