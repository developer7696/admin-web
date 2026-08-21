import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Download,
  RefreshCw,
  ShieldAlert,
  TrendingUp,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  DonutBreakdown,
  FunnelChart,
  RankedBars,
} from '@/components/common/conversion-charts';
import { PageBar, PageShell } from '@/components/common/page-header';
import { HeaderSlot } from '@/app/header-slot';
import { SearchInput } from '@/components/common/search-input';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { StatCard } from '@/components/common/stat-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrap,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useConversionReport, usePaymentEvidence } from '@/hooks/use-conversion';
import { downloadCsv } from '@/lib/csv';
import { planKeyLabel } from '@/lib/constants';
import { compactNumber, fmtDateShort, fmtDateTime, rupeesFromPaise } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  funnelFromUsers,
} from '@/services/conversion-analytics-service';
import type {
  AccountProvenance,
  ConversionSegment,
  ConversionUser,
  CountsByKey,
  TrialKind,
} from '@/types/conversion';

/// Conversion report — trial vs paid analysis of the whole `users` collection,
/// plus the raw user list (email, plan, segment) and Razorpay/Apple evidence.
///
/// The Command Center headline tiles count everyone; this page splits auto-granted
/// trials from real checkouts so the conversion rate is not inflated by the old
/// signup path. See `classifyTrial` in the service.

const SEGMENT_ORDER: ConversionSegment[] = [
  'active',
  'comp',
  'churned',
  'trial_no_convert',
  'legacy_trial_no_convert',
  'never_trialled',
];

const SEGMENT_LABEL: Record<ConversionSegment, string> = {
  active: 'Active paid',
  comp: 'Admin grant',
  churned: 'Churned',
  trial_no_convert: 'Trial, no convert',
  legacy_trial_no_convert: 'Legacy auto-trial',
  never_trialled: 'Never trialled',
};

const PROVENANCE_LABEL: Record<AccountProvenance, string> = {
  user: 'Customer',
  qa: 'QA',
  internal: 'Internal',
};

const TRIAL_LABEL: Record<Exclude<TrialKind, null>, string> = {
  deliberate: 'Deliberate',
  auto: 'Auto-grant',
};

type TabId = 'overview' | 'users' | 'payments' | 'quality';

function tallyOf(values: (string | null | undefined)[]): { name: string; value: number }[] {
  const out: CountsByKey = {};
  for (const v of values) {
    if (v == null || v === '') continue;
    out[v] = (out[v] ?? 0) + 1;
  }
  return Object.entries(out)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({ name, value }));
}

