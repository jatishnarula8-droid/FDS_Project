import { requireProfile } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDateTime } from '@/lib/time';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/states';

export const metadata = { title: 'Audit log · MNIT Mess Portal' };

export default async function AuditPage() {
  await requireProfile(['admin']);
  const supabase = createClient();
  const { data } = await supabase.from('audit_log').select('id, actor_id, action, entity, entity_id, details, created_at').order('created_at', { ascending: false }).limit(200);
  const rows = data ?? [];
  const ids = [...new Set(rows.map((r) => r.actor_id).filter(Boolean))] as string[];
  const { data: actors } = ids.length ? await supabase.from('profiles').select('id, full_name').in('id', ids) : { data: [] };
  const name = new Map((actors ?? []).map((a) => [a.id, a.full_name]));

  return (
    <>
      <PageHeader title="Audit log" description="Latest 200 changes to rates, windows, semesters, devices, PIN mappings, disputes and refunds." />
      <Card>
        <CardContent className="pt-4 sm:pt-6">
          {rows.length === 0 ? <EmptyState title="Nothing logged yet" /> : (
            <Table>
              <caption className="sr-only">Audit log</caption>
              <THead><TR><TH>When</TH><TH>Who</TH><TH>Action</TH><TH>Entity</TH><TH>Details</TH></TR></THead>
              <TBody>{rows.map((r) => (
                <TR key={r.id} className="align-top">
                  <TD className="whitespace-nowrap">{fmtDateTime(r.created_at)}</TD>
                  <TD>{r.actor_id ? name.get(r.actor_id) ?? r.actor_id.slice(0, 8) : 'system'}</TD>
                  <TD className="font-medium">{r.action}</TD>
                  <TD>{r.entity}</TD>
                  <TD><details><summary className="cursor-pointer text-xs text-primary">view</summary>
                    <pre className="mt-1 max-h-48 max-w-md overflow-auto rounded bg-muted p-2 text-[11px]">{JSON.stringify(r.details, null, 2)}</pre></details></TD>
                </TR>))}</TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
