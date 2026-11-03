import { formatINR } from '@/lib/format';

/** Ring that empties as the balance is spent. Colour AND text convey the level (not colour alone). */
export function BalanceRing({ balancePaise, paidPaise }: { balancePaise: number; paidPaise: number }) {
  const frac = paidPaise > 0 ? Math.max(0, Math.min(1, balancePaise / paidPaise)) : 0;
  const pct = Math.round(frac * 100);
  const r = 52, c = 2 * Math.PI * r;
  const tone = frac > 0.5 ? 'text-success' : frac > 0.2 ? 'text-warning' : 'text-destructive';
  return (
    <div className="flex items-center gap-4">
      <div className="relative h-32 w-32 shrink-0" role="img" aria-label={`${pct}% of your mess fee is left: ${formatINR(balancePaise)} of ${formatINR(paidPaise)}`}>
        <svg viewBox="0 0 128 128" className="h-full w-full -rotate-90">
          <circle cx="64" cy="64" r={r} fill="none" strokeWidth="12" className="stroke-muted" />
          <circle cx="64" cy="64" r={r} fill="none" strokeWidth="12" strokeLinecap="round"
            className={`stroke-current ${tone}`} strokeDasharray={c} strokeDashoffset={c * (1 - frac)} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`text-2xl font-bold ${tone}`}>{pct}%</span>
          <span className="text-[11px] text-muted-foreground">left</span>
        </div>
      </div>
      <div>
        <p className="text-sm text-muted-foreground">Refundable balance</p>
        <p className="text-3xl font-bold tracking-tight sm:text-4xl" data-testid="balance">{formatINR(balancePaise)}</p>
        <p className="text-sm text-muted-foreground">of {formatINR(paidPaise)} paid</p>
      </div>
    </div>
  );
}
