import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Dumbbell,
  RefreshCw,
  Users,
} from 'lucide-react';
import {
  fetchSessionDetail,
  fetchWorkoutLogs,
  sessionCompletion,
  type LogRow,
  type LogSession,
} from '@/services/workout-logs-service';
import { fmtDuration, fmtDayMonthYearClock, initialsOf, timeAgo } from '@/lib/format';
import { PageBar } from '@/components/common/page-header';
import { StatCard } from '@/components/common/stat-card';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { SearchInput } from '@/components/common/search-input';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/// Every completed workout across every user, newest first.
///
/// The panel had no screen for this because the data had no shape for it:
/// sessions live four collections deep under each user with no calendar index
/// above them, so "who trained today" was unanswerable from the client. The
/// backend answers it with a collection-group query now, and this pane is the
/// consumer.

const PAGE_SIZE = 50;

/// `totalDuration` is written by the client and is not always a session length.
/// Live data carries sessions stamped 95,098s (26 hours) and 443,478s (5 days)
/// — a timer that kept running after the app was backgrounded, not training.
/// Anything past six hours is treated as unusable rather than summed into a
/// total that would then be mostly noise. The row still shows the raw value,
/// flagged, because hiding it would make the bad records invisible.
const PLAUSIBLE_DURATION_S = 6 * 60 * 60;

const durationIsPlausible = (seconds: number) =>
  seconds > 0 && seconds <= PLAUSIBLE_DURATION_S;

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

const displayName = (row: LogRow) =>
  row.user.username?.trim() || row.user.email?.trim() || row.user.uid;

function CompletionBadge({ session }: { session: LogSession }) {
  const pct = Math.round(sessionCompletion(session));
  if (session.totalExercises === 0) {
    return (
      <Badge variant="secondary" title="No exercise records under this session">
        no detail
      </Badge>
    );
  }
  return (
    <Badge
      variant={pct >= 80 ? 'default' : pct >= 40 ? 'secondary' : 'outline'}
      title={`${session.completedExercises} of ${session.totalExercises} exercises had a completed set`}
    >
      {pct}%
    </Badge>
  );
}

