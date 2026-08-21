import { toDateOrNow } from '@/lib/format';

/// A voucher as returned by the backend's `voucherToJson`.
///
/// Two types share this shape:
/// - `entitlement` — grants access directly; `grantTier` + `grantDays` are set.
/// - `discount` — references a discount that already exists at the payment
///   provider; `razorpayOfferId` (Android) and/or `appleOfferCodes` (iOS, keyed
///   per plan because Apple offer codes are per-product) are set.
export type VoucherModel = {
  id: string;
  code: string;
  type: 'entitlement' | 'discount';
  isActive: boolean;

  // Entitlement-only.
  grantTier: string | null;
  grantDays: number | null;

  // Discount-only.
  razorpayOfferId: string | null;
  appleOfferCodes: Record<string, string>;

  /// DISPLAY ONLY — what the Android paywall shows before checkout, e.g.
  /// "₹999 → ₹799". Razorpay's SDK exposes no Offers API, so this is re-entered
  /// by hand to match the linked Offer. It never decides what is charged;
  /// Razorpay applies the Offer and remains the only authority on price. Leave
  /// it unset and the app says "discount applied at checkout" instead of risking
  /// a stale figure. iOS ignores it — Apple owns that screen.
  previewDiscountType: string | null; // 'percentage' | 'flat'
  previewDiscountValue: number | null;

  /// `-1` means unlimited.
  maxRedemptions: number;
  redemptionCount: number;
  perUserLimit: number;

  /// Empty means "valid for every plan".
  validPlans: string[];
  validFrom: Date;
  validUntil: Date;
  createdAt: Date;
  createdBy: string;
  notes: string | null;
  tags: string[];

  /// `null` when `maxRedemptions` is unlimited.
  remainingRedemptions: number | null;
};

const int = (v: unknown, fallback: number) => (typeof v === 'number' ? Math.trunc(v) : fallback);
const intOrNull = (v: unknown) => (typeof v === 'number' ? Math.trunc(v) : null);
const strOrNull = (v: unknown) => (v == null ? null : String(v));

export function parseVoucher(json: Record<string, unknown>): VoucherModel {
  const rawApple = json.appleOfferCodes;
  const appleOfferCodes: Record<string, string> = {};
  if (rawApple && typeof rawApple === 'object' && !Array.isArray(rawApple)) {
    for (const [k, v] of Object.entries(rawApple as Record<string, unknown>)) {
      appleOfferCodes[k] = String(v);
    }
  }

  return {
    id: json.id == null ? '' : String(json.id),
    code: json.code == null ? '' : String(json.code),
    type: String(json.type) === 'discount' ? 'discount' : 'entitlement',
    isActive: json.isActive !== false,
    grantTier: strOrNull(json.grantTier),
    grantDays: intOrNull(json.grantDays),
    razorpayOfferId: strOrNull(json.razorpayOfferId),
    appleOfferCodes,
    previewDiscountType: strOrNull(json.previewDiscountType),
    previewDiscountValue: typeof json.previewDiscountValue === 'number' ? json.previewDiscountValue : null,
    maxRedemptions: int(json.maxRedemptions, -1),
    redemptionCount: int(json.redemptionCount, 0),
    perUserLimit: int(json.perUserLimit, 1),
    validPlans: ((json.validPlans as unknown[]) ?? []).map(String),
    validFrom: toDateOrNow(json.validFrom),
    validUntil: toDateOrNow(json.validUntil),
    createdAt: toDateOrNow(json.createdAt),
    createdBy: json.createdBy == null ? '' : String(json.createdBy),
    notes: strOrNull(json.notes),
    tags: ((json.tags as unknown[]) ?? []).map(String),
    remainingRedemptions: intOrNull(json.remainingRedemptions),
  };
}

export const isEntitlement = (v: VoucherModel) => v.type === 'entitlement';
export const isDiscount = (v: VoucherModel) => v.type === 'discount';
export const isUnlimited = (v: VoucherModel) => v.maxRedemptions === -1;
export const isExpired = (v: VoucherModel) => Date.now() > v.validUntil.getTime();
export const isNotYetValid = (v: VoucherModel) => Date.now() < v.validFrom.getTime();
export const isLimitReached = (v: VoucherModel) =>
  !isUnlimited(v) && v.redemptionCount >= v.maxRedemptions;

/// Which platforms a discount voucher can actually be used on. Empty for an
/// entitlement voucher, which works everywhere.
export function discountPlatforms(v: VoucherModel): string[] {
  const out: string[] = [];
  if (v.razorpayOfferId) out.push('Android');
  if (Object.keys(v.appleOfferCodes).length > 0) out.push('iOS');
  return out;
}

/// Single status label, most-blocking reason first — a deactivated code is
/// unusable regardless of dates, and an expired one regardless of its cap.
export function voucherStatus(v: VoucherModel): string {
  if (!v.isActive) return 'Inactive';
  if (isExpired(v)) return 'Expired';
  if (isNotYetValid(v)) return 'Scheduled';
  if (isLimitReached(v)) return 'Limit reached';
  return 'Active';
}

/// What this voucher gives, in one line, for the list row.
export function voucherSummary(v: VoucherModel): string {
  if (isEntitlement(v)) return `${v.grantDays} days of ${v.grantTier ?? 'access'}, free`;
  const platforms = discountPlatforms(v);
  return platforms.length === 0
    ? 'Discount (no offer linked)'
    : `Discount via ${platforms.join(' + ')}`;
}

/// One row of a voucher's redemption ledger (`GET /:id/redemptions`).
export type VoucherRedemption = {
  uid: string;
  count: number;
  redeemedAt: Date;
  platform: string | null;
  planKey: string | null;
  subscriptionId: string | null;
  amountBeforePaise: number | null;
  amountAfterPaise: number | null;
};

export const parseRedemption = (json: Record<string, unknown>): VoucherRedemption => ({
  uid: json.uid == null ? '' : String(json.uid),
  count: int(json.count, 1),
  redeemedAt: toDateOrNow(json.redeemedAt),
  platform: strOrNull(json.platform),
  planKey: strOrNull(json.planKey),
  subscriptionId: strOrNull(json.subscriptionId),
  amountBeforePaise: intOrNull(json.amountBeforePaise),
  amountAfterPaise: intOrNull(json.amountAfterPaise),
});

/// Only discount redemptions carry amounts; entitlement ones are free.
export const savedPaise = (r: VoucherRedemption): number | null =>
  r.amountBeforePaise != null && r.amountAfterPaise != null
    ? r.amountBeforePaise - r.amountAfterPaise
    : null;
