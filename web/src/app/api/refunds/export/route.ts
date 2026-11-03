import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { toCsv } from '@/lib/csv';

/** CSV export of the refund report. Admin only (enforced by the database: managers/students get zero rows). */
export async function GET(request: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse('Unauthorized', { status: 401 });
  const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  if (me?.role !== 'admin') return new NextResponse('Forbidden', { status: 403 });

  const semester = request.nextUrl.searchParams.get('semester');
  const hostel = request.nextUrl.searchParams.get('hostel');
  let q = supabase.from('v_refund_report').select('*').order('hostel').order('full_name').limit(10000);
  if (semester) q = q.eq('semester_id', semester);
  if (hostel) q = q.eq('hostel', hostel);
  const { data, error } = await q;
  if (error) return new NextResponse(error.message, { status: 500 });

  const rupees = (p: number | null) => (p == null ? '' : (p / 100).toFixed(2));
  const csv = toCsv([
    ['roll_no', 'name', 'hostel', 'amount_paid_inr', 'meals_eaten', 'deducted_inr', 'balance_inr', 'proposed_refund_inr', 'status'],
    ...(data ?? []).map((r) => [r.roll_no, r.full_name, r.hostel, rupees(r.amount_paid_paise), r.meals_eaten, rupees(r.deducted_paise),
      rupees(r.balance_paise), rupees(r.proposal_status ? r.proposed_paise : r.balance_paise),
      r.proposal_status === 'approved' ? 'approved' : 'PROPOSED (pending approval)']),
  ]);
  return new NextResponse(csv, {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="refund-report.csv"', 'cache-control': 'no-store' },
  });
}
