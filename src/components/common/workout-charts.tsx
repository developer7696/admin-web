import { useMemo } from 'react';
import {
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ExerciseProgress } from '@/services/admin-workout-service';
import { fmtMonthDayShort } from '@/lib/format';
import { Card } from '@/components/ui/card';

/// Charts for the per-user workout tracker.
///
/// Series colours come from the validated categorical slots in `index.css`
/// (`--chart-1…6`), assigned in FIXED order and never cycled — the colour
/// follows the entity, so filtering the list must not repaint the survivors.
/// Three of the light-mode slots sit under 3:1 against the surface, so both
/// charts here carry direct labels and a legend rather than relying on colour.

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
    <div className="rounded-lg border border-border bg-popover px-3 py-2 shadow-lg">
      {label != null && <p className="mb-1 text-xs font-semibold">{label}</p>}
      {payload.map((entry, i) => (
        <p key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="size-2 rounded-full" style={{ background: entry.color }} />
          <span>{entry.name}</span>
          <span className="tabular ml-auto font-semibold text-foreground">
            {typeof entry.value === 'number' ? Math.round(entry.value * 10) / 10 : entry.value}
          </span>
        </p>
      ))}
    </div>
  );
}

/// Share of sets by muscle group. Part-to-whole over at most six groups, with
/// the count and percentage written next to each swatch — identity is never
/// colour alone.
export function MuscleGroupChart({ data }: { data: Record<string, number> }) {
  const rows = useMemo(() => {
    const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
    const top = entries.slice(0, 6);
    const rest = entries.slice(6);
    // A seventh group is never a generated hue — it folds into "Other".
    if (rest.length > 0) {
      top.push(['Other', rest.reduce((n, [, v]) => n + v, 0)]);
    }
    return top.map(([name, value], i) => ({ name, value, fill: SERIES[i % SERIES.length] }));
  }, [data]);

  const total = rows.reduce((n, r) => n + r.value, 0);

  if (total === 0) {
    return (
      <Card className="flex h-[200px] items-center justify-center">
        <p className="text-sm text-muted-foreground">No muscle group data available</p>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
      <div className="h-[180px] w-full sm:w-[200px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={rows}
              dataKey="value"
              nameKey="name"
              innerRadius={44}
              outerRadius={78}
              paddingAngle={2}
              stroke="var(--card)"
              strokeWidth={2}
            >
              {rows.map((row) => (
                <Cell key={row.name} fill={row.fill} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip />} />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <ul className="min-w-0 flex-1">
        {rows.map((row) => (
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
    </Card>
  );
}

/// Strength trend per exercise. One line each for the top five improving
/// exercises; a sixth would be cycled colour, so the list is capped instead.
export function ExerciseProgressChart({ exercises }: { exercises: ExerciseProgress[] }) {
  const top = exercises.slice(0, 5);

  const { rows, keys } = useMemo(() => {
    // Points are keyed by day so several exercises logged on the same date land
    // on one x position rather than drawing a sawtooth.
    const byDate = new Map<number, Record<string, number | string>>();
    const names: string[] = [];

    for (const exercise of top) {
      names.push(exercise.exerciseName);
      for (const point of exercise.dataPoints) {
        const day = new Date(
          point.date.getFullYear(),
          point.date.getMonth(),
          point.date.getDate(),
        ).getTime();
        const row = byDate.get(day) ?? { day, label: fmtMonthDayShort(new Date(day)) };
        // Several metrics can land on one day; the largest is the day's best.
        const prev = row[exercise.exerciseName];
        row[exercise.exerciseName] =
          typeof prev === 'number' ? Math.max(prev, point.value) : point.value;
        byDate.set(day, row);
      }
    }

    return {
      rows: [...byDate.values()].sort((a, b) => (a.day as number) - (b.day as number)),
      keys: names,
    };
  }, [top]);

  if (rows.length === 0) {
    return (
      <Card className="flex h-[240px] items-center justify-center">
        <p className="text-sm text-muted-foreground">No progress data available</p>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <div className="h-[260px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 4, left: -12 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: 'var(--border)' }}
            />
            <YAxis
              tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={48}
            />
            <Tooltip content={<ChartTooltip />} />
            <Legend
              wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
              iconType="plainline"
              iconSize={14}
            />
            {keys.map((key, i) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                name={key}
                stroke={SERIES[i % SERIES.length]}
                strokeWidth={2}
                dot={{ r: 3, strokeWidth: 0 }}
                activeDot={{ r: 5, stroke: 'var(--card)', strokeWidth: 2 }}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
