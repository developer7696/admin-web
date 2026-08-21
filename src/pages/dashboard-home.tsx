import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bell,
  CalendarRange,
  CreditCard,
  Download,
  Hourglass,
  Info,
  Loader2,
  TrendingDown,
  TrendingUp,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useDashboardOverview } from '@/hooks/use-dashboard';
import type {
  Cohort,
  DashboardAlert,
  DashboardOverview,
  PlatformFilter,
} from '@/types/dashboard';
import { getUsersCsvData, syncToGoogleSheets } from '@/services/admin-user-service';
import { downloadCsv } from '@/lib/csv';
import { rupeesFromPaise, timeAgo, timelineSubtitle, toDateInput } from '@/lib/format';
import { PageShell } from '@/components/common/page-header';
import { ShareCard, SignupTrendChart } from '@/components/common/dashboard-charts';
import { ErrorState, LoadingState } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/// The admin home screen: how the application is doing, in the order an
/// operator asks it — how many people are here, how many are still training,
/// how many are paying, how many trials are live, and what needs doing today.
///
/// Two things this screen is careful about, because getting either wrong makes
/// every number on it misleading:
///
/// **"Active" is trained recently, not opened the app recently.** Firestore
/// holds no login or session timestamp — `lastWorkout` is the only presence
/// signal the app writes — so this is a stricter bar than DAU and is labelled
/// as such wherever it appears. It is also kept visually apart from
/// subscription "active", which is a different question entirely.
///
/// **Rates are computed over customers, not over our own accounts.** The cohort
/// toggle defaults to excluding internal and QA users; the count it excluded is
/// always shown, so the number is never quietly different from the Users page.

function pct(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

/// A headline number with the one comparison that makes it mean something.
/// Deliberately not a chart — each of these is a single value, and a sparkline
/// beside it would decorate rather than inform.
function Kpi({
  label,
  value,
  hint,
  icon,
  trend,
  accent,
}: {
  label: string;
  value: string;
  hint: React.ReactNode;
  icon: React.ReactNode;
  trend?: { direction: 'up' | 'down' | 'flat'; text: string };
  accent: string;
}) {
  const TrendIcon =
    trend?.direction === 'up' ? TrendingUp : trend?.direction === 'down' ? TrendingDown : null;

  return (
    <Card className="flex flex-col gap-2 p-3.5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <span className={cn('shrink-0 rounded-md p-1.5 [&_svg]:size-3.5', accent)}>{icon}</span>
      </div>
      <p className="tabular text-2xl font-extrabold leading-none">{value}</p>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] leading-tight text-muted-foreground">
        {trend && (
          <span
            className={cn(
              'inline-flex items-center gap-1 font-bold',
              trend.direction === 'up' && 'text-emerald-600 dark:text-emerald-400',
              trend.direction === 'down' && 'text-red-600 dark:text-red-400',
            )}
          >
            {TrendIcon && <TrendIcon className="size-3.5" />}
            {trend.text}
          </span>
        )}
        <span className="min-w-0">{hint}</span>
      </div>
    </Card>
  );
}

const ALERT_STYLE: Record<DashboardAlert['severity'], { icon: React.ReactNode; className: string }> =
  {
    critical: {
      icon: <AlertTriangle />,
      className: 'text-red-600 dark:text-red-400 bg-red-500/10',
    },
    warning: {
      icon: <Bell />,
      className: 'text-amber-600 dark:text-amber-400 bg-amber-500/10',
    },
    info: { icon: <Info />, className: 'text-blue-600 dark:text-blue-400 bg-blue-500/10' },
  };

