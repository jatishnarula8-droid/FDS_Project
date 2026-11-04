import { z } from 'zod';

/** Indian-style mobile numbers: 10–13 digits, optional leading +, spaces/dashes ignored. */
export const phoneSchema = z.string().trim()
  .transform((s) => s.replace(/[\s-]/g, ''))
  .pipe(z.string().regex(/^\+?\d{10,13}$/, 'Enter a valid phone number (10–13 digits)'));
