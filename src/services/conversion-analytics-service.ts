import { adminApi, ApiException, type Json } from '@/lib/api-client';
import { toDate } from '@/lib/format';
import type {
  AccountProvenance,
  ConversionReport,
  ConversionSegment,
  ConversionUser,
  CountsByKey,
  FunnelStage,
  IntegrityFinding,
  MonthlyPoint,
  PaymentEvidence,
  TrialKind,
} from '@/types/conversion';

/// Conversion report via the backend. The API re-reads Firestore on every
/// call (`Cache-Control: no-store`), so Refresh is a live scan rather than a
/// client-side cache of whatever this browser last downloaded.
///
/// Classification (auto-grant vs deliberate trial, segments, integrity) lives
/// on the server next to `isEntitlementCurrent`. This file only hydrates the
/// JSON into the Date-typed models the page already uses, and re-aggregates
/// monthly/funnel charts when the admin narrows the on-screen cohort.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const monthLabel = (key: string) => {
  const [y, m] = key.split('-');
  return `${MONTHS[Number(m) - 1]} ${y.slice(2)}`;
};

const SEGMENTS: ConversionSegment[] = [
  'active',
  'comp',
  'churned',
  'trial_no_convert',
  'legacy_trial_no_convert',
  'never_trialled',
];

function asSegment(value: unknown): ConversionSegment {
  return SEGMENTS.includes(value as ConversionSegment) ? (value as ConversionSegment) : 'never_trialled';
}

function asTrialKind(value: unknown): TrialKind {
  if (value === 'deliberate' || value === 'auto') return value;
  return null;
}

function asProvenance(value: unknown): AccountProvenance {
  if (value === 'qa' || value === 'internal' || value === 'user') return value;
  return 'user';
}

function asStr(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function asBool(value: unknown): boolean {
  return value === true;
}

function asCounts(value: unknown): CountsByKey {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: CountsByKey = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const n = Number(v);
    if (Number.isFinite(n)) out[k] = n;
  }
  return out;
}

function parseUser(raw: Record<string, unknown>): ConversionUser {
  return {
    uid: String(raw.uid ?? ''),
    email: asStr(raw.email),
    username: asStr(raw.username),
    phone: asStr(raw.phone),
    city: asStr(raw.city),
    gender: asStr(raw.gender),
    age: typeof raw.age === 'number' ? raw.age : null,
    platform: asStr(raw.platform),
    role: asStr(raw.role),
    createdAt: toDate(raw.createdAt),
    trialStartDate: toDate(raw.trialStartDate),
    hasUsedTrial: typeof raw.hasUsedTrial === 'boolean' ? raw.hasUsedTrial : null,
    trialKind: asTrialKind(raw.trialKind),
    trialGapDays: typeof raw.trialGapDays === 'number' ? raw.trialGapDays : null,
    tier: asStr(raw.tier),
    plan: asStr(raw.plan),
    status: asStr(raw.status),
    provider: asStr(raw.provider),
    activatedAt: toDate(raw.activatedAt),
    endDate: toDate(raw.endDate),
    entitled: asBool(raw.entitled),
    everActivated: asBool(raw.everActivated),
    pendingCheckout: asBool(raw.pendingCheckout),
    upcomingPlan: asStr(raw.upcomingPlan),
    totalWorkouts: Number.isFinite(Number(raw.totalWorkouts)) ? Number(raw.totalWorkouts) : 0,
    lastWorkout: toDate(raw.lastWorkout),
    assessmentCompleted: asBool(raw.assessmentCompleted),
    fitnessGoal: asStr(raw.fitnessGoal),
    experienceLevel: asStr(raw.experienceLevel),
    segment: asSegment(raw.segment),
    provenance: asProvenance(raw.provenance),
  };
}

function parseFunnel(value: unknown): FunnelStage[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => {
      if (row == null || typeof row !== 'object') return null;
      const r = row as Record<string, unknown>;
      if (typeof r.label !== 'string' || typeof r.value !== 'number') return null;
      const stage: FunnelStage = { label: r.label, value: r.value };
      if (typeof r.note === 'string') stage.note = r.note;
      return stage;
    })
    .filter((s): s is FunnelStage => s != null);
}

function parseFinding(raw: Record<string, unknown>): IntegrityFinding {
  return {
    id: String(raw.id ?? ''),
    title: String(raw.title ?? ''),
    detail: String(raw.detail ?? ''),
    count: Number(raw.count ?? 0),
    severity: raw.severity === 'critical' ? 'critical' : 'warning',
  };
}

