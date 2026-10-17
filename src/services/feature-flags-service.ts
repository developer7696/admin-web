import { adminApi, ApiException, type Json } from '@/lib/api-client';
import { parseFeatureFlag, type FeatureFlag } from '@/types/feature-flag';

/// Feature flags, as data. API only: the flags live in `content_config/app`,
/// and the server is what audits a change and drops its config cache.
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
      `Unexpected problem with feature flags: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

const parseList = (json: Json): FeatureFlag[] =>
  (Array.isArray(json.features) ? (json.features as unknown[]) : [])
    .filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null)
    .map(parseFeatureFlag)
    .filter((flag) => flag.key !== '');

export const featureFlagsService = {
  list: (): Promise<FeatureFlag[]> => guard(async () => parseList(await adminApi.featureFlags())),

  set: (key: string, enabled: boolean): Promise<FeatureFlag[]> =>
    guard(async () => parseList(await adminApi.setFeatureFlag(key, enabled))),
};
