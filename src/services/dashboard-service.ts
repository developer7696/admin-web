import { adminApi, ApiException, type Json } from '@/lib/api-client';
import { toDate } from '@/lib/format';
import type { CountsByKey } from '@/types/conversion';
import type {
  ActivityCounts,
  AppliedFilters,
  AudienceCounts,
  DashboardAlert,
  DashboardOverview,
  DashboardQuery,
  DayPoint,
  SubscriptionCounts,
  TrialCounts,
  UserCounts,
} from '@/types/dashboard';

/// The dashboard overview via the backend. The API re-reads Firestore on every
/// call (`Cache-Control: no-store`), so Refresh is a live scan rather than a
/// cache of whatever this browser last downloaded.
///
/// Every count is computed server-side, next to the entitlement and trial rules
/// it depends on. This file only hydrates the JSON — it must not re-derive a
/// number, because a second definition of "active" is how two screens end up
/// disagreeing.

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/** Nullable ratio: the server sends `null` for "no base to divide by", and 0 would be a lie. */
const numOrNull = (value: unknown): number | null => {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const record = (value: unknown): Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const counts = (value: unknown): CountsByKey => {
  const out: CountsByKey = {};
  for (const [k, v] of Object.entries(record(value))) {
    const n = Number(v);
    if (Number.isFinite(n)) out[k] = n;
  }
  return out;
};

const asStr = (value: unknown, fallback = ''): string =>
  typeof value === 'string' && value.trim() !== '' ? value : fallback;

function parseAudience(raw: unknown): AudienceCounts {
  const a = record(raw);
  return {
    documents: num(a.documents),
    customers: num(a.customers),
    qa: num(a.qa),
    internal: num(a.internal),
    inCohort: num(a.inCohort),
  };
}

function parseUsers(raw: unknown): UserCounts {
  const u = record(raw);
  return {
    total: num(u.total),
    newToday: num(u.newToday),
    newYesterday: num(u.newYesterday),
    new7d: num(u.new7d),
    new30d: num(u.new30d),
    periodSignups: num(u.periodSignups),
    previousPeriodSignups: num(u.previousPeriodSignups),
    growthPct: numOrNull(u.growthPct),
    noCreatedAt: num(u.noCreatedAt),
    undatedExcluded: num(u.undatedExcluded),
    deletedTotal: num(u.deletedTotal),
  };
}

function parseActivity(raw: unknown): ActivityCounts {
  const a = record(raw);
  return {
    active: num(a.active),
    recent: num(a.recent),
    dormant: num(a.dormant),
    neverTrained: num(a.neverTrained),
    onboardedNeverTrained: num(a.onboardedNeverTrained),
    engaged: num(a.engaged),
    totalWorkouts: num(a.totalWorkouts),
    avgWorkouts: num(a.avgWorkouts),
    stickiness: numOrNull(a.stickiness),
  };
}

function parseSubscriptions(raw: unknown): SubscriptionCounts {
  const s = record(raw);
  return {
    entitled: num(s.entitled),
    paying: num(s.paying),
    comp: num(s.comp),
    premium: num(s.premium),
    basic: num(s.basic),
    churned: num(s.churned),
    free: num(s.free),
    expiringSoon: num(s.expiringSoon),
    pendingCheckout: num(s.pendingCheckout),
    mrrPaise: num(s.mrrPaise),
    byProvider: counts(s.byProvider),
    byPlan: counts(s.byPlan),
  };
}

function parseTrials(raw: unknown): TrialCounts {
  const t = record(raw);
  return {
    running: num(t.running),
    runningDeliberate: num(t.runningDeliberate),
    runningAuto: num(t.runningAuto),
    endingSoon: num(t.endingSoon),
    deliberateTotal: num(t.deliberateTotal),
    autoTotal: num(t.autoTotal),
    deliberateConverted: num(t.deliberateConverted),
    conversionPct: numOrNull(t.conversionPct),
    lapsed: num(t.lapsed),
  };
}

function parseTimeline(raw: unknown): DayPoint[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    const d = record(entry);
    return {
      date: asStr(d.date),
      label: asStr(d.label),
      signups: num(d.signups),
      activations: num(d.activations),
    };
  });
}

function parseAlerts(raw: unknown): DashboardAlert[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    const a = record(entry);
    const severity = a.severity;
    return {
      id: asStr(a.id),
      title: asStr(a.title),
      detail: asStr(a.detail),
      count: num(a.count),
      severity:
        severity === 'critical' || severity === 'warning' || severity === 'info'
          ? severity
          : 'info',
      href: typeof a.href === 'string' && a.href !== '' ? a.href : null,
    };
  });
}

/// The windows are the server's own thresholds and are NOT defaulted here.
///
/// A local fallback would be a second copy of a backend constant: change
/// `ACTIVE_DAYS` there and this screen would go on labelling a 14-day figure
/// "Active (7d)" — a wrong label on a right number, which is worse than no
/// number at all. A response that cannot say which window it used is malformed,
/// and is surfaced as such.
function parseWindows(raw: unknown): DashboardOverview['windows'] {
  const w = record(raw);
  const positive = (value: unknown): number => {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) {
      throw new ApiException(
        0,
        'parse',
        'The dashboard response did not say which time windows it used.',
      );
    }
    return n;
  };
  return {
    trialDays: positive(w.trialDays),
    activeDays: positive(w.activeDays),
    recentDays: positive(w.recentDays),
  };
}

function parseFilters(raw: unknown): AppliedFilters {
  const f = record(raw);
  const platform = f.platform;
  return {
    cohort: f.cohort === 'all' ? 'all' : 'customers',
    platform: platform === 'ios' || platform === 'android' ? platform : 'all',
    from: toDate(f.from),
    to: toDate(f.to),
  };
}

function parseOverview(json: Json): DashboardOverview {
  return {
    generatedAt: toDate(json.generatedAt),
    filters: parseFilters(json.filters),
    windows: parseWindows(json.windows),
    timelineGranularity: json.timelineGranularity === 'month' ? 'month' : 'day',
    audience: parseAudience(json.audience),
    users: parseUsers(json.users),
    activity: parseActivity(json.activity),
    subscriptions: parseSubscriptions(json.subscriptions),
    trials: parseTrials(json.trials),
    platform: counts(json.platform),
    timeline: parseTimeline(json.timeline),
    alerts: parseAlerts(json.alerts),
  };
}

/// Repository boundary: the page never sees a raw fetch error, only an
/// `ApiException` the shared error state already knows how to render.
export async function getDashboardOverview(query: DashboardQuery): Promise<DashboardOverview> {
  try {
    return parseOverview(await adminApi.dashboardOverview(query));
  } catch (e) {
    if (e instanceof ApiException) throw e;
    throw new ApiException(0, 'parse', 'The dashboard response could not be read.');
  }
}
