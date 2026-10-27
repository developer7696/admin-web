import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { pricingService } from '@/services/pricing-service';
import type { PricingRegion } from '@/types/pricing';

export const pricingKey = ['pricing'] as const;

/// Not held stale: this is where someone checks what users are charged.
export function usePricingRegions() {
  return useQuery<PricingRegion[]>({
    queryKey: pricingKey,
    queryFn: pricingService.list,
    staleTime: 0,
  });
}

/// Any pricing change. The server answers with every region, which goes
/// straight into the cache; `onSettled` re-reads anyway so an ambiguous
/// failure still shows what the server actually holds.
export function usePricingMutation<V>(fn: (vars: V) => Promise<PricingRegion[]>) {
  const qc = useQueryClient();
  return useMutation<PricingRegion[], Error, V>({
    mutationFn: fn,
    onSuccess: (regions) => {
      qc.setQueryData(pricingKey, regions);
    },
    onSettled: async () => {
      try {
        await qc.refetchQueries({ queryKey: pricingKey });
      } catch {
        // Never let a reload failure mask the mutation's result.
      }
    },
  });
}
