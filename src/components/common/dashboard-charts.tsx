import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { DayPoint } from '@/types/dashboard';

/// Charting surface for the dashboard overview.
///
/// Series colours are the validated categorical slots `--chart-1…6` from
/// `index.css`, assigned in FIXED order and never cycled — colour follows the
/// entity, so changing the cohort must not repaint the survivors. Three of the
/// light-mode slots sit under 3:1 against the card surface, so nothing here
/// carries meaning by colour alone: every series is named next to its swatch
/// with its own value, and every share row is direct-labelled with a count and
/// a percentage.

const SERIES = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
];

export const seriesColor = (index: number) => SERIES[index % SERIES.length];

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number; color?: string }[];
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 shadow-lg">
      {label != null && <p className="mb-1 text-xs font-semibold">{label}</p>}
      {payload.map((entry, i) => (
        <p key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="size-2 rounded-full" style={{ background: entry.color }} />
          <span>{entry.name}</span>
          <span className="tabular ml-auto font-semibold text-foreground">{entry.value}</span>
        </p>
      ))}
    </div>
  );
}

/// Daily signups and subscription activations over the last 30 days.
///
/// The server returns a DENSE series — a day with nothing still arrives as a
/// zero — so a quiet week reads as a flat line rather than silently closing the
/// gap and implying steady growth.
///
/// Both series count people per day, so they share one axis. Two measures of
/// different scale would need two charts, never a second y-axis.
export function SignupTrendChart({
  timeline,
  subtitle,
}: {
  timeline: DayPoint[];
  /// What the axis actually spans. Passed in rather than assumed, because the
  /// window follows the date filter and the buckets roll up to months past 92
  /// days — a hardcoded "last 30 days, per day" would be a lie under a filter.
  subtitle: string;
}) {
  const signups = timeline.reduce((n, d) => n + d.signups, 0);
  const activations = timeline.reduce((n, d) => n + d.activations, 0);

  const legend = [
    { name: 'Signups', total: signups, color: seriesColor(0) },
    { name: 'Activations', total: activations, color: seriesColor(1) },
  ];

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-xs font-bold">Signups &amp; activations</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <ul className="flex items-center gap-4">
          {legend.map((s) => (
            <li key={s.name} className="flex items-center gap-2 text-xs">
              <span className="size-2.5 rounded-full" style={{ background: s.color }} />
              <span className="text-muted-foreground">{s.name}</span>
              <span className="tabular font-bold">{s.total}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-3 h-[180px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={timeline} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
            <defs>
              {legend.map((s, i) => (
                <linearGradient key={s.name} id={`dash-fill-${i}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={s.color} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: 'var(--border)' }}
              // 30 daily labels cannot fit; recharts drops the ones that would
              // collide rather than overlapping them.
              minTickGap={28}
            />
            <YAxis
              tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={44}
              allowDecimals={false}
            />
            <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'var(--border)' }} />
            <Area
              type="monotone"
              dataKey="signups"
              name="Signups"
              stroke={seriesColor(0)}
              strokeWidth={2}
              fill="url(#dash-fill-0)"
              dot={false}
              activeDot={{ r: 4, stroke: 'var(--card)', strokeWidth: 2 }}
              // The series is re-fetched on every refresh and every cohort
              // switch; replaying a grow-in animation each time is noise, and
              // it makes the chart read as changing when only the filter did.
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="activations"
              name="Activations"
              stroke={seriesColor(1)}
              strokeWidth={2}
              fill="url(#dash-fill-1)"
              dot={false}
              activeDot={{ r: 4, stroke: 'var(--card)', strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

export type ShareRow = { label: string; value: number; hint?: string };

/// Part-to-whole across a handful of mutually exclusive buckets.
///
/// A stacked bar rather than a pie: these are compared against each other and
/// against 100%, which is what a single bar shows and a pie makes you estimate
/// from angles. Segments carry a 2px surface gap so adjacent fills stay
/// separable, and every bucket is listed below with its own count and share —
/// a reader who cannot separate two hues still reads the table.
export function ShareCard({
  title,
  subtitle,
  rows,
  footer,
  className,
}: {
  title: string;
  subtitle?: string;
  rows: ShareRow[];
  footer?: React.ReactNode;
  className?: string;
}) {
  const total = rows.reduce((n, r) => n + r.value, 0);
  const pct = (v: number) => (total > 0 ? (v / total) * 100 : 0);

  return (
    <Card className={cn('flex flex-col p-4', className)}>
      <h2 className="text-xs font-bold">{title}</h2>
      {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}

      {total === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">Nothing to show yet.</p>
      ) : (
        <>
          <div className="mt-3 flex h-2 w-full gap-0.5 overflow-hidden rounded-full">
            {/* Indexed BEFORE the zero-filter: colour follows the bucket, so a
                bucket emptying out must not repaint the ones still there — and
                the bar must not disagree with the list below it. */}
            {rows
              .map((r, i) => ({ ...r, color: seriesColor(i) }))
              .filter((r) => r.value > 0)
              .map((r) => (
                <div
                  key={r.label}
                  className="h-full first:rounded-l-full last:rounded-r-full"
                  style={{ width: `${pct(r.value)}%`, background: r.color }}
                  title={`${r.label}: ${r.value}`}
                />
              ))}
          </div>

          <ul className="mt-3">
            {rows.map((r, i) => (
              <li key={r.label} className="flex items-center gap-2 py-1 text-[11px]">
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ background: seriesColor(i) }}
                />
                <span className="min-w-0 flex-1 truncate font-medium">{r.label}</span>
                {r.hint && (
                  <span className="hidden shrink-0 text-muted-foreground sm:inline">{r.hint}</span>
                )}
                <span className="tabular w-10 shrink-0 text-right font-bold">{r.value}</span>
                <span className="tabular w-11 shrink-0 text-right text-muted-foreground">
                  {Math.round(pct(r.value))}%
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {footer && <div className="mt-auto pt-2.5 text-[11px] text-muted-foreground">{footer}</div>}
    </Card>
  );
}
