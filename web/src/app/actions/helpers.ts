import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import type { ZodTypeAny, z } from 'zod';

const withParam = (path: string, key: string, msg: string) =>
  `${path}${path.includes('?') ? '&' : '?'}${key}=${encodeURIComponent(msg.slice(0, 300))}`;

/** Redirect back with a green flash message. */
export function done(path: string, msg: string): never {
  revalidatePath(path.split('?')[0]);
  redirect(withParam(path, 'ok', msg));
}
/** Redirect back with a red error message. */
export function fail(path: string, msg: string): never {
  redirect(withParam(path, 'error', msg));
}

/** Validate FormData against a Zod schema; on failure redirect back with the first problem. */
export function parseForm<S extends ZodTypeAny>(schema: S, fd: FormData, backTo: string): z.infer<S> {
  const parsed = schema.safeParse(Object.fromEntries(fd.entries()));
  if (!parsed.success) fail(backTo, parsed.error.issues[0]?.message ?? 'Invalid input');
  return parsed.data;
}

/** Turn a Postgres/PostgREST error into something a human can act on. */
export function friendly(message: string): string {
  if (/row-level security|permission denied/i.test(message)) return 'You do not have permission to do that.';
  if (/duplicate key/i.test(message)) return 'That already exists.';
  return message.replace(/^error:\s*/i, '');
}
