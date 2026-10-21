import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/lib/api-client';

export interface PaymentSettings {
  internationalPaymentsEnabled: boolean;
  /// Every USD Razorpay plan id is set on the server - the switch cannot turn
  /// on without it.
  usdPlansConfigured: boolean;
  /// Every EUR plan id is set. Optional - without it eurozone users get USD.
  eurPlansConfigured: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

const parse = (json: Record<string, unknown>): PaymentSettings => ({
  internationalPaymentsEnabled: json.internationalPaymentsEnabled === true,
  usdPlansConfigured: json.usdPlansConfigured === true,
  eurPlansConfigured: json.eurPlansConfigured === true,
  updatedAt: typeof json.updatedAt === 'string' ? json.updatedAt : null,
  updatedBy: typeof json.updatedBy === 'string' ? json.updatedBy : null,
});

export const paymentSettingsKey = ['settings', 'payments'] as const;

export function usePaymentSettings() {
  return useQuery<PaymentSettings>({
    queryKey: paymentSettingsKey,
    queryFn: async () => parse(await adminApi.paymentSettings()),
    staleTime: 30 * 1000,
  });
}

export function useSetInternationalPayments() {
  const client = useQueryClient();
  return useMutation<PaymentSettings, Error, boolean>({
    mutationFn: async (enabled) =>
      parse(await adminApi.updatePaymentSettings({ internationalPaymentsEnabled: enabled })),
    onSuccess: (settings) => {
      client.setQueryData(paymentSettingsKey, settings);
    },
  });
}
