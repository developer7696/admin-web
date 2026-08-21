import { useQuery } from '@tanstack/react-query';
import {
  getConversionReport,
  getPaymentEvidence,
} from '@/services/conversion-analytics-service';
import type { ConversionReport, PaymentEvidence } from '@/types/conversion';

/// Always treated as stale so Refresh (and revisiting the page) hits the
/// backend, which itself re-reads Firestore. Window-focus refetch stays off
/// because a full-collection scan is not cheap.

export const conversionReportKey = ['conversion-report'] as const;
export const conversionPaymentsKey = ['conversion-payments'] as const;

export function useConversionReport() {
  return useQuery<ConversionReport>({
    queryKey: conversionReportKey,
    queryFn: getConversionReport,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
}

export function usePaymentEvidence(enabled: boolean) {
  return useQuery<PaymentEvidence>({
    queryKey: conversionPaymentsKey,
    queryFn: getPaymentEvidence,
    enabled,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
}
