import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva('inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap', {
  variants: {
    variant: {
      default: 'border-transparent bg-primary text-primary-foreground',
      secondary: 'border-transparent bg-secondary text-secondary-foreground',
      success: 'border-success/30 bg-success/10 text-success',
      warning: 'border-warning/30 bg-warning/10 text-warning',
      destructive: 'border-destructive/30 bg-destructive/10 text-destructive',
      outline: 'text-foreground',
    },
  },
  defaultVariants: { variant: 'default' },
});

export function Badge({ className, variant, ...p }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...p} />;
}

const STATUS: Record<string, { v: 'success' | 'warning' | 'destructive' | 'secondary'; t: string }> = {
  matched: { v: 'success', t: 'Matched' }, duplicate: { v: 'secondary', t: 'Duplicate' },
  unmatched: { v: 'warning', t: 'Unmatched' }, outside_window: { v: 'warning', t: 'Outside meal time' },
  rejected: { v: 'destructive', t: 'Rejected' }, open: { v: 'warning', t: 'Open' },
  approved: { v: 'success', t: 'Approved' }, rejected_d: { v: 'destructive', t: 'Rejected' },
  proposed: { v: 'warning', t: 'Proposed (pending approval)' },
};
export function StatusBadge({ status, kind }: { status: string; kind?: 'dispute' }) {
  const s = STATUS[kind === 'dispute' && status === 'rejected' ? 'rejected_d' : status] ?? { v: 'secondary' as const, t: status };
  return <Badge variant={s.v}>{s.t}</Badge>;
}
