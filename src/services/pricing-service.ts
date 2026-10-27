import { adminApi, ApiException, type Json } from '@/lib/api-client';
import { parsePricingRegion, type PlanKey, type PricingRegion } from '@/types/pricing';

/// Price regions, as data. API only: the server creates the Razorpay plans,
/// audits every change and emails the owner.
///
/// Every function throws `ApiException` and nothing else.

async function guard<T>(body: () => Promise<T>): Promise<T> {
  try {
    return await body();
  } catch (e) {
    if (e instanceof ApiException) throw e;
    throw new ApiException(
      0,
      'unexpected',
      `Unexpected problem with pricing: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

const parseList = (json: Json): PricingRegion[] =>
  (Array.isArray(json.regions) ? (json.regions as unknown[]) : [])
    .filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null)
    .map(parsePricingRegion)
    .filter((region) => region.currency !== '');

export type NewRegion = {
  currency: string;
  name: string;
  countries: string[];
  isDefault: boolean;
  prices: Record<PlanKey, number>;
};

export type RegionPatch = { name?: string; countries?: string[]; isDefault?: true };

export const pricingService = {
  list: (): Promise<PricingRegion[]> => guard(async () => parseList(await adminApi.pricingRegions())),

  create: (region: NewRegion): Promise<PricingRegion[]> =>
    guard(async () => parseList(await adminApi.createPricingRegion(region))),

  update: (currency: string, patch: RegionPatch): Promise<PricingRegion[]> =>
    guard(async () => parseList(await adminApi.updatePricingRegion(currency, patch))),

  setPrices: (currency: string, prices: Partial<Record<PlanKey, number>>): Promise<PricingRegion[]> =>
    guard(async () => parseList(await adminApi.setPricingRegionPrices(currency, prices))),

  remove: (currency: string): Promise<PricingRegion[]> =>
    guard(async () => parseList(await adminApi.deletePricingRegion(currency))),
};
