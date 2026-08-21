/// Types for the conversion report — the trial/subscriber analysis of the whole
/// `users` collection.
///
/// Plain TypeScript with no Firebase imports, per ARCHITECTURE.md, so the same
/// shapes cross the service, hook and page layers.

/// Where one account stands with a subscription. Mutually exclusive and
/// exhaustive: every user document lands in exactly one, so the six counts sum
/// to the collection size.
export type ConversionSegment =
  /** Holds a valid paid entitlement right now. */
  | 'active'
  /** Holds a valid entitlement granted by an admin rather than bought. */
  | 'comp'
  /** Had an entitlement once; it has since expired or was cancelled. */
  | 'churned'
  /** Started a trial deliberately, never converted, not entitled now. */
  | 'trial_no_convert'
  /** Was handed a trial automatically at signup by the old build; never converted. */
  | 'legacy_trial_no_convert'
  /** Never had a trial of either kind and never subscribed. */
  | 'never_trialled';

/// How this account came to have a `trialStartDate`.
///
/// This distinction is the whole point of the report. See
/// `classifyTrial` in the service for why the two cannot be counted together.
export type TrialKind =
  /** `hasUsedTrial`, or a trial timestamp that diverges from signup. */
  | 'deliberate'
  /** Trial timestamp within the auto-grant window of account creation. */
  | 'auto'
  /** No `trialStartDate` at all. */
  | null;

/// Whether this looks like a real customer or one of our own accounts.
export type AccountProvenance = 'user' | 'qa' | 'internal';

/// One user document, reduced to the fields the report reasons about.
export interface ConversionUser {
  uid: string;
  email: string | null;
  username: string | null;
  phone: string | null;
  city: string | null;
  gender: string | null;
  age: number | null;
  platform: string | null;
  role: string | null;
  createdAt: Date | null;

  trialStartDate: Date | null;
  hasUsedTrial: boolean | null;
  trialKind: TrialKind;
  /** Days between account creation and the trial timestamp; null if either is missing. */
  trialGapDays: number | null;

  tier: string | null;
  plan: string | null;
  status: string | null;
  provider: string | null;
  activatedAt: Date | null;
  endDate: Date | null;
  /** True when the backend's own `isEntitlementCurrent` rule passes. */
  entitled: boolean;
  everActivated: boolean;
  pendingCheckout: boolean;
  upcomingPlan: string | null;

  totalWorkouts: number;
  lastWorkout: Date | null;
  assessmentCompleted: boolean;
  fitnessGoal: string | null;
  experienceLevel: string | null;

  segment: ConversionSegment;
  provenance: AccountProvenance;
}

export interface CountsByKey {
  [key: string]: number;
}

/// One point on the monthly timeline.
export interface MonthlyPoint {
  /** `YYYY-MM`. */
  month: string;
  /** `Aug 26` — pre-formatted so the chart axis does no date work. */
  label: string;
  signups: number;
  trials: number;
  activations: number;
}

export interface ConversionTotals {
  users: number;
  entitled: number;
  everActivated: number;
  autoTrial: number;
  deliberateTrial: number;
  anyTrial: number;
  neverTrialled: number;
  expired: number;
  pendingCheckout: number;
  assessmentCompleted: number;
  zeroWorkouts: number;
  hasWorkouts: number;
  noEmail: number;
  noCreatedAt: number;
  appleLinked: number;
  razorpayLinked: number;
  deleted: number;
}

/// Rows the funnel charts render. `note` explains the drop into the NEXT stage.
export interface FunnelStage {
  label: string;
  value: number;
  note?: string;
}

export interface ConversionReport {
  generatedAt: Date;
  users: ConversionUser[];
  totals: ConversionTotals;
  segments: CountsByKey;
  provenance: CountsByKey;
  platform: CountsByKey;
  tier: CountsByKey;
  plan: CountsByKey;
  status: CountsByKey;
  provider: CountsByKey;
  cities: [string, number][];
  goals: CountsByKey;
  experience: CountsByKey;
  gender: CountsByKey;
  deletionReasons: CountsByKey;
  monthly: MonthlyPoint[];
  userFunnel: FunnelStage[];
  /** Data-quality problems worth fixing; rendered as a checklist. */
  integrity: IntegrityFinding[];
}

export interface IntegrityFinding {
  id: string;
  title: string;
  detail: string;
  count: number;
  severity: 'warning' | 'critical';
}

/// What the payment providers recorded, independent of the user documents.
export interface PaymentEvidence {
  razorpay: {
    events: number;
    subscriptions: number;
    authenticated: number;
    activated: number;
    charged: number;
    cancelled: number;
    capturedPayments: number;
    grossPaise: number;
    refunds: number;
    refundPaise: number;
    /** Distinct email addresses that ever had a payment captured. */
    payerEmails: string[];
    funnel: FunnelStage[];
  };
  apple: {
    events: number;
    types: CountsByKey;
  };
}
