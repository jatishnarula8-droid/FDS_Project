'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { todayIST } from '@/lib/time';
import { done, fail, friendly, parseForm } from './helpers';

const uuid = z.string().uuid();

/** Map a machine PIN to a student. Stores only the numeric PIN — never any biometric data. */
export async function enrolStudent(fd: FormData) {
  const back = '/manager/students';
  const input = parseForm(z.object({
    student_id: uuid,
    device_user_id: z.string().trim().regex(/^\d{1,9}$/, 'PIN must be 1–9 digits (the number shown on the machine)'),
    device_id: z.union([uuid, z.literal('')]).optional(),
  }), fd, back);
  const { error } = await createClient().from('device_users').insert({
    student_id: input.student_id, device_user_id: input.device_user_id, device_id: input.device_id || null });
  if (error) fail(back, /duplicate|unique/i.test(error.message) ? 'That PIN is already assigned on this machine.' : friendly(error.message));
  done(back, 'Enrolled.');
}

export async function removeEnrolment(fd: FormData) {
  const back = '/manager/students';
  const { id } = parseForm(z.object({ id: uuid }), fd, back);
  const { error } = await createClient().from('device_users').delete().eq('id', id);
  if (error) fail(back, friendly(error.message));
  done(back, 'Mapping removed.');
}

export async function resolveDispute(fd: FormData) {
  const back = '/manager/disputes';
  const input = parseForm(z.object({
    id: uuid, decision: z.enum(['approve', 'reject']),
    note: z.string().trim().min(3, 'A reason is required (min 3 characters)').max(500),
  }), fd, back);
  const { error } = await createClient().rpc('resolve_dispute', { p_dispute: input.id, p_approve: input.decision === 'approve', p_note: input.note });
  if (error) fail(back, friendly(error.message));
  done(back, input.decision === 'approve' ? 'Approved and recorded in the ledger.' : 'Rejected.');
}

export type ScanResult =
  | { ok: true; student_name: string; roll_no: string | null; meal: string; low_balance: boolean }
  | { ok: false; error: string };

/** Called by the scanner. Returns a result (never redirects) so the scan screen can show it instantly. */
export async function redeemPass(token: string): Promise<ScanResult> {
  const t = String(token ?? '').slice(0, 100);
  const { data, error } = await createClient().rpc('redeem_pass', { p_token: t });
  if (error) return { ok: false, error: friendly(error.message) };
  return data as ScanResult;
}

export async function setCooked(fd: FormData) {
  const back = '/manager';
  const input = parseForm(z.object({ meal_type_id: uuid, cooked_count: z.coerce.number().int().min(0).max(100000) }), fd, back);
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from('meal_cooked').upsert(
    { meal_date: todayIST(), meal_type_id: input.meal_type_id, cooked_count: input.cooked_count, updated_by: user?.id });
  if (error) fail(back, friendly(error.message));
  done(back, 'Cooked count saved.');
}
