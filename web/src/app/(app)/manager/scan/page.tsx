import { requireProfile } from '@/lib/session';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Scanner } from '@/components/scanner';

export const metadata = { title: 'Scan QR · MNIT Mess Portal' };

export default async function ScanPage() {
  await requireProfile(['manager', 'admin']);
  return (
    <>
      <PageHeader title="Scan a student's QR" description="Serve food only when the screen turns green. A scan records the meal and takes its rate off the student's balance." />
      <Card className="max-w-xl"><CardContent className="pt-4 sm:pt-6"><Scanner /></CardContent></Card>
    </>
  );
}
