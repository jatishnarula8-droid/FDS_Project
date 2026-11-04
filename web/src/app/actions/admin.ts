'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { parseCsv } from '@/lib/csv';
import { rupeesToPaise } from '@/lib/format';
import { done, fail, friendly, parseForm } from './helpers';

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a valid date');
const BACK = '/admin/setup';

export async function createSemester(fd: FormData) {
  const i = parseForm(z.object({ name: z.string().trim().min(2).max(80), starts_on: date, ends_on: date }), fd, BACK);
  if (i.ends_on <= i.starts_on) fail(BACK, 'End date must be after the start date.');
  const { error } = await createClient().from('semesters').insert({ name: i.name, starts_on: i.starts_on, ends_on: i.ends_on });
  if (error) fail(BACK, friendly(error.message));
  done(BACK, 'Semester created. Set it active to start charging meals against it.');
}

export async function activateSemester(fd: FormData) {
  const { id } = parseForm(z.object({ id: uuid }), fd, BACK);
  const supabase = createClient();
  const off = await supabase.from('semesters').update({ is_active: false }).eq('is_active', true);
  if (off.error) fail(BACK, friendly(off.error.message));
  const on = await supabase.from('semesters').update({ is_active: true }).eq('id', id);
  if (on.error) fail(BACK, friendly(on.error.message));
  done(BACK, 'Active semester changed.');
}

export async function saveRates(fd: FormData) {
  const semester_id = parseForm(z.object({ semester_id: uuid }), fd, BACK).semester_id;
  const rows: { semester_id: string; meal_type_id: string; rate_paise: number }[] = [];
  for (const [key, val] of fd.entries()) {
    if (!key.startsWith('rate_')) continue;
    const paise = rupeesToPaise(String(val));
    if (paise === null) fail(BACK, `"${val}" is not a valid rupee amount.`);
    rows.push({ semester_id, meal_type_id: key.slice(5), rate_paise: paise });
  }
  if (!rows.length) fail(BACK, 'No rates submitted.');
  const { error } = await createClient().from('meal_rates').upsert(rows, { onConflict: 'semester_id,meal_type_id' });
  if (error) fail(BACK, friendly(error.message));
  done(BACK, 'Per-meal rates saved.');
}

export async function saveWindows(fd: FormData) {
  const supabase = createClient();
  const ids = [...new Set([...fd.keys()].filter((k) => k.startsWith('start_')).map((k) => k.slice(6)))];
  for (const id of ids) {
    const start = String(fd.get(`start_${id}`)), end = String(fd.get(`end_${id}`));
    if (!/^\d{2}:\d{2}/.test(start) || !/^\d{2}:\d{2}/.test(end) || start >= end) fail(BACK, 'Each meal window needs a start time before its end time.');
    const { error } = await supabase.from('meal_windows')
      .update({ start_time: start, end_time: end, active: fd.get(`active_${id}`) === 'on', is_placeholder: false }).eq('id', id);
    if (error) fail(BACK, friendly(error.message));
  }
  done(BACK, 'Meal windows saved (times are Asia/Kolkata).');
}

/** CSV columns: roll_no, amount_paid (rupees). Header row optional. Students must already have signed up. */
export async function importFees(fd: FormData) {
  const semester_id = parseForm(z.object({ semester_id: uuid }), fd, BACK).semester_id;
  const file = fd.get('file');
  if (!(file instanceof File) || file.size === 0) fail(BACK, 'Choose a CSV file.');
  if (file.size > 1_000_000) fail(BACK, 'File too large (max 1 MB).');
  const rows = parseCsv(await file.text());
  if (rows[0] && rows[0][0]?.trim().toLowerCase().startsWith('roll')) rows.shift();

  const supabase = createClient();
  const { data: profs } = await supabase.from('profiles').select('id, roll_no').not('roll_no', 'is', null);
  const byRoll = new Map((profs ?? []).map((p: { id: string; roll_no: string }) => [p.roll_no.trim().toLowerCase(), p.id]));

  let ok = 0; const problems: string[] = [];
  for (const [n, r] of rows.entries()) {
    const roll = (r[0] ?? '').trim(); const paise = rupeesToPaise(r[1] ?? '');
    const id = byRoll.get(roll.toLowerCase());
    if (!roll || paise === null) { problems.push(`row ${n + 1}: bad amount`); continue; }
    if (!id) { problems.push(`${roll}: no signed-up student`); continue; }
    const { error } = await supabase.rpc('set_student_fee', { p_student: id, p_semester: semester_id, p_amount_paise: paise });
    if (error) problems.push(`${roll}: ${friendly(error.message)}`); else ok++;
  }
  const tail = problems.length ? ` Skipped ${problems.length}: ${problems.slice(0, 5).join('; ')}${problems.length > 5 ? '…' : ''}` : '';
  if (ok === 0 && problems.length) fail(BACK, `Nothing imported.${tail}`);
  done(BACK, `Imported ${ok} fee record(s).${tail}`);
}

