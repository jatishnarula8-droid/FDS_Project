'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { todayIST } from '@/lib/time';
import { phoneSchema } from '@/lib/validation';
import { done, fail, friendly, parseForm } from './helpers';

const uuid = z.string().uuid();

export async function saveConsent(fd: FormData) {
  const input = parseForm(z.object({
    full_name: z.string().trim().min(2, 'Enter your name').max(100),
    roll_no: z.string().trim().max(30).optional(),
    phone: phoneSchema,
    hostel: z.string().trim().max(60).optional(),
    room_no: z.string().trim().max(20).optional(),
    diet_type: z.enum(['veg', 'non_veg', 'egg', 'jain']),
    agree: z.literal('on', { errorMap: () => ({ message: 'Please tick the box to confirm you have read this notice.' }) }),
  }), fd, '/consent');

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) fail('/login', 'Please sign in again.');
  const { data: current } = await supabase.from('profiles').select('roll_no').eq('id', user.id).single();
  const patch: Record<string, unknown> = {
    full_name: input.full_name, phone: input.phone, hostel: input.hostel || null, room_no: input.room_no || null,
    diet_type: input.diet_type, consented_at: new Date().toISOString(),
  };
  if (!current?.roll_no && input.roll_no) patch.roll_no = input.roll_no; // roll number can be set once; admins change it later
  const { error } = await supabase.from('profiles').update(patch).eq('id', user.id);
  if (error) fail('/consent', friendly(error.message));
  done('/dashboard', 'Thanks — you are all set.');
}

export async function createDispute(fd: FormData) {
  const back = '/disputes';
  const input = parseForm(z.object({
    kind: z.enum(['missing_punch', 'wrong_charge']),
    meal_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date'),
    meal_type_id: z.union([uuid, z.literal('')]).optional(),
    message: z.string().trim().min(3, 'Please describe what happened').max(1000),
  }), fd, back);
  if (input.meal_date > todayIST()) fail(back, 'You cannot dispute a future date.');
  if (!input.meal_type_id) fail(back, 'Choose which meal this is about.');

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) fail('/login', 'Please sign in again.');
  const { error } = await supabase.from('disputes').insert({
    student_id: user.id, kind: input.kind, meal_date: input.meal_date, meal_type_id: input.meal_type_id, message: input.message,
  });
  if (error) fail(back, friendly(error.message));
  done(back, 'Dispute submitted. Mess staff will review it.');
}

/** Save tomorrow's plan. The database enforces "tomorrow only, before the cutoff" and issues one QR pass per meal. */
export async function savePlan(fd: FormData) {
  const back = '/plan';
  const choices: Record<string, boolean> = {};
  for (const code of ['breakfast', 'lunch', 'snacks', 'dinner']) {
    const v = fd.get(`meal_${code}`);
    if (v !== 'yes' && v !== 'no') fail(back, `Please answer for ${code}.`);
    choices[code] = v === 'yes';
  }
  const { error } = await createClient().rpc('set_meal_plan', { p_choices: choices });
  if (error) fail(back, friendly(error.message));
  const n = Object.values(choices).filter(Boolean).length;
  done(back, n ? `Saved. You will get ${n} QR pass${n > 1 ? 'es' : ''} for tomorrow.` : 'Saved. You are skipping all meals tomorrow.');
}

export async function rateMeal(fd: FormData) {
  const input = parseForm(z.object({ meal_type_id: uuid, rating: z.coerce.number().int().min(1).max(5) }), fd, '/today');
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) fail('/login', 'Please sign in again.');
  const { error } = await supabase.from('meal_ratings').upsert(
    { student_id: user.id, meal_date: todayIST(), meal_type_id: input.meal_type_id, rating: input.rating });
  if (error) fail('/today', friendly(error.message));
  done('/today', 'Thanks for rating!');
}
