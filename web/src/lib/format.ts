/** Money is stored as integer paise. These helpers are the ONLY place it becomes a display string. */
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 123450 -> "₹1,234.50". Negative values render as "-₹12.00". */
export function formatINR(paise: number): string {
  return inr.format(paise / 100);
}

/** "1234.5" / "₹1,234.50" / "1,234" -> 123450 paise. Returns null when not a valid non-negative amount. */
export function rupeesToPaise(input: string): number | null {
  const cleaned = input.replace(/[₹,\s]|rs\.?|inr/gi, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [r, p = ''] = cleaned.split('.');
  return Number(r) * 100 + Number((p + '00').slice(0, 2));
}
