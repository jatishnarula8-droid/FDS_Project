'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { fmtTime } from '@/lib/time';

export interface FeedRow {
  id: string; punched_at: string; status: string; device_user_id: string; needs_review: boolean;
  profiles: { full_name: string; roll_no: string | null } | null;
  devices: { name: string } | null;
  meal_types: { name: string } | null;
}
const SELECT = 'id, punched_at, status, device_user_id, needs_review, profiles(full_name, roll_no), devices(name), meal_types(name)';

/** Live punch feed over Supabase Realtime (respects RLS: only staff sessions receive punch rows). */
export function LiveFeed({ initial }: { initial: FeedRow[] }) {
  const [rows, setRows] = useState<FeedRow[]>(initial);
  const [conn, setConn] = useState<string>('connecting');
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel('punch-feed')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'punches' }, async (payload) => {
        const { data } = await supabase.from('punches').select(SELECT).eq('id', (payload.new as { id: string }).id).single();
        if (data) setRows((prev) => [data as unknown as FeedRow, ...prev.filter((r) => r.id !== (data as { id: string }).id)].slice(0, 50));
        clearTimeout(timer.current);                       // refresh server-rendered counts, at most every 1.5 s
        timer.current = setTimeout(() => router.refresh(), 1500);
      })
      .subscribe((s) => setConn(s === 'SUBSCRIBED' ? 'live' : s.toLowerCase()));
    return () => { clearTimeout(timer.current); supabase.removeChannel(channel); };
  }, [router]);

  return (
    <div>
      <p className="mb-2 flex items-center gap-2 text-xs text-muted-foreground" role="status" aria-live="polite">
        <span className={`inline-block h-2 w-2 rounded-full ${conn === 'live' ? 'bg-success' : 'bg-warning'}`} aria-hidden />
        {conn === 'live' ? 'Live: new punches appear instantly' : `Feed ${conn}… (refresh the page if this persists)`}
      </p>
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">No punches yet today. Start the bridge in mock mode to see some.</p> : (
        <ul className="divide-y" aria-label="Recent punches">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium">{r.profiles?.full_name ?? `Unknown ID ${r.device_user_id}`}
                  {r.profiles?.roll_no ? <span className="ml-2 text-xs font-normal text-muted-foreground">{r.profiles.roll_no}</span> : null}</p>
                <p className="text-xs text-muted-foreground">{fmtTime(r.punched_at)} · {r.devices?.name ?? 'device'}{r.meal_types ? ` · ${r.meal_types.name}` : ''}</p>
              </div>
              <div className="flex items-center gap-1.5">
                {r.needs_review && <Badge variant="warning" title="Device clock was more than 10 minutes off server time">Check clock</Badge>}
                <StatusBadge status={r.status} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
