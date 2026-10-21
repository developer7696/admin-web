import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageSquareHeart, RefreshCw, Star, ThumbsDown, Users } from 'lucide-react';
import {
  fetchWorkoutRatings,
  STAR_KEYS,
  type LogRow,
  type RatingsSummary,
} from '@/services/workout-logs-service';
import { fmtDayMonthYearClock, initialsOf, timeAgo } from '@/lib/format';
import { PageBar } from '@/components/common/page-header';
import { StatCard } from '@/components/common/stat-card';
import { StarRating } from '@/components/common/star-rating';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { SearchInput } from '@/components/common/search-input';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/// Workout feedback: the 1–5 stars users give a session in the app's
/// workout-complete dialog ("Rated 5 of 5. Saved to this session.").
///
/// The rating lives on the session itself in Firestore, so this reads the same
/// sessions as Workout Logs and keeps only the rated ones. The summary always
/// covers the whole window; the star filter narrows the list, not the numbers.

/// `YYYY-MM-DD` in local time — `toISOString()` converts to UTC first, so an
/// admin in IST picking the 21st would send the 20th before 05:30.
const toInputDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const parseInputDate = (value: string): Date | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? null : date;
};

const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
};

const displayName = (row: LogRow) =>
  row.user.username?.trim() || row.user.email?.trim() || row.user.uid;

const pct = (part: number, whole: number) => (whole === 0 ? 0 : Math.round((part / whole) * 100));

/// One bar per star, 5 down to 1. Clicking a bar filters the list to that score.
function Distribution({
  summary,
  stars,
  onPick,
}: {
  summary: RatingsSummary;
  stars: number | null;
  onPick: (stars: number | null) => void;
}) {
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Rating breakdown
        </p>
        {stars !== null && (
          <Button variant="ghost" size="sm" onClick={() => onPick(null)}>
            Show all ratings
          </Button>
        )}
      </div>
      <div className="space-y-1.5">
        {STAR_KEYS.map((key) => {
          const n = Number(key);
          const count = summary.distribution[key];
          const share = pct(count, summary.rated);
          const active = stars === n;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onPick(active ? null : n)}
              aria-pressed={active}
              className={cn(
                'flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent',
                active && 'bg-accent',
                stars !== null && !active && 'opacity-50',
              )}
              title={active ? 'Show all ratings' : `Show only ${n}-star sessions`}
            >
              <span className="tabular flex w-8 shrink-0 items-center gap-1 text-sm font-semibold">
                {n}
                <Star aria-hidden className="size-3.5 fill-amber-400 text-amber-400" />
              </span>
              <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                <span
                  className={cn('block h-full rounded-full', n <= 2 ? 'bg-red-500' : n === 3 ? 'bg-amber-400' : 'bg-emerald-500')}
                  style={{ width: `${share}%` }}
                />
              </span>
              <span className="tabular w-20 shrink-0 text-right text-xs text-muted-foreground">
                {count} · {share}%
              </span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

export function WorkoutFeedbackPage() {
  const navigate = useNavigate();

  const [summary, setSummary] = useState<RatingsSummary | null>(null);
  const [rows, setRows] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [stars, setStars] = useState<number | null>(null);

  const [from, setFrom] = useState(toInputDate(daysAgo(30)));
  const [to, setTo] = useState(toInputDate(new Date()));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await fetchWorkoutRatings({
        from: parseInputDate(from),
        to: parseInputDate(to),
      });
      setSummary(page.summary);
      setRows(page.rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load workout feedback.');
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (stars !== null && row.rating !== stars) return false;
      if (!needle) return true;
      return [row.user.username, row.user.email, row.user.uid, row.sessionName, row.programId]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(needle));
    });
  }, [rows, search, stars]);

  const raters = useMemo(() => new Set(rows.map((row) => row.uid)).size, [rows]);
  const low = summary ? summary.distribution['1'] + summary.distribution['2'] : 0;

  const status = loading
    ? 'Loading…'
    : summary
      ? `${visible.length} of ${summary.rated} rated session${summary.rated === 1 ? '' : 's'}`
      : undefined;

  return (
    <div className="space-y-4">
      <PageBar
        title="Workout Feedback"
        status={status}
        statusTitle="Ratings users gave in the workout-complete dialog, for the dates chosen."
      >
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Filter by user or session…"
          className="w-56"
        />
        <Input
          type="date"
          value={from}
          max={to || undefined}
          onChange={(e) => setFrom(e.target.value)}
          className="w-[9.5rem]"
          title="From (inclusive)"
        />
        <Input
          type="date"
          value={to}
          min={from || undefined}
          onChange={(e) => setTo(e.target.value)}
          className="w-[9.5rem]"
          title="To (inclusive)"
        />
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
          Refresh
        </Button>
      </PageBar>

      {error ? (
        <ErrorState error={error} onRetry={() => void load()} />
      ) : loading || !summary ? (
        <LoadingState label="Loading workout feedback…" />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Average rating"
              value={summary.average === null ? '—' : `${summary.average.toFixed(1)} / 5`}
              hint={summary.average === null ? 'No ratings yet' : <StarRating rating={Math.round(summary.average)} />}
              icon={<Star />}
              tone="primary"
            />
            <StatCard
              label="Rated sessions"
              value={summary.rated}
              hint={`${pct(summary.rated, summary.completed)}% of ${summary.completed} completed`}
              icon={<MessageSquareHeart />}
            />
            <StatCard
              label="Users who rated"
              value={raters}
              icon={<Users />}
              tone="success"
            />
            <StatCard
              label="Low ratings (1–2★)"
              value={low}
              hint={low > 0 ? 'Click 1 or 2 in the breakdown to see them' : 'None in this range'}
              icon={<ThumbsDown />}
              tone={low > 0 ? 'warning' : 'default'}
              onClick={low > 0 ? () => setStars(summary.distribution['1'] > 0 ? 1 : 2) : undefined}
            />
          </div>

          {summary.truncated && (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              This range holds more sessions than one request reads, so the numbers cover the most
              recent ones only. Narrow the dates for an exact count.
            </p>
          )}

          {summary.rated > 0 && <Distribution summary={summary} stars={stars} onPick={setStars} />}

          {visible.length === 0 ? (
            <EmptyState
              title={summary.rated === 0 ? 'No ratings in this range' : 'No ratings match'}
              hint={
                summary.rated === 0
                  ? 'Users rate a session from the workout-complete dialog. Widen the dates to see more.'
                  : 'Clear the search or the star filter.'
              }
              icon={<MessageSquareHeart />}
            />
          ) : (
            <Card className="divide-y p-0">
              {visible.map((row) => (
                <div key={`${row.uid}_${row.id}`} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">
                    {initialsOf(row.user.username ?? '', row.user.email ?? '')}
                  </div>

                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => navigate(`/users/${row.uid}/workouts`)}
                      className="truncate text-sm font-semibold hover:underline"
                      title="Open this user's workout history"
                    >
                      {displayName(row)}
                    </button>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {row.sessionName} · {row.programId}
                    </p>
                  </div>

                  {row.rating !== null && <StarRating rating={row.rating} size="md" className="shrink-0" />}

                  <div className="hidden w-40 shrink-0 text-right sm:block">
                    <p className="tabular text-xs font-medium">{fmtDayMonthYearClock(row.completedAt)}</p>
                    <p className="text-[11px] text-muted-foreground">{timeAgo(row.completedAt)}</p>
                  </div>
                </div>
              ))}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