function parseReport(json: Json): ConversionReport {
  const usersRaw = Array.isArray(json.users) ? json.users : [];
  const citiesRaw = Array.isArray(json.cities) ? json.cities : [];
  const integrityRaw = Array.isArray(json.integrity) ? json.integrity : [];
  const monthlyRaw = Array.isArray(json.monthly) ? json.monthly : [];

  const totalsSrc = (json.totals ?? {}) as Record<string, unknown>;
  const n = (key: string) => Number(totalsSrc[key] ?? 0);

  return {
    generatedAt: toDate(json.generatedAt) ?? new Date(),
    users: usersRaw
      .filter((u): u is Record<string, unknown> => u != null && typeof u === 'object')
      .map(parseUser),
    totals: {
      users: n('users'),
      entitled: n('entitled'),
      everActivated: n('everActivated'),
      autoTrial: n('autoTrial'),
      deliberateTrial: n('deliberateTrial'),
      anyTrial: n('anyTrial'),
      neverTrialled: n('neverTrialled'),
      expired: n('expired'),
      pendingCheckout: n('pendingCheckout'),
      assessmentCompleted: n('assessmentCompleted'),
      zeroWorkouts: n('zeroWorkouts'),
      hasWorkouts: n('hasWorkouts'),
      noEmail: n('noEmail'),
      noCreatedAt: n('noCreatedAt'),
      appleLinked: n('appleLinked'),
      razorpayLinked: n('razorpayLinked'),
      deleted: n('deleted'),
    },
    segments: asCounts(json.segments),
    provenance: asCounts(json.provenance),
    platform: asCounts(json.platform),
    tier: asCounts(json.tier),
    plan: asCounts(json.plan),
    status: asCounts(json.status),
    provider: asCounts(json.provider),
    cities: citiesRaw
      .map((row) => {
        if (!Array.isArray(row) || row.length < 2) return null;
        const name = String(row[0]);
        const count = Number(row[1]);
        return Number.isFinite(count) ? ([name, count] as [string, number]) : null;
      })
      .filter((r): r is [string, number] => r != null),
    goals: asCounts(json.goals),
    experience: asCounts(json.experience),
    gender: asCounts(json.gender),
    deletionReasons: asCounts(json.deletionReasons),
    monthly: monthlyRaw
      .filter((p): p is Record<string, unknown> => p != null && typeof p === 'object')
      .map((p) => ({
        month: String(p.month ?? ''),
        label: String(p.label ?? ''),
        signups: Number(p.signups ?? 0),
        trials: Number(p.trials ?? 0),
        activations: Number(p.activations ?? 0),
      })),
    userFunnel: parseFunnel(json.userFunnel),
    integrity: integrityRaw
      .filter((f): f is Record<string, unknown> => f != null && typeof f === 'object')
      .map(parseFinding),
  };
}

export async function getConversionReport(): Promise<ConversionReport> {
  try {
    return parseReport(await adminApi.conversionReport());
  } catch (e) {
    if (e instanceof ApiException) throw e;
    throw new ApiException(
      0,
      'unexpected',
      `Could not build the conversion report: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

export async function getPaymentEvidence(): Promise<PaymentEvidence> {
  try {
    const json = await adminApi.conversionPayments();
    const rz = (json.razorpay ?? {}) as Record<string, unknown>;
    const apple = (json.apple ?? {}) as Record<string, unknown>;
    const emails = Array.isArray(rz.payerEmails)
      ? rz.payerEmails.filter((e): e is string => typeof e === 'string')
      : [];
    return {
      razorpay: {
        events: Number(rz.events ?? 0),
        subscriptions: Number(rz.subscriptions ?? 0),
        authenticated: Number(rz.authenticated ?? 0),
        activated: Number(rz.activated ?? 0),
        charged: Number(rz.charged ?? 0),
        cancelled: Number(rz.cancelled ?? 0),
        capturedPayments: Number(rz.capturedPayments ?? 0),
        grossPaise: Number(rz.grossPaise ?? 0),
        refunds: Number(rz.refunds ?? 0),
        refundPaise: Number(rz.refundPaise ?? 0),
        payerEmails: emails,
        funnel: parseFunnel(rz.funnel),
      },
      apple: { events: Number(apple.events ?? 0), types: asCounts(apple.types) },
    };
  } catch (e) {
    if (e instanceof ApiException) throw e;
    throw new ApiException(
      0,
      'unexpected',
      `Could not load payment evidence: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

/// Monthly timeline for whatever cohort the page is currently showing.
export function monthlyFromUsers(users: ConversionUser[]): MonthlyPoint[] {
  const monthMap = new Map<string, MonthlyPoint>();
  const bump = (d: Date | null, field: 'signups' | 'trials' | 'activations') => {
    if (d == null) return;
    const key = monthKey(d);
    const point = monthMap.get(key) ?? {
      month: key,
      label: monthLabel(key),
      signups: 0,
      trials: 0,
      activations: 0,
    };
    point[field] += 1;
    monthMap.set(key, point);
  };
  for (const u of users) {
    bump(u.createdAt, 'signups');
    bump(u.trialStartDate, 'trials');
    bump(u.activatedAt, 'activations');
  }
  return [...monthMap.values()].sort((a, b) => a.month.localeCompare(b.month));
}

/// Signup → access funnel for whatever cohort the page is currently showing.
export function funnelFromUsers(users: ConversionUser[]): FunnelStage[] {
  const assessmentCompleted = users.filter((u) => u.assessmentCompleted).length;
  const hasWorkouts = users.filter((u) => u.totalWorkouts > 0).length;
  const everActivated = users.filter((u) => u.everActivated).length;
  const entitled = users.filter((u) => u.entitled).length;
  return [
    { label: 'Signed up', value: users.length, note: 'never finished onboarding' },
    { label: 'Finished onboarding', value: assessmentCompleted, note: 'onboarded but never trained' },
    { label: 'Did a workout', value: hasWorkouts, note: 'trained but never subscribed' },
    { label: 'Ever activated', value: everActivated, note: 'subscription lapsed' },
    { label: 'Holds access now', value: entitled },
  ];
}