/// One expanded row: the exercises, loaded on demand.
///
/// Not fetched with the feed on purpose — it is four Firestore reads per
/// session, so a 50-row page would cost 200 reads to fill a panel nobody has
/// opened.
function SessionDetail({ row }: { row: LogRow }) {
  const [session, setSession] = useState<LogSession | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    fetchSessionDetail({
      uid: row.uid,
      programId: row.programId,
      weekId: row.weekId,
      dayId: row.dayId,
    })
      .then((detail) => {
        if (!cancelled) setSession(detail);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load the session.');
      });
    return () => {
      cancelled = true;
    };
  }, [row.uid, row.programId, row.weekId, row.dayId]);

  if (error) return <p className="px-4 py-3 text-xs text-red-600 dark:text-red-400">{error}</p>;
  if (!session) return <LoadingState label="Loading exercises…" className="py-6" />;
  if (!session.exercises || session.exercises.length === 0) {
    return (
      <p className="px-4 py-3 text-xs text-muted-foreground">
        This session was marked complete but has no exercise records under it.
      </p>
    );
  }

  return (
    <div className="space-y-2 px-4 py-3">
      {session.exercises.map((exercise) => (
        <div key={`${exercise.exerciseType}-${exercise.exerciseId}`} className="rounded-md border p-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">{exercise.exerciseName}</span>
            <Badge variant="outline" className="text-[10px] uppercase">
              {exercise.exerciseType}
            </Badge>
            {exercise.isAlternative && (
              <Badge variant="secondary" className="text-[10px]">
                swapped
              </Badge>
            )}
          </div>
          {exercise.sets.length === 0 ? (
            <p className="mt-1 text-[11px] text-muted-foreground">No sets recorded.</p>
          ) : (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {exercise.sets.map((set) => (
                <span
                  key={set.setNumber}
                  className={cn(
                    'tabular rounded border px-1.5 py-0.5 text-[11px]',
                    set.completed
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                      : 'text-muted-foreground',
                  )}
                  title={set.completed ? 'Completed' : 'Not completed'}
                >
                  {set.reps ?? '—'}
                  {set.weight != null ? ` × ${set.weight}kg` : ''}
                  {set.duration != null && set.reps == null ? `${set.duration}s` : ''}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function WorkoutLogsPage() {
  const navigate = useNavigate();

  const [rows, setRows] = useState<LogRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const [from, setFrom] = useState('');
  const [to, setTo] = useState(toInputDate(new Date()));

  const load = useCallback(
    async (append: boolean, nextCursor: string | null) => {
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        const page = await fetchWorkoutLogs({
          limit: PAGE_SIZE,
          cursor: nextCursor,
          from: parseInputDate(from),
          to: parseInputDate(to),
        });
        setRows((current) => (append ? [...current, ...page.rows] : page.rows));
        setCursor(page.nextCursor);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not load the workout logs.');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [from, to],
  );

  useEffect(() => {
    void load(false, null);
  }, [load]);

  /// Search filters what has been LOADED, not the whole feed — the backend
  /// pages by date and has no name index, so a server-side search would be a
  /// full scan. The status line says so rather than letting an admin read an
  /// empty result as "this user never trained".
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) =>
      [row.user.username, row.user.email, row.user.uid, row.sessionName]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(needle)),
    );
  }, [rows, search]);

  const totals = useMemo(() => {
    const people = new Set(rows.map((row) => row.uid));
    const usable = rows.filter((row) => durationIsPlausible(row.duration));
    const today = toInputDate(new Date());
    return {
      sessions: rows.length,
      people: people.size,
      seconds: usable.reduce((sum, row) => sum + row.duration, 0),
      excluded: rows.filter((row) => row.duration > PLAUSIBLE_DURATION_S).length,
      today: rows.filter((row) => toInputDate(row.completedAt) === today).length,
    };
  }, [rows]);

  const status = loading
    ? 'Loading…'
    : `${visible.length} of ${rows.length} loaded${cursor ? ' (more available)' : ''}`;

  return (
    <div className="space-y-4">
      <PageBar
        title="Workout Logs"
        status={status}
        statusTitle="Search and the counters cover the sessions loaded so far, not the whole feed."
      >
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Filter loaded rows by user…"
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
        <Button
          variant="outline"
          size="sm"
          onClick={() => void load(false, null)}
          disabled={loading}
        >
          <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
          Refresh
        </Button>
      </PageBar>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Sessions loaded" value={totals.sessions} icon={<Dumbbell />} tone="primary" />
        <StatCard label="Distinct users" value={totals.people} icon={<Users />} />
        <StatCard label="Completed today" value={totals.today} icon={<Activity />} tone="success" />
        <StatCard
          label="Training time"
          value={fmtDuration(totals.seconds)}
          hint={
            totals.excluded > 0
              ? `${totals.excluded} session${totals.excluded === 1 ? '' : 's'} excluded as implausible`
              : 'across the loaded rows'
          }
          icon={<CalendarDays />}
          tone={totals.excluded > 0 ? 'warning' : 'default'}
        />
      </div>

      {error ? (
        <ErrorState
          error={error}
          onRetry={() => {
            void load(false, null);
          }}
        />
      ) : loading ? (
        <LoadingState label="Loading workout logs…" />
      ) : visible.length === 0 ? (
        <EmptyState
          title={rows.length === 0 ? 'No workouts in this range' : 'No rows match that search'}
          hint={
            rows.length === 0
              ? 'Nobody completed a session between those dates. Widen the range to see more.'
              : 'Search only covers the rows loaded so far — load more, or clear the filter.'
          }
          icon={<Dumbbell />}
        />
      ) : (
        <Card className="divide-y p-0">
          {visible.map((row) => {
            const key = `${row.uid}_${row.id}`;
            const open = expanded === key;
            return (
              <div key={key}>
                <div className="flex items-center gap-3 px-4 py-3">
                  <button
                    type="button"
                    onClick={() => setExpanded(open ? null : key)}
                    className="rounded p-1 text-muted-foreground hover:bg-accent"
                    aria-label={open ? 'Hide exercises' : 'Show exercises'}
                    aria-expanded={open}
                  >
                    {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                  </button>

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

                  <div className="hidden shrink-0 text-right sm:block">
                    <p className="tabular text-xs font-medium">{fmtDayMonthYearClock(row.completedAt)}</p>
                    <p className="text-[11px] text-muted-foreground">{timeAgo(row.completedAt)}</p>
                  </div>

                  <div className="tabular hidden w-20 shrink-0 text-right text-xs md:block">
                    {row.duration <= 0 ? (
                      '—'
                    ) : durationIsPlausible(row.duration) ? (
                      fmtDuration(row.duration)
                    ) : (
                      <span
                        className="text-amber-600 dark:text-amber-400"
                        title={`Recorded as ${fmtDuration(row.duration)} — the timer almost certainly kept running in the background. Not counted in the total.`}
                      >
                        {fmtDuration(row.duration)}?
                      </span>
                    )}
                  </div>

                  <div className="shrink-0">
                    <CompletionBadge session={row} />
                  </div>
                </div>
                {open && <div className="border-t bg-muted/30">
                  <SessionDetail row={row} />
                </div>}
              </div>
            );
          })}
        </Card>
      )}

      {!loading && !error && cursor && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={() => void load(true, cursor)}
            disabled={loadingMore}
          >
            {loadingMore ? 'Loading…' : `Load ${PAGE_SIZE} more`}
          </Button>
        </div>
      )}
    </div>
  );
}
