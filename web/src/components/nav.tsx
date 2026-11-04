'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { UtensilsCrossed } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Role } from '@/lib/types';

const LINKS: Record<Role, { href: string; label: string }[]> = {
  student: [
    { href: '/dashboard', label: 'Wallet' }, { href: '/plan', label: 'Plan tomorrow' }, { href: '/today', label: 'Today' },
    { href: '/meals', label: 'Meal log' }, { href: '/disputes', label: 'Disputes' },
  ],
  manager: [
    { href: '/manager/scan', label: 'Scan QR' }, { href: '/manager', label: 'Live' }, { href: '/manager/students', label: 'Students' },
    { href: '/manager/disputes', label: 'Disputes' }, { href: '/manager/devices', label: 'Devices' },
  ],
  admin: [
    { href: '/admin', label: 'Admin panel' }, { href: '/manager/disputes', label: 'Disputes' }, { href: '/manager', label: 'Live' },
    { href: '/admin/setup', label: 'Setup' }, { href: '/admin/refunds', label: 'Refunds' }, { href: '/admin/audit', label: 'Audit' },
  ],
};

export function Nav({ role, name, signOut }: { role: Role; name: string; signOut: () => Promise<void> }) {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:rounded focus:bg-background focus:p-2">Skip to content</a>
      <div className="container flex items-center justify-between gap-3 py-2">
        <div className="flex items-center gap-2">
          <UtensilsCrossed className="h-5 w-5 text-primary" aria-hidden />
          <span className="font-semibold">Mess Portal</span>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="hidden text-muted-foreground sm:inline">{name} · {role}</span>
          <form action={signOut}><button className="rounded-md px-2 py-1.5 text-muted-foreground underline-offset-4 hover:underline" type="submit">Sign out</button></form>
        </div>
      </div>
      <nav aria-label="Main" className="container -mb-px flex gap-1 overflow-x-auto pb-1">
        {LINKS[role].map((l) => {
          const active = path === l.href || (l.href !== '/manager' && l.href !== '/admin' && path.startsWith(l.href + '/'));
          return (
            <Link key={l.href} href={l.href} aria-current={active ? 'page' : undefined}
              className={cn('whitespace-nowrap rounded-md px-3 py-2 text-sm', active ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground hover:bg-muted')}>
              {l.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
