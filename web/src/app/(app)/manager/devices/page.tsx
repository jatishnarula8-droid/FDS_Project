import { requireProfile } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDateTime } from '@/lib/time';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/states';

export const metadata = { title: 'Devices · MNIT Mess Portal' };

/** A machine counts as online if the bridge has reported it within this window (bridge heartbeats every poll). */
const ONLINE_WITHIN_MS = 3 * 60_000;

export default async function DevicesPage() {
  await requireProfile(['manager', 'admin']);
  const supabase = createClient();
  const { data: devices } = await supabase.from('devices').select('id, name, location, device_serial, ip_address, last_seen_at, is_active').order('name');
  const withLast = await Promise.all((devices ?? []).map(async (d) => {
    const { data } = await supabase.from('punches').select('punched_at').eq('device_id', d.id).order('punched_at', { ascending: false }).limit(1);
    return { ...d, lastPunch: (data?.[0]?.punched_at as string | undefined) ?? null };
  }));
  const now = Date.now();

  return (
    <>
      <PageHeader title="Devices" description="Status is reported by the bridge in the mess. Offline means the bridge has not heard from the machine recently." />
      <Card>
        <CardContent className="pt-4 sm:pt-6">
          {withLast.length === 0 ? <EmptyState title="No devices registered" hint="An admin can add machines under Setup." /> : (
            <Table>
              <caption className="sr-only">Biometric machines</caption>
              <THead><TR><TH>Machine</TH><TH>Status</TH><TH>Last seen</TH><TH>Last punch</TH><TH>Serial</TH><TH>IP</TH></TR></THead>
              <TBody>
                {withLast.map((d) => {
                  const online = d.is_active && d.last_seen_at && now - new Date(d.last_seen_at).getTime() < ONLINE_WITHIN_MS;
                  return (
                    <TR key={d.id}>
                      <TD><p className="font-medium">{d.name}</p><p className="text-xs text-muted-foreground">{d.location}</p></TD>
                      <TD>{!d.is_active ? <Badge variant="secondary">Disabled</Badge> : online ? <Badge variant="success">Online</Badge> : <Badge variant="destructive">Offline</Badge>}</TD>
                      <TD className="whitespace-nowrap">{d.last_seen_at ? fmtDateTime(d.last_seen_at) : 'never'}</TD>
                      <TD className="whitespace-nowrap">{d.lastPunch ? fmtDateTime(d.lastPunch) : '—'}</TD>
                      <TD className="font-mono text-xs">{d.device_serial}</TD>
                      <TD className="font-mono text-xs">{d.ip_address ?? '—'}</TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
