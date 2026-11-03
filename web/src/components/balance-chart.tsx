'use client';

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export interface BalancePoint { date: string; balance: number } // balance in rupees for axis readability

/** Balance over time. A table alternative is provided in the page for screen readers. */
export function BalanceChart({ data }: { data: BalancePoint[] }) {
  return (
    <div className="h-48 w-full" role="img" aria-label="Line chart of your balance over time, falling with each meal">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <defs>
            <linearGradient id="bal" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
              <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} minTickGap={24} />
          <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} tickFormatter={(v) => `₹${Number(v).toLocaleString('en-IN')}`} width={64} domain={['auto', 'auto']} />
          <Tooltip formatter={(v: number) => [`₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 'Balance']}
            contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} />
          <Area type="stepAfter" dataKey="balance" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#bal)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