/// Findings arrive already filtered to a non-zero count and sorted by size, so
/// an empty list genuinely means there is nothing to do.
function AlertRow({ alert }: { alert: DashboardAlert }) {
  const style = ALERT_STYLE[alert.severity];
  const body = (
    <>
      <span className={cn('shrink-0 rounded-md p-1.5 [&_svg]:size-3.5', style.className)}>
        {style.icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold">{alert.title}</span>
        <span className="block truncate text-[11px] text-muted-foreground">{alert.detail}</span>
      </span>
      <span className="tabular shrink-0 text-base font-extrabold">{alert.count}</span>
      {alert.href && <ArrowRight className="size-4 shrink-0 text-muted-foreground" />}
    </>
  );

  const className =
    'flex items-center gap-2.5 border-b border-border px-4 py-2.5 last:border-b-0 text-left';

  return alert.href ? (
    <Link to={alert.href} className={cn(className, 'transition-colors hover:bg-accent/50')}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

const PLATFORMS: { key: PlatformFilter; label: string }[] = [
  { key: 'all', label: 'Overall' },
  { key: 'ios', label: 'iOS' },
  { key: 'android', label: 'Android' },
];

import { SHEETS_SCRIPT_URL } from '@/lib/constants';

const COHORTS: { key: Cohort; label: string }[] = [
  { key: 'customers', label: 'Customers' },
  { key: 'all', label: 'Everyone' },
];


/// The CSV export still reads Firestore directly and speaks the old filter
/// vocabulary. Translating here keeps the page on one filter model rather than
/// threading two through every handler.
const csvPlatform = (p: PlatformFilter) =>
  p === 'ios' ? 'iOS' : p === 'android' ? 'Android' : 'Overall';

function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-1 rounded-lg border border-border bg-card p-1">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          className={cn(
            'whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-bold transition-colors',
            value === o.key
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-secondary',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Overview({ data }: { data: DashboardOverview }) {
  const { audience, users, activity, subscriptions, trials, windows } = data;

  const excluded = audience.qa + audience.internal;
  const growth =
    users.growthPct == null
      ? undefined
      : {
          direction:
            users.growthPct > 0 ? ('up' as const) : users.growthPct < 0 ? ('down' as const) : ('flat' as const),
          text: `${users.growthPct > 0 ? '+' : ''}${Math.round(users.growthPct)}%`,
        };

  const platformRows = useMemo(
    () =>
      (['iOS', 'Android', 'Unknown'] as const)
        .map((key) => ({ label: key, value: data.platform[key] ?? 0 }))
        .filter((r) => r.value > 0 || r.label !== 'Unknown'),
    [data.platform],
  );

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Total users"
          value={String(users.total)}
          icon={<Users />}
          accent="bg-blue-500/10 text-blue-600 dark:text-blue-400"
          trend={growth}
          hint={
            <>
              {users.new30d} in 30d · {users.newToday} today
            </>
          }
        />
        <Kpi
          label={`Active (${windows.activeDays}d)`}
          value={String(activity.active)}
          icon={<Activity />}
          accent="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          hint={
            <>
              {pct(activity.active, users.total)}% of users · trained, not just opened the app
            </>
          }
        />
        <Kpi
          label="Paying subscribers"
          value={String(subscriptions.paying)}
          icon={<CreditCard />}
          accent="bg-violet-500/10 text-violet-600 dark:text-violet-400"
          hint={
            <>
              {subscriptions.premium} Premium · {subscriptions.basic} Basic · {subscriptions.comp}{' '}
              comped
            </>
          }
        />
        <Kpi
          label="Free trials running"
          value={String(trials.running)}
          icon={<Hourglass />}
          accent="bg-amber-500/10 text-amber-600 dark:text-amber-400"
          hint={
            <>
              {trials.endingSoon} ending within 2 days · {windows.trialDays}-day window
            </>
          }
        />
      </div>

      {/* Below the headline numbers, not above them: the four KPIs are what the
          screen is opened for, and an empty to-do list should not be the first
          thing between the admin and them. */}
      {data.alerts.length > 0 && (
        <Card className="overflow-hidden p-0">
          <div className="flex items-center gap-2 border-b border-border px-4 py-2">
            <h2 className="text-xs font-bold">Needs attention</h2>
            <Badge variant="secondary">{data.alerts.length}</Badge>
          </div>
          {data.alerts.map((a) => (
            <AlertRow key={a.id} alert={a} />
          ))}
        </Card>
      )}

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SignupTrendChart
            timeline={data.timeline}
            subtitle={timelineSubtitle({
              from: data.filters.from,
              to: data.filters.to,
              granularity: data.timelineGranularity,
              fallbackDays: data.timeline.length,
            })}
          />
        </div>

        <Card className="flex flex-col gap-3 p-4">
          <div>
            <h2 className="text-xs font-bold">Monthly run rate</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Implied by the plans held right now
            </p>
          </div>
          <p className="tabular text-2xl font-extrabold leading-none">
            {rupeesFromPaise(subscriptions.mrrPaise)}
          </p>
          {/* Said plainly on the card rather than in a tooltip: this is list
              price for the entitlements currently held, not money received. */}
          <p className="text-xs text-muted-foreground">
            List price of {subscriptions.paying} paid entitlement
            {subscriptions.paying === 1 ? '' : 's'}, normalised to 30 days. Not billed revenue — no
            discount, refund or failed renewal is reflected.
          </p>
          <div className="mt-auto grid grid-cols-2 gap-3 border-t border-border pt-3">
            <div>
              <p className="tabular text-lg font-extrabold">{subscriptions.expiringSoon}</p>
              <p className="text-xs text-muted-foreground">Ending within 7 days</p>
            </div>
            <div>
              <p className="tabular text-lg font-extrabold">{subscriptions.churned}</p>
              <p className="text-xs text-muted-foreground">Lapsed subscribers</p>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <ShareCard
          title="Training activity"
          subtitle={`From lastWorkout — the only presence signal the app records. Active = trained in ${windows.activeDays} days.`}
          rows={[
            {
              label: `Active (${windows.activeDays}d)`,
              value: activity.active,
              hint: `${activity.engaged} with 5+ workouts`,
            },
            {
              label: `Slipping (${windows.activeDays}–${windows.recentDays}d)`,
              value: Math.max(activity.recent - activity.active, 0),
            },
            { label: `Dormant (${windows.recentDays}d+)`, value: activity.dormant },
            {
              label: 'Never trained',
              value: activity.neverTrained,
              hint: `${activity.onboardedNeverTrained} finished onboarding first`,
            },
          ]}
          footer={
            <>
              {activity.totalWorkouts.toLocaleString('en-IN')} workouts logged in total ·{' '}
              {activity.avgWorkouts.toFixed(1)} per user
              {activity.stickiness != null && (
                <> · {Math.round(activity.stickiness * 100)}% of the monthly base trains weekly</>
              )}
            </>
          }
        />

        <ShareCard
          title="Subscription mix"
          subtitle="Where every account in the cohort stands right now"
          rows={[
            { label: 'Premium (paid)', value: subscriptions.premium },
            { label: 'Basic (paid)', value: subscriptions.basic },
            { label: 'Comped by an admin', value: subscriptions.comp },
            { label: 'Lapsed', value: subscriptions.churned },
            { label: 'Free', value: subscriptions.free },
          ]}
          footer={
            <>
              {subscriptions.pendingCheckout} stuck mid-checkout · {users.deletedTotal} accounts
              deleted all-time
            </>
          }
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* Trials get their own card rather than a share bar: the two cohorts
            are not comparable slices of one whole, and stacking them is exactly
            the mistake the split exists to prevent. */}
        <Card className="flex flex-col gap-3 p-4">
          <div>
            <h2 className="text-xs font-bold">Free trials</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Split into two cohorts. An older app build stamped a trial onto every account at
              signup — those never saw a paywall, and counting them together halves the apparent
              conversion rate.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div className="rounded-lg border border-border p-3">
              <p className="tabular text-xl font-extrabold leading-none">
                {trials.runningDeliberate}
              </p>
              <p className="mt-1.5 text-xs font-semibold">Running now</p>
              <p className="text-xs text-muted-foreground">Started deliberately</p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="tabular text-2xl font-extrabold leading-none">{trials.runningAuto}</p>
              <p className="mt-1.5 text-xs font-semibold">Running now</p>
              <p className="text-xs text-muted-foreground">Legacy auto-grant</p>
            </div>
          </div>

          <dl className="text-xs">
            <div className="flex items-center justify-between border-t border-border py-2">
              <dt className="text-muted-foreground">Deliberate trials, all time</dt>
              <dd className="tabular font-bold">{trials.deliberateTotal}</dd>
            </div>
            <div className="flex items-center justify-between border-t border-border py-2">
              <dt className="text-muted-foreground">Of those, went on to subscribe</dt>
              <dd className="tabular font-bold">{trials.deliberateConverted}</dd>
            </div>
            <div className="flex items-center justify-between border-t border-border py-2">
              <dt className="font-semibold">Trial → paid conversion</dt>
              <dd className="tabular font-extrabold">
                {trials.conversionPct == null
                  ? 'No trials yet'
                  : `${trials.conversionPct.toFixed(1)}%`}
              </dd>
            </div>
            <div className="flex items-center justify-between border-t border-border py-2">
              <dt className="text-muted-foreground">Auto-granted (excluded above)</dt>
              <dd className="tabular font-bold">{trials.autoTotal}</dd>
            </div>
          </dl>

          <Button asChild variant="outline" size="sm" className="mt-auto w-fit">
            <Link to="/conversion">
              Full conversion report <ArrowRight />
            </Link>
          </Button>
        </Card>

        <div className="flex flex-col gap-3">
          <ShareCard title="Platform" subtitle="Device ecosystem across the cohort" rows={platformRows} />

          <Card className="p-4">
            <h2 className="text-xs font-bold">Data quality</h2>
            <dl className="mt-3 text-xs">
              <div className="flex items-center justify-between border-t border-border py-2">
                <dt className="text-muted-foreground">
                  Internal &amp; QA accounts {data.filters.cohort === 'customers' ? 'excluded' : 'included'}
                </dt>
                <dd className="tabular font-bold">{excluded}</dd>
              </div>
              <div className="flex items-center justify-between border-t border-border py-2">
                <dt className="text-muted-foreground">
                  No <code className="font-mono">createdAt</code> — missing from every date window
                </dt>
                <dd className="tabular font-bold">{users.noCreatedAt}</dd>
              </div>
              <div className="flex items-center justify-between border-t border-border py-2">
                <dt className="text-muted-foreground">User documents scanned</dt>
                <dd className="tabular font-bold">{audience.documents}</dd>
              </div>
            </dl>
          </Card>
        </div>
      </div>
    </>
  );
}

