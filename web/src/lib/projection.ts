import { daysBetween } from './time';

/**
 * Projected refund at semester end if the current eating pattern continues:
 * average spend per elapsed day x days left, subtracted from today's balance, floored at 0. Integer paise only.
 */
export function projectRefund(opts: {
  balancePaise: number; deductedPaise: number; semesterStart: string; semesterEnd: string; today: string;
}): { projectedPaise: number; dailyAvgPaise: number; daysLeft: number } {
  const total = daysBetween(opts.semesterStart, opts.semesterEnd) + 1;
  const elapsed = Math.max(1, Math.min(daysBetween(opts.semesterStart, opts.today) + 1, total));
  const daysLeft = Math.max(0, daysBetween(opts.today, opts.semesterEnd));
  const dailyAvgPaise = Math.round(opts.deductedPaise / elapsed);
  const projectedPaise = Math.max(0, opts.balancePaise - dailyAvgPaise * daysLeft);
  return { projectedPaise, dailyAvgPaise, daysLeft };
}
