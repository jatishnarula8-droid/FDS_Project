import * as React from 'react';
import { cn } from '@/lib/utils';

/** Scrolls horizontally on phones instead of breaking the page layout. */
export const Table = ({ className, ...p }: React.TableHTMLAttributes<HTMLTableElement>) => (
  <div className="w-full overflow-x-auto" tabIndex={0} role="region" aria-label="Data table">
    <table className={cn('w-full caption-bottom text-sm', className)} {...p} />
  </div>
);
export const THead = (p: React.HTMLAttributes<HTMLTableSectionElement>) => <thead {...p} />;
export const TBody = (p: React.HTMLAttributes<HTMLTableSectionElement>) => <tbody {...p} />;
export const TR = ({ className, ...p }: React.HTMLAttributes<HTMLTableRowElement>) => (
  <tr className={cn('border-b transition-colors hover:bg-muted/50', className)} {...p} />
);
export const TH = ({ className, ...p }: React.ThHTMLAttributes<HTMLTableCellElement>) => (
  <th scope="col" className={cn('h-10 px-3 text-left align-middle text-xs font-medium uppercase tracking-wide text-muted-foreground', className)} {...p} />
);
export const TD = ({ className, ...p }: React.TdHTMLAttributes<HTMLTableCellElement>) => (
  <td className={cn('px-3 py-2.5 align-middle', className)} {...p} />
);