export function DashboardHome() {
  // Ephemeral filter state, so it stays in the page per ARCHITECTURE.md. All
  // three are part of the query key: changing one refetches rather than
  // re-filtering a cached list, because the counts are computed server-side and
  // there is deliberately no second definition of them here.
  const [cohort, setCohort] = useState<Cohort>('customers');
  const [platform, setPlatform] = useState<PlatformFilter>('all');
  const [range, setRange] = useState<{ from: Date | null; to: Date | null }>({
    from: null,
    to: null,
  });
  const [syncing, setSyncing] = useState(false);

  const { data, isLoading, isError, error, isFetching, refetch } = useDashboardOverview({
    cohort,
    platform,
    from: range.from,
    to: range.to,
  });

  async function exportCsv() {
    try {
      toast('Preparing export…');
      const rows = await getUsersCsvData({
        platformFilter: csvPlatform(platform),
        startDate: range.from,
        endDate: range.to,
      });
      downloadCsv(`users_export_${Date.now()}.csv`, rows);
    } catch (e) {
      toast.error(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function syncSheets() {
    // Without the endpoint the post fails with a network error that says
    // nothing about the real cause, so name it.
    if (!SHEETS_SCRIPT_URL) {
      toast.error('Sheets sync is not configured — VITE_SHEETS_SCRIPT_URL is unset.');
      return;
    }
    setSyncing(true);
    toast('Syncing to Google Sheets…');
    try {
      const ok = await syncToGoogleSheets(SHEETS_SCRIPT_URL, {
        platformFilter: csvPlatform(platform),
        startDate: range.from,
        endDate: range.to,
      });
      if (ok) toast.success('Google Sheets synced.');
      else toast.error('Sync failed.');
    } finally {
      setSyncing(false);
    }
  }

  const hasRange = range.from != null || range.to != null;
  const excluded = (data?.audience.qa ?? 0) + (data?.audience.internal ?? 0);

  return (
    <PageShell>
      {/* Title, status, filters and the two exports on ONE bar. The subtitle is
          the flexible element: it truncates as the window narrows so the
          controls stay put, because a filter that has jumped to another line is
          harder to find than a sentence that has lost its tail. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="shrink-0 text-xl font-bold tracking-tight">Dashboard</h1>

        {/* Abbreviated because the controls own most of this bar. The full
            sentence is the title attribute, so nothing is lost — only folded. */}
        <p
          className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground"
          title={
            data?.generatedAt
              ? `Live scan of ${data.audience.documents} user documents, ${timeAgo(data.generatedAt)}.` +
                (data.filters.cohort === 'customers' && excluded > 0
                  ? ` ${excluded} internal and QA accounts excluded.`
                  : '')
              : undefined
          }
        >
          {isFetching ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="size-3 animate-spin" /> Scanning…
            </span>
          ) : data?.generatedAt ? (
            <>
              {data.audience.documents} docs · {timeAgo(data.generatedAt)}
            </>
          ) : (
            'Application analytics'
          )}
        </p>

        <SegmentedControl options={PLATFORMS} value={platform} onChange={setPlatform} />
        <SegmentedControl options={COHORTS} value={cohort} onChange={setCohort} />

        {/* The range filters every figure on the page, not just the export: it
            selects the accounts CREATED inside it, the same population the CSV
            produces for the same range. */}
        <div
          className="flex shrink-0 items-center gap-1 rounded-lg border border-border bg-card py-1 pl-2.5 pr-1.5"
          title="Filter by signup date — selects the accounts created in this range"
        >
          <CalendarRange className="size-3.5 shrink-0 text-muted-foreground" />
          <Input
            type="date"
            value={range.from ? toDateInput(range.from) : ''}
            onChange={(e) =>
              setRange((r) => ({ ...r, from: e.target.value ? new Date(e.target.value) : null }))
            }
            className="h-6 w-[98px] border-0 px-0.5 text-[11px] shadow-none focus-visible:ring-0"
          />
          <span className="text-xs text-muted-foreground">–</span>
          <Input
            type="date"
            value={range.to ? toDateInput(range.to) : ''}
            onChange={(e) =>
              setRange((r) => ({ ...r, to: e.target.value ? new Date(e.target.value) : null }))
            }
            className="h-6 w-[98px] border-0 px-0.5 text-[11px] shadow-none focus-visible:ring-0"
          />
          {hasRange ? (
            <Button
              variant="ghost"
              size="icon-sm"
              title="Clear date range"
              onClick={() => setRange({ from: null, to: null })}
            >
              <X className="size-3.5" />
            </Button>
          ) : (
            <span className="whitespace-nowrap px-1 text-xs text-muted-foreground">All time</span>
          )}
        </div>

        {/* No Refresh: every control on this bar is part of the query key, so
            changing any of them is already a live re-scan, and arriving on the
            page refetches on its own. */}
        <Button variant="outline" size="sm" onClick={() => void exportCsv()}>
          <Download /> CSV
        </Button>
        <Button variant="outline" size="sm" disabled={syncing} onClick={() => void syncSheets()}>
          <Upload className={cn(syncing && 'animate-pulse')} /> Sheets
        </Button>
      </div>

      {isLoading && <LoadingState label="Scanning users…" />}
      {isError && !data && <ErrorState error={error} onRetry={() => void refetch()} />}
      {data && <Overview data={data} />}
    </PageShell>
  );
}
