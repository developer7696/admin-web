import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { FunnelStage, MonthlyPoint } from '@/types/conversion';
import { Card } from '@/components/ui/card';

/// Conversion-report charts. Series colours are the same validated
/// `--chart-1…6` slots as the workout tracker — assigned in fixed order, never
/// cycled, and every slice/bar carries a direct label because three light-mode
/// slots sit under 3:1 on the card surface.

const SERIES = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
];

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
    <div className="rounded-lg border border-border bg-popover px-3 py-2">
      {label != null && <p className="mb-1 text-xs font-semibold">{label}</p>}
      {payload.map((entry, i) => (
        <p key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="size-2 rounded-full" style={{ background: entry.color }} />
          <span>{entry.name}</span>
          <span className="tabular ml-auto font-semibold text-foreground">
            {typeof entry.value === 'number' ? entry.value.toLocaleString('en-IN') : entry.value}
          </span>
        </p>
      ))}
    </div>
  );
}

/// Signups, trial stamps and activations per month. The three series are
/// independent events, not one cohort moving through time.
export function MonthlyTimelineChart({ data }: { data: MonthlyPoint[] }) {
  if (data.length === 0) return null;

  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold">Signups, trials and activations by month</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Trial bars include the old auto-grant at signup. Activations are paid entitlements
        starting, not renewals.
      </p>
      <div className="mt-3 h-[280px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: -12 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: 'var(--border)' }}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={40}
            />
            <Tooltip content={<ChartTooltip />} />
            <Legend
              wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
              iconType="circle"
              iconSize={8}
            />
            <Bar dataKey="signups" name="Signups" fill={SERIES[0]} radius={[3, 3, 0, 0]} />
            <Bar dataKey="trials" name="Trials (incl. auto-grant)" fill={SERIES[1]} radius={[3, 3, 0, 0]} />
            <Bar dataKey="activations" name="Activations" fill={SERIES[2]} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

/// Horizontal funnel. Each bar is labelled with the count so identity is not
/// colour alone; drop-off notes sit under the chart.
export function FunnelChart({
  data,
  title,
  caption,
}: {
  data: FunnelStage[];
  title: string;
  caption?: string;
}) {
  const rows = data.map((stage, i) => ({
    ...stage,
    fill: SERIES[Math.min(i, SERIES.length - 1)],
  }));
  const max = Math.max(...rows.map((r) => r.value), 1);

  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      {caption && <p className="mt-0.5 text-xs text-muted-foreground">{caption}</p>}
      <div className="mt-4 h-[240px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={rows}
            layout="vertical"
            margin={{ top: 4, right: 48, bottom: 4, left: 8 }}
          >
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" horizontal={false} />
            <XAxis
              type="number"
              domain={[0, max]}
              allowDecimals={false}
              tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              type="category"
              dataKey="label"
              width={140}
              tick={{ fill: 'var(--foreground)', fontSize: 11 }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip content={<ChartTooltip />} />
            <Bar dataKey="value" name="Count" radius={[0, 4, 4, 0]} barSize={18}>
              {rows.map((row) => (
                <Cell key={row.label} fill={row.fill} />
              ))}
              <LabelList
                dataKey="value"
                position="right"
                className="tabular fill-foreground text-[11px] font-semibold"
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {rows.some((r) => r.note) && (
        <ul className="mt-2 space-y-1 text-[11px] text-muted-foreground">
          {rows.map((row, i) => {
            if (!row.note || i === rows.length - 1) return null;
            const next = rows[i + 1];
            const drop = row.value - next.value;
            if (drop <= 0) return null;
            return (
              <li key={row.label}>
                {drop.toLocaleString('en-IN')} dropped after “{row.label}” — {row.note}.
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export function DonutBreakdown({
  title,
  caption,
  rows,
}: {
  title: string;
  caption?: string;
  rows: { name: string; value: number }[];
}) {
  const coloured = rows
    .filter((r) => r.value > 0)
    .map((r, i) => ({ ...r, fill: SERIES[Math.min(i, SERIES.length - 1)] }));
  const total = coloured.reduce((n, r) => n + r.value, 0);
  if (total === 0) return null;

  return (
    <Card className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold">{title}</h3>
        {caption && <p className="mt-0.5 text-xs text-muted-foreground">{caption}</p>}
        <ul className="mt-3">
          {coloured.map((row) => (
            <li key={row.name} className="mb-2 flex items-center gap-2 text-xs">
              <span className="size-3 shrink-0 rounded-full" style={{ background: row.fill }} />
              <span className="min-w-0 flex-1 truncate">{row.name}</span>
              <span className="tabular shrink-0 text-muted-foreground">{row.value}</span>
              <span className="tabular w-10 shrink-0 text-right font-semibold">
                {Math.round((row.value / total) * 100)}%
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="h-[160px] w-full shrink-0 sm:w-[180px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={coloured}
              dataKey="value"
              nameKey="name"
              innerRadius={40}
              outerRadius={70}
              paddingAngle={2}
              stroke="var(--card)"
              strokeWidth={2}
            >
              {coloured.map((row) => (
                <Cell key={row.name} fill={row.fill} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip />} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

export function RankedBars({
  title,
  caption,
  rows,
  unit = 'users',
}: {
  title: string;
  caption?: string;
  rows: { name: string; value: number }[];
  unit?: string;
}) {
  if (rows.length === 0) return null;
  const max = Math.max(...rows.map((r) => r.value), 1);

  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      {caption && <p className="mt-0.5 text-xs text-muted-foreground">{caption}</p>}
      <ul className="mt-4 space-y-2.5">
        {rows.map((row) => (
          <li key={row.name}>
            <div className="flex items-baseline gap-2 text-xs">
              <span className="min-w-0 flex-1 truncate font-medium">{row.name}</span>
              <span className="tabular shrink-0 font-semibold">{row.value}</span>
              <span className="shrink-0 text-muted-foreground">{unit}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-[var(--chart-1)]"
                style={{ width: `${(row.value / max) * 100}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
