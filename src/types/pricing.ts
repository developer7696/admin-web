import { PLAN_KEYS } from '@/lib/constants';

export type PlanKey = (typeof PLAN_KEYS)[number];

/// One plan's price in a region, in the currency's smallest unit (paise, cents).
export type RegionPrice = { amountMinor: number; planId: string | null };

/// One price region, as `GET /api/admin/pricing` returns it. One per currency.
export type PricingRegion = {
  currency: string;
  name: string;
  /// ISO 3166-1 alpha-2 codes. Empty on the default region.
  countries: string[];
  /// Prices every country no region lists ("Rest of world").
  isDefault: boolean;
  /// The INR region: India, and every app build that cannot show a currency.
  isHome: boolean;
  /// Every plan has a Razorpay plan, so the region can be sold in.
  configured: boolean;
  prices: Record<PlanKey, RegionPrice | null>;
};

const parsePrice = (raw: unknown): RegionPrice | null => {
  if (typeof raw !== 'object' || raw === null) return null;
  const { amountMinor, planId } = raw as Record<string, unknown>;
  if (typeof amountMinor !== 'number') return null;
  return { amountMinor, planId: typeof planId === 'string' && planId !== '' ? planId : null };
};

export function parsePricingRegion(raw: Record<string, unknown>): PricingRegion {
  const prices = (typeof raw.prices === 'object' && raw.prices !== null ? raw.prices : {}) as Record<
    string,
    unknown
  >;
  const currency = typeof raw.currency === 'string' ? raw.currency : '';
  return {
    currency,
    name: typeof raw.name === 'string' && raw.name !== '' ? raw.name : currency,
    countries: Array.isArray(raw.countries)
      ? raw.countries.filter((c): c is string => typeof c === 'string')
      : [],
    isDefault: raw.isDefault === true,
    isHome: raw.isHome === true,
    configured: raw.configured === true,
    prices: Object.fromEntries(PLAN_KEYS.map((k) => [k, parsePrice(prices[k])])) as PricingRegion['prices'],
  };
}
