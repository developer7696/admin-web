import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { featureFlagsService } from '@/services/feature-flags-service';
import type { FeatureFlag } from '@/types/feature-flag';

export const featureFlagsKey = ['features'] as const;

/// Not held stale: this is where someone checks whether a kill switch took.
export function useFeatureFlags() {
  return useQuery<FeatureFlag[]>({
    queryKey: featureFlagsKey,
    queryFn: featureFlagsService.list,
    staleTime: 0,
  });
}

/// Flip one flag, then reload. `onSettled` so an ambiguous failure still
/// re-reads what the server actually holds.
export function useSetFeatureFlag() {
  const qc = useQueryClient();
  return useMutation<FeatureFlag[], Error, { key: string; enabled: boolean }>({
    mutationFn: ({ key, enabled }) => featureFlagsService.set(key, enabled),
    onSettled: async () => {
      try {
        await qc.refetchQueries({ queryKey: featureFlagsKey });
      } catch {
        // Never let a reload failure mask the mutation's result.
      }
    },
  });
}
