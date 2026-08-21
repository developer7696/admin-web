import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminApi, type Json } from '@/lib/api-client';
import { parseRedemption, parseVoucher, type VoucherModel, type VoucherRedemption } from '@/types/voucher';

/// Server-side list filters. `null`/undefined on either axis means "no filter",
/// matching the backend's optional `type`/`status` query params. Text search is
/// applied client-side in the page (the backend has no search param), so it
/// stays out of the key.
export type VoucherListParams = { type?: string; status?: string };

export const voucherListKey = (p: VoucherListParams) =>
  ['vouchers', p.type ?? null, p.status ?? null] as const;
export const voucherStatsKey = ['vouchers', 'stats'] as const;
export const voucherRedemptionsKey = (id: string) => ['vouchers', id, 'redemptions'] as const;

export function useVouchers(params: VoucherListParams) {
  return useQuery<VoucherModel[]>({
    queryKey: voucherListKey(params),
    queryFn: async () => {
      const json = await adminApi.listVouchers(params);
      return ((json.vouchers as unknown[]) ?? []).map((v) => parseVoucher(v as Record<string, unknown>));
    },
    staleTime: 30 * 1000,
  });
}

/// Aggregate counters: totalVouchers, activeVouchers, entitlementVouchers,
/// discountVouchers, totalRedemptions.
export function useVoucherStats() {
  return useQuery<Json>({
    queryKey: voucherStatsKey,
    queryFn: adminApi.voucherStats,
    staleTime: 60 * 1000,
  });
}

/// Redemption ledger for one voucher, newest first.
export function useVoucherRedemptions(voucherId: string | null) {
  return useQuery<VoucherRedemption[]>({
    queryKey: voucherRedemptionsKey(voucherId ?? ''),
    enabled: voucherId != null && voucherId.length > 0,
    queryFn: async () => {
      const json = await adminApi.voucherRedemptions(voucherId as string);
      return ((json.redemptions as unknown[]) ?? []).map((r) =>
        parseRedemption(r as Record<string, unknown>),
      );
    },
  });
}

/// Every voucher write invalidates both the lists and the stats — the counters
/// on the dashboard are derived from the same rows.
function useVoucherMutation<TVars>(fn: (vars: TVars) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation<unknown, Error, TVars>({
    mutationFn: fn,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['vouchers'] });
    },
  });
}

export const useCreateVoucher = () => useVoucherMutation<Json>((body) => adminApi.createVoucher(body));

export const useUpdateVoucher = () =>
  useVoucherMutation<{ id: string; body: Json }>(({ id, body }) => adminApi.updateVoucher(id, body));

export const useDeactivateVoucher = () =>
  useVoucherMutation<string>((id) => adminApi.deactivateVoucher(id));
