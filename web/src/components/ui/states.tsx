import { AlertCircle, Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';

export function EmptyState({ title, hint, className }: { title: string; hint?: string; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center', className)}>
      <Inbox className="h-6 w-6 text-muted-foreground" aria-hidden />
      <p className="font-medium">{title}</p>
      {hint ? <p className="max-w-sm text-sm text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{message}</span>
    </div>
  );
}

export function SuccessNote({ message }: { message: string }) {
  return <div role="status" className="rounded-md border border-success/40 bg-success/10 p-3 text-sm text-success">{message}</div>;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} aria-hidden />;
}

/** Flash message from ?ok= / ?error= query params set by server actions. */
export function Flash({ ok, error }: { ok?: string; error?: string }) {
  if (error) return <ErrorNote message={error} />;
  if (ok) return <SuccessNote message={ok} />;
  return null;
}
