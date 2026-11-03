'use client';

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export interface MealCount { meal: string; eaten: number; optedIn: number; cooked: number }

export function MealCountsChart({ data }: { data: MealCount[] }) {
  const tick = { fontSize: 11, fill: 'hsl(var(--muted-foreground))' };
  return (
    <div className="h-56 w-full" role="img" aria-label="Bar chart comparing meals eaten, students opted in, and portions cooked for each meal today">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey="meal" tick={tick} tickLine={false} axisLine={false} />
          <YAxis tick={tick} tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="optedIn" name="Opted in" fill="hsl(var(--muted-foreground))" radius={[3, 3, 0, 0]} />
          <Bar dataKey="eaten" name="Punched (ate)" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
          <Bar dataKey="cooked" name="Cooked" fill="hsl(var(--success))" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
