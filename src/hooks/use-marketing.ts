import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { marketingService } from '@/services/marketing-service';
import { isStalled, type Campaign } from '@/types/marketing';

export const marketingKey = ['marketing'] as const;

export function useMarketingSummary() {
  return useQuery({ queryKey: [...marketingKey, 'summary'], queryFn: marketingService.summary, staleTime: 0 });
}

export function useMarketingContacts(search: string) {
  return useInfiniteQuery({
    queryKey: [...marketingKey, 'contacts', search],
    queryFn: ({ pageParam }) => marketingService.contacts({ search, after: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next,
    staleTime: 0,
  });
}

/// Refreshes every 3s while any campaign is sending, so counts move live.
export function useCampaigns() {
  return useQuery<Campaign[]>({
    queryKey: [...marketingKey, 'campaigns'],
    queryFn: marketingService.campaigns,
    staleTime: 0,
    refetchInterval: (query) =>
      query.state.data?.some((c) => c.status === 'sending' && !isStalled(c)) ? 3000 : false,
  });
}

/// Any marketing change, then everything marketing re-reads.
export function useMarketingMutation<V, R>(fn: (vars: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation<R, Error, V>({
    mutationFn: fn,
    onSettled: async () => {
      try {
        await qc.invalidateQueries({ queryKey: marketingKey });
      } catch {
        // Never let a reload failure mask the mutation's result.
      }
    },
  });
}