/** Admin sets how much money a student has left. The ledger records the difference (never overwritten). */
export async function setMoneyLeft(fd: FormData) {
  const q = String(fd.get('q') ?? '').slice(0, 60);
  const back = '/admin' + (q ? `?q=${encodeURIComponent(q)}` : '');
  const i = parseForm(z.object({ student_id: uuid, amount: z.string() }), fd, back);
  const paise = rupeesToPaise(i.amount);
  if (paise === null) fail(back, `"${i.amount}" is not a valid rupee amount.`);
  const { error } = await createClient().rpc('set_money_left', { p_student: i.student_id, p_new_balance_paise: paise });
  if (error) fail(back, friendly(error.message));
  done(back, 'Money left updated.');
}

export async function saveCutoff(fd: FormData) {
  const i = parseForm(z.object({ cutoff: z.string().regex(/^\d{2}:\d{2}$/, 'Pick a time') }), fd, BACK);
  const { error } = await createClient().from('app_settings').update({ value: i.cutoff }).eq('key', 'optin_cutoff');
  if (error) fail(BACK, friendly(error.message));
  done(BACK, `Students must now choose tomorrow's meals before ${i.cutoff} (IST) today.`);
}

export async function createDevice(fd: FormData) {
  const i = parseForm(z.object({
    name: z.string().trim().min(2).max(80), location: z.string().trim().max(120).optional(),
    device_serial: z.string().trim().min(3).max(60), ip_address: z.string().trim().max(45).optional(),
  }), fd, BACK);
  const { error } = await createClient().from('devices').insert({ ...i, location: i.location || null, ip_address: i.ip_address || null });
  if (error) fail(BACK, friendly(error.message));
  done(BACK, 'Device added.');
}

export async function closeSemester(fd: FormData) {
  const back = '/admin/refunds';
  const { semester_id } = parseForm(z.object({ semester_id: uuid }), fd, back);
  const { data, error } = await createClient().rpc('close_semester', { p_semester: semester_id });
  if (error) fail(back, friendly(error.message));
  done(`${back}?semester=${semester_id}`, `Semester closed. ${data} refund proposal(s) created — nothing is paid until you approve each one.`);
}

export async function approveRefund(fd: FormData) {
  const back = '/admin/refunds';
  const { id, semester_id } = parseForm(z.object({ id: uuid, semester_id: uuid }), fd, back);
  const { error } = await createClient().rpc('approve_refund', { p_proposal: id });
  if (error) fail(`${back}?semester=${semester_id}`, friendly(error.message));
  done(`${back}?semester=${semester_id}`, 'Refund approved and recorded. Pay the student through the usual institute process.');
}

export async function approveAllRefunds(fd: FormData) {
  const back = '/admin/refunds';
  const { semester_id } = parseForm(z.object({ semester_id: uuid }), fd, back);
  const supabase = createClient();
  const { data: props } = await supabase.from('v_refund_report').select('proposal_id')
    .eq('semester_id', semester_id).eq('proposal_status', 'proposed');
  let n = 0;
  for (const p of props ?? []) {
    const { error } = await supabase.rpc('approve_refund', { p_proposal: p.proposal_id });
    if (error) fail(`${back}?semester=${semester_id}`, `Stopped after ${n}: ${friendly(error.message)}`);
    n++;
  }
  done(`${back}?semester=${semester_id}`, `Approved ${n} refund(s).`);
}
