import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

export const TZ = 'Asia/Kolkata';

/** "2025-01-31" for the current day in IST (meal windows and meal_date are always IST). */
export const todayIST = () => formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd');
export const fmtTime = (iso: string) => formatInTimeZone(new Date(iso), TZ, 'h:mm a');
export const fmtDateTime = (iso: string) => formatInTimeZone(new Date(iso), TZ, 'd MMM, h:mm a');
export const fmtDate = (d: string) => formatInTimeZone(fromZonedTime(`${d}T00:00:00`, TZ), TZ, 'EEE, d MMM yyyy');
/** "07:30:00" -> "7:30 AM" */
export const fmtClock = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

/** First and last day ("yyyy-MM-dd") of a "yyyy-MM" month string. */
export function monthBounds(month: string): { from: string; to: string; days: number } {
  const [y, m] = month.split('-').map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(days).padStart(2, '0')}`, days };
}

export const isMonth = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

/** Whole days from a to b (yyyy-MM-dd). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}
