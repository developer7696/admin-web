/// Types for the application-analytics overview shown on the admin home screen.
///
/// Plain TypeScript with no Firebase imports, per ARCHITECTURE.md, so the same
/// shapes cross the service, hook and page layers.

import type { CountsByKey } from '@/types/conversion';

/// Which accounts the numbers were computed over. `customers` drops our own
/// internal and QA accounts — every rate on the screen is a ratio, and a
/// denominator padded with test accounts makes conversion read low and activity
/// read high.
export type Cohort = 'customers' | 'all';

/// Device ecosystem to narrow to. Accounts with no recorded platform belong to
/// neither side, so an iOS view plus an Android view falls short of the total.
export type PlatformFilter = 'all' | 'ios' | 'android';

/// A date range selects a SIGNUP COHORT — the accounts created inside it — and
/// every number then describes those accounts. Same population the CSV export
/// produces for the same range, so filtering then exporting stays consistent.
export interface DashboardQuery {
  cohort: Cohort;
  platform: PlatformFilter;
  from: Date | null;
  to: Date | null;
}

/// What the server actually computed under, echoed back so the UI never guesses.
export interface AppliedFilters {
  cohort: Cohort;
  platform: PlatformFilter;
  from: Date | null;
  to: Date | null;
}

export interface AudienceCounts {
  /** Every non-empty user document, whatever its provenance. */
  documents: number;
  customers: number;
  qa: number;
  internal: number;
  /** How many documents the numbers were actually computed over. */
  inCohort: number;
}

export interface UserCounts {
  total: number;
  newToday: number;
  newYesterday: number;
  new7d: number;
  new30d: number;
  /**
   * Signups in the active period, and in the equal-length period before it.
   * With no date range the period is the last 30 days; with one, it is the range
   * itself — so the comparison stays like-for-like at any length.
   */
  periodSignups: number;
  previousPeriodSignups: number;
  /** Change between those two. Null when the earlier period is empty. */
  growthPct: number | null;
  /** Accounts with no `createdAt`, and so missing from every window above. */
  noCreatedAt: number;
  /** Accounts the date filter dropped for having no `createdAt` to place. */
  undatedExcluded: number;
  deletedTotal: number;
}

/// Training activity. Firestore holds no login or session timestamp, so these
/// are derived from `lastWorkout` — "active" means trained recently, NOT opened
/// the app recently. Do not relabel this as DAU.
export interface ActivityCounts {
  active: number;
  recent: number;
  dormant: number;
  neverTrained: number;
  onboardedNeverTrained: number;
  engaged: number;
  totalWorkouts: number;
  avgWorkouts: number;
  /** `active / recent` — how much of the monthly base shows up in a week. */
  stickiness: number | null;
}

export interface SubscriptionCounts {
  entitled: number;
  paying: number;
  comp: number;
  premium: number;
  basic: number;
  churned: number;
  free: number;
  expiringSoon: number;
  pendingCheckout: number;
  /**
   * Monthly run rate implied by the plans held now, at list price, in paise.
   * Derived from the plan catalog rather than from Razorpay invoices — no
   * discount, refund or failed renewal is reflected. A scale indicator, not
   * revenue.
   */
  mrrPaise: number;
  byProvider: CountsByKey;
  byPlan: CountsByKey;
}

/// Trials, always as two cohorts. An older app build stamped `trialStartDate`
/// onto every account at signup; those auto-grants are not people who chose a
/// trial, and mixing them in halves the apparent conversion rate.
export interface TrialCounts {
  running: number;
  runningDeliberate: number;
  runningAuto: number;
  endingSoon: number;
  deliberateTotal: number;
  autoTotal: number;
  deliberateConverted: number;
  conversionPct: number | null;
  lapsed: number;
}

export interface DayPoint {
  /** `YYYY-MM-DD`. */
  date: string;
  label: string;
  signups: number;
  activations: number;
}

/// Something an operator should go and do, with the panel route that does it.
export interface DashboardAlert {
  id: string;
  title: string;
  detail: string;
  count: number;
  severity: 'info' | 'warning' | 'critical';
  href: string | null;
}

export interface DashboardOverview {
  generatedAt: Date | null;
  filters: AppliedFilters;
  /** The windows the server used, so the UI labels them instead of guessing. */
  windows: { trialDays: number; activeDays: number; recentDays: number };
  /** Whether `timeline` buckets by day or by month — long ranges roll up. */
  timelineGranularity: 'day' | 'month';
  audience: AudienceCounts;
  users: UserCounts;
  activity: ActivityCounts;
  subscriptions: SubscriptionCounts;
  trials: TrialCounts;
  platform: CountsByKey;
  timeline: DayPoint[];
  alerts: DashboardAlert[];
}
