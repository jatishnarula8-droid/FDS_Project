import Link from 'next/link';
import { monthBounds } from '@/lib/time';

/**
 * Month grid. Shade = how many of the 4 meals were eaten that day. The count is printed in every cell
 * (so colour is never the only signal). Past days with 0 meals link to "I ate but it didn't register".
 */
export function CalendarHeat({ month, counts, today, semesterStart, semesterEnd }: {
  month: string; counts: Record<string, number>; today: string; semesterStart: string; semesterEnd: string;
}) {
  const { days } = monthBounds(month);
  const firstDow = new Date(`${month}-01T00:00:00Z`).getUTCDay(); // 0 = Sunday
  const cells: (number | null)[] = [...Array(firstDow).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const shade = ['bg-muted', 'bg-primary/20', 'bg-primary/40', 'bg-primary/65', 'bg-primary/90 text-primary-foreground'];

  return (
    <div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted-foreground" aria-hidden>
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <div key={i}>{d}</div>)}
      </div>
      <ol className="mt-1 grid grid-cols-7 gap-1" aria-label={`Meals eaten per day in ${month}`}>
        {cells.map((d, i) => {
          if (d === null) return <li key={i} aria-hidden />;
          const date = `${month}-${String(d).padStart(2, '0')}`;
          const n = counts[date] ?? 0;
          const inSem = date >= semesterStart && date <= semesterEnd;
          const past = date <= today;
          const label = `${date}: ${n} of 4 meals eaten`;
          const cls = `flex aspect-square flex-col items-center justify-center rounded-md text-xs ${inSem && past ? shade[Math.min(n, 4)] : 'border border-dashed text-muted-foreground'} ${date === today ? 'ring-2 ring-ring' : ''}`;
          const inner = (<><span className="font-medium">{d}</span><span className="text-[10px] opacity-80">{inSem && past ? `${n}/4` : ''}</span></>);
          return (
            <li key={i}>
              {inSem && past && n === 0
                ? <Link href={`/disputes?kind=missing_punch&date=${date}#new`} className={cls} aria-label={`${label}. Report a missed punch`}>{inner}</Link>
                : <div className={cls} role="img" aria-label={label}>{inner}</div>}
            </li>
          );
        })}
      </ol>
      <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        Fewer meals
        {shade.map((s, i) => <span key={i} className={`inline-block h-3 w-5 rounded ${s.split(' ')[0]}`} aria-hidden />)}
        More meals. Tap an empty past day if you ate but it did not register.
      </p>
    </div>
  );
}
