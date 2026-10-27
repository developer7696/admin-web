import { describe, expect, it } from 'vitest';
import { parsePricingRegion } from './pricing';

describe('parsePricingRegion', () => {
  it('reads a region and marks a plan without a Razorpay plan', () => {
    const region = parsePricingRegion({
      currency: 'GBP',
      name: 'United Kingdom',
      countries: ['GB', 7],
      isDefault: false,
      isHome: false,
      configured: false,
      prices: {
        premium_monthly: { amountMinor: 999, planId: 'plan_1' },
        premium_annual: { amountMinor: 7499, planId: null },
      },
    });
    expect(region.countries).toEqual(['GB']);
    expect(region.prices.premium_monthly).toEqual({ amountMinor: 999, planId: 'plan_1' });
    expect(region.prices.premium_annual).toEqual({ amountMinor: 7499, planId: null });
    expect(region.prices.basic_monthly).toBeNull();
  });

  it('falls back to the currency for a missing name', () => {
    expect(parsePricingRegion({ currency: 'AED', prices: {} }).name).toBe('AED');
  });
});
