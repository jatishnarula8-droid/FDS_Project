'use client';

import { Button } from '@/components/ui/button';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="container flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        {error.message || 'An unexpected error occurred.'} If this keeps happening, tell the mess office{error.digest ? ` (ref ${error.digest})` : ''}.
      </p>
      <Button onClick={reset}>Try again</Button>
    </main>
  );
}