function FilterChip<T extends string>({
  options,
  selected,
  onSelect,
}: {
  options: { value: T; label: string }[];
  selected: T;
  onSelect: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onSelect(o.value)}
          className={cn(
            'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
            o.value === selected
              ? 'border-foreground bg-foreground text-background'
              : 'border-input bg-card text-muted-foreground hover:bg-secondary hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function segmentBadge(segment: ConversionSegment) {
  switch (segment) {
    case 'active':
      return 'success' as const;
    case 'comp':
      return 'default' as const;
    case 'churned':
      return 'destructive' as const;
    case 'trial_no_convert':
      return 'warning' as const;
    default:
      return 'secondary' as const;
  }
}

function usersToCsv(users: ConversionUser[]): unknown[][] {
  const header = [
    'email',
    'username',
    'uid',
    'phone',
    'city',
    'gender',
    'age',
    'platform',
    'segment',
    'provenance',
    'trialKind',
    'tier',
    'plan',
    'status',
    'provider',
    'entitled',
    'everActivated',
    'createdAt',
    'trialStartDate',
    'activatedAt',
    'endDate',
    'totalWorkouts',
    'fitnessGoal',
    'experienceLevel',
  ];
  const iso = (d: Date | null) => (d ? d.toISOString() : '');
  const rows = users.map((u) => [
    u.email ?? '',
    u.username ?? '',
    u.uid,
    u.phone ?? '',
    u.city ?? '',
    u.gender ?? '',
    u.age ?? '',
    u.platform ?? '',
    u.segment,
    u.provenance,
    u.trialKind ?? '',
    u.tier ?? '',
    u.plan ?? '',
    u.status ?? '',
    u.provider ?? '',
    u.entitled,
    u.everActivated,
    iso(u.createdAt),
    iso(u.trialStartDate),
    iso(u.activatedAt),
    iso(u.endDate),
    u.totalWorkouts,
    u.fitnessGoal ?? '',
    u.experienceLevel ?? '',
  ]);
  return [header, ...rows];
}

export function ConversionPage() {
  const navigate = useNavigate();
  const reportQ = useConversionReport();
  const [tab, setTab] = useState<TabId>('overview');
  const [customersOnly, setCustomersOnly] = useState(true);
  const [query, setQuery] = useState('');
  const [segmentFilter, setSegmentFilter] = useState<'all' | ConversionSegment>('all');
  const [platformFilter, setPlatformFilter] = useState('all');
  const [trialFilter, setTrialFilter] = useState<'all' | 'deliberate' | 'auto' | 'none'>('all');
  const [provenanceFilter, setProvenanceFilter] = useState<'all' | AccountProvenance>('user');

  const paymentsQ = usePaymentEvidence(tab === 'payments');

  const report = reportQ.data;

  const cohort = useMemo(() => {
    if (!report) return [];
    return customersOnly ? report.users.filter((u) => u.provenance === 'user') : report.users;
  }, [report, customersOnly]);

  const listed = useMemo(() => {
    if (!report) return [];
    const q = query.trim().toLowerCase();
    return report.users
      .filter((u) => {
        if (segmentFilter !== 'all' && u.segment !== segmentFilter) return false;
        if (platformFilter !== 'all' && (u.platform ?? '—') !== platformFilter) return false;
        if (trialFilter === 'none' && u.trialKind != null) return false;
        if (trialFilter === 'deliberate' && u.trialKind !== 'deliberate') return false;
        if (trialFilter === 'auto' && u.trialKind !== 'auto') return false;
        if (provenanceFilter !== 'all' && u.provenance !== provenanceFilter) return false;
        if (!q) return true;
        return [u.email, u.username, u.uid, u.phone, u.city, u.plan, u.provider]
          .join(' ')
          .toLowerCase()
          .includes(q);
      })
      .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
  }, [report, query, segmentFilter, platformFilter, trialFilter, provenanceFilter]);

  // Headline counters, segment mix, platform split and the monthly timeline all
  // moved to the Dashboard, so nothing here derives them any more — a leftover
  // second definition is exactly what let the two screens drift apart.
  const funnel = useMemo(() => funnelFromUsers(cohort), [cohort]);
  const cities = useMemo(() => tallyOf(cohort.map((u) => u.city)).slice(0, 12), [cohort]);
  const goals = useMemo(() => tallyOf(cohort.map((u) => u.fitnessGoal)), [cohort]);
  const genders = useMemo(() => tallyOf(cohort.map((u) => u.gender)), [cohort]);
  const plans = useMemo(
    () => tallyOf(cohort.map((u) => (u.plan ? planKeyLabel(u.plan) : null))),
    [cohort],
  );

  const platformOptions = useMemo(() => {
    if (!report) return [{ value: 'all', label: 'All platforms' }];
    const keys = [
      ...new Set(report.users.map((u) => u.platform).filter((p): p is string => p != null)),
    ].sort();
    return [{ value: 'all', label: 'All platforms' }, ...keys.map((k) => ({ value: k, label: k }))];
  }, [report]);

  function exportCsv() {
    if (listed.length === 0) {
      toast.error('Nothing to export for the current filters.');
      return;
    }
    downloadCsv(`conversion_users_${Date.now()}.csv`, usersToCsv(listed));
    toast.success(`Exported ${listed.length} users.`);
  }

  function displayName(u: ConversionUser): string {
    return u.username || (u.email ? u.email.split('@')[0] : u.uid.slice(0, 8));
  }

  function openBilling(u: ConversionUser) {
    navigate(`/users/${u.uid}/billing`, {
      state: { username: displayName(u), email: u.email ?? 'No email' },
    });
  }

  return (
    <PageShell>
      <PageBar
        title="Conversion"
        status={
          report
            ? `${compactNumber(report.totals.users)} accounts · ${fmtDateTime(report.generatedAt)}`
            : 'Trial, signup and paid-access analysis'
        }
        statusTitle={
          report
            ? `Snapshot from ${fmtDateTime(report.generatedAt)}, covering ${compactNumber(report.totals.users)} accounts in Firestore.`
            : undefined
        }
      >
        <div className="flex shrink-0 items-center gap-2 pr-1">
          <Switch
            id="customers-only"
            checked={customersOnly}
            onCheckedChange={(on) => {
              setCustomersOnly(on);
              setProvenanceFilter(on ? 'user' : 'all');
            }}
          />
          <Label htmlFor="customers-only" className="text-xs font-medium">
            Customers only
          </Label>
        </div>
        {/* Refresh stays here, unlike on the Dashboard: this page has no filter
            that re-queries the server, so without a button there is no way to
            re-run the scan short of leaving and coming back. */}
        <Button variant="outline" size="sm" onClick={() => void reportQ.refetch()} disabled={reportQ.isFetching}>
          <RefreshCw className={cn(reportQ.isFetching && 'animate-spin')} />
          Refresh
        </Button>
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={!report}>
          <Download /> CSV
        </Button>
      </PageBar>

      {/* Only the Users tab is searchable, so the navbar slot follows the tab
          rather than standing there filtering nothing on Overview. */}
      {report && tab === 'users' && (
        <HeaderSlot>
          <SearchInput
            value={query}
            onChange={setQuery}
            variant="header"
            placeholder="Search email, username, uid, phone, city…"
            className="w-full max-w-md"
          />
        </HeaderSlot>
      )}

      {reportQ.isLoading && <LoadingState label="Scanning every user document…" />}
      {reportQ.isError && (
        <ErrorState error={reportQ.error} onRetry={() => void reportQ.refetch()} />
      )}

      {report && (
        <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)}>
          <TabsList>
            <TabsTrigger value="overview">
              <TrendingUp className="size-3.5" /> Overview
            </TabsTrigger>
            <TabsTrigger value="users">
              <Users className="size-3.5" /> Users
            </TabsTrigger>
            <TabsTrigger value="payments">Payments</TabsTrigger>
            <TabsTrigger value="quality">
              Data quality
              {report.integrity.length > 0 && (
                <span className="tabular rounded-full bg-amber-500/15 px-1.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">
                  {report.integrity.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-5">
            {/* The headline counters, subscription mix, platform split and
                signup timeline that used to sit here live on the Dashboard.
                They were the same numbers a click away, and two screens quoting
                the same figure is how they end up quoting different ones. What
                stays is what only this page has: the product funnel, and who
                these accounts actually are. */}
            <FunnelChart
              title="Product funnel"
              caption="Each stage is a subset of the one above it, for the current cohort."
              data={funnel}
            />

            <p className="text-xs text-muted-foreground">
              Auto-granted trials from the old signup path are not counted as conversion. A
              deliberate trial is either <code className="text-[11px]">hasUsedTrial</code> or a
              trial timestamp more than two minutes after account creation.
            </p>

            <div className="grid gap-4 lg:grid-cols-3">
              <RankedBars title="Cities" caption="Top 12 from cityTown" rows={cities} />
              <RankedBars title="Fitness goals" rows={goals} />
              <div className="space-y-4">
                <DonutBreakdown title="Gender" rows={genders} />
                <RankedBars title="Plans" rows={plans} />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="users" className="space-y-4">
            <div className="space-y-2">
              <FilterChip
                selected={segmentFilter}
                onSelect={setSegmentFilter}
                options={[
                  { value: 'all', label: 'All segments' },
                  ...SEGMENT_ORDER.map((s) => ({ value: s, label: SEGMENT_LABEL[s] })),
                ]}
              />
              <FilterChip
                selected={platformFilter}
                onSelect={setPlatformFilter}
                options={platformOptions}
              />
              <FilterChip
                selected={trialFilter}
                onSelect={setTrialFilter}
                options={[
                  { value: 'all', label: 'Any trial' },
                  { value: 'deliberate', label: 'Deliberate' },
                  { value: 'auto', label: 'Auto-grant' },
                  { value: 'none', label: 'No trial' },
                ]}
              />
              <FilterChip
                selected={provenanceFilter}
                onSelect={setProvenanceFilter}
                options={[
                  { value: 'all', label: 'All accounts' },
                  { value: 'user', label: 'Customers' },
                  { value: 'qa', label: 'QA' },
                  { value: 'internal', label: 'Internal' },
                ]}
              />
            </div>

            <p className="text-xs text-muted-foreground">
              {compactNumber(listed.length)} of {compactNumber(report.users.length)} accounts
              matching the filters. Click a row for billing.
            </p>

            {listed.length === 0 ? (
              <EmptyState title="No matching users." hint="Widen the filters or clear search." />
            ) : (
              <TableWrap>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead>Segment</TableHead>
                      <TableHead>Trial</TableHead>
                      <TableHead>Plan</TableHead>
                      <TableHead>Platform</TableHead>
                      <TableHead>City</TableHead>
                      <TableHead>Signed up</TableHead>
                      <TableHead className="text-right">Workouts</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {listed.map((u) => (
                      <TableRow
                        key={u.uid}
                        className="cursor-pointer"
                        tabIndex={0}
                        onClick={() => openBilling(u)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            openBilling(u);
                          }
                        }}
                      >
                        <TableCell>
                          <div className="min-w-[180px]">
                            <p className="font-semibold">{displayName(u)}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {u.email ?? 'No email'}
                            </p>
                            {u.phone && (
                              <p className="text-[11px] text-muted-foreground">{u.phone}</p>
                            )}
                          </div>
                        </TableCell>
                          <TableCell>
                            <Badge variant={segmentBadge(u.segment)}>{SEGMENT_LABEL[u.segment]}</Badge>
                            {u.provenance !== 'user' && (
                              <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                {PROVENANCE_LABEL[u.provenance]}
                              </p>
                            )}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs">
                            {u.trialKind == null ? '—' : TRIAL_LABEL[u.trialKind]}
                          </TableCell>
                          <TableCell className="text-xs">
                            <p>{u.plan ? planKeyLabel(u.plan) : '—'}</p>
                            <p className="text-muted-foreground">
                              {u.provider ?? 'no provider'}
                              {u.entitled ? ' · live' : ''}
                            </p>
                          </TableCell>
                          <TableCell className="text-xs">{u.platform ?? '—'}</TableCell>
                          <TableCell className="text-xs">{u.city ?? '—'}</TableCell>
                          <TableCell className="whitespace-nowrap text-xs">
                            {u.createdAt ? fmtDateShort(u.createdAt) : '—'}
                          </TableCell>
                          <TableCell className="tabular text-right text-xs">{u.totalWorkouts}</TableCell>
                        </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableWrap>
            )}
          </TabsContent>

          <TabsContent value="payments" className="space-y-5">
            {paymentsQ.isLoading && <LoadingState label="Reading Razorpay and Apple webhook stores…" />}
            {paymentsQ.isError && (
              <ErrorState error={paymentsQ.error} onRetry={() => void paymentsQ.refetch()} />
            )}
            {paymentsQ.data && (
              <>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <StatCard
                    label="Razorpay subscriptions"
                    value={compactNumber(paymentsQ.data.razorpay.subscriptions)}
                    hint={`${compactNumber(paymentsQ.data.razorpay.events)} webhook events`}
                  />
                  <StatCard
                    label="Captured payments"
                    value={compactNumber(paymentsQ.data.razorpay.capturedPayments)}
                    hint={rupeesFromPaise(paymentsQ.data.razorpay.grossPaise)}
                    tone="success"
                  />
                  <StatCard
                    label="Refunds"
                    value={compactNumber(paymentsQ.data.razorpay.refunds)}
                    hint={rupeesFromPaise(paymentsQ.data.razorpay.refundPaise)}
                    tone="warning"
                  />
                  <StatCard
                    label="Apple events"
                    value={compactNumber(paymentsQ.data.apple.events)}
                    hint="StoreKit server notifications"
                  />
                </div>

                <FunnelChart
                  title="Razorpay subscription funnel"
                  caption="Deduped to subscription ids, not webhook volume. The last stage drops our own test accounts."
                  data={paymentsQ.data.razorpay.funnel}
                />

                {Object.keys(paymentsQ.data.apple.types).length > 0 && (
                  <RankedBars
                    title="Apple notification types"
                    rows={Object.entries(paymentsQ.data.apple.types)
                      .sort((a, b) => b[1] - a[1])
                      .map(([name, value]) => ({ name, value }))}
                    unit="events"
                  />
                )}

                <Card className="p-4">
                  <h3 className="text-sm font-semibold">Emails on captured Razorpay payments</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Distinct addresses Razorpay recorded on a captured charge — independent of the
                    user documents.
                  </p>
                  {paymentsQ.data.razorpay.payerEmails.length === 0 ? (
                    <p className="mt-3 text-sm text-muted-foreground">No captured-payment emails.</p>
                  ) : (
                    <ul className="mt-3 columns-1 gap-x-8 text-sm sm:columns-2 lg:columns-3">
                      {paymentsQ.data.razorpay.payerEmails.map((email) => (
                        <li key={email} className="truncate py-0.5">
                          {email}
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </>
            )}
          </TabsContent>

          <TabsContent value="quality" className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Problems on the live collection that would distort the numbers above. Counts
              re-derive on every refresh, so a fixed issue disappears.
            </p>
            {report.integrity.length === 0 ? (
              <EmptyState title="No integrity findings." hint="Every check on this snapshot passed." />
            ) : (
              report.integrity.map((finding) => (
                <Card key={finding.id} className="flex items-start gap-3 p-4">
                  {finding.severity === 'critical' ? (
                    <ShieldAlert className="mt-0.5 size-4 shrink-0 text-red-600 dark:text-red-400" />
                  ) : (
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold">{finding.title}</p>
                      <Badge variant={finding.severity === 'critical' ? 'destructive' : 'warning'}>
                        {finding.count}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{finding.detail}</p>
                  </div>
                </Card>
              ))
            )}
          </TabsContent>
        </Tabs>
      )}
    </PageShell>
  );
}
