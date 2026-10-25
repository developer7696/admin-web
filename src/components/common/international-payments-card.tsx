import { useState } from 'react';
import { Globe } from 'lucide-react';
import { toast } from 'sonner';
import { useCan } from '@/auth/auth-context';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { usePaymentSettings, useSetInternationalPayments } from '@/hooks/use-payment-settings';
import { ApiException } from '@/lib/api-client';
import { fmtDayMonthYearTime } from '@/lib/format';

/// The "International payments" switch on the Payments tab.
///
/// ON: a new Android purchase from an international phone number (anything
/// other than +91) is priced in EUR for eurozone numbers and USD for the rest.
/// OFF: every new purchase is INR, the app as
/// it has always been. Either way it only decides NEW purchases - a
/// subscription already running in USD or EUR keeps renewing in it, because Razorpay
/// charges the plan a subscription was created on. iOS is unaffected: Apple
/// prices every storefront itself.
export function InternationalPaymentsCard() {
  const settingsQ = usePaymentSettings();
  const setEnabled = useSetInternationalPayments();
  const canWrite = useCan('billing:write');
  const [pending, setPending] = useState<boolean | null>(null);

  const settings = settingsQ.data;
  const enabled = settings?.internationalPaymentsEnabled === true;
  const blockedOn = settings != null && !settings.usdPlansConfigured && !enabled;

  async function confirm() {
    if (pending == null) return;
    try {
      await setEnabled.mutateAsync(pending);
      toast.success(pending ? 'International payments are on.' : 'International payments are off.');
    } catch (e) {
      toast.error(e instanceof ApiException || e instanceof Error ? e.message : 'Could not save.');
    }
  }

  return (
    <Card className="mb-2.5 p-3.5">
      <div className="flex items-start gap-3">
        <Globe className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-bold">International payments</span>
            {settings && (
              <span
                className={
                  enabled
                    ? 'rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300'
                    : 'rounded-full bg-slate-500/15 px-2 py-0.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300'
                }
              >
                {enabled ? 'On — USD / EUR for international users' : 'Off — INR for everyone'}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            When on, new Android purchases from phone numbers outside India (+91) are priced in
            USD, or EUR for eurozone numbers. When off, every new purchase is in INR. Existing USD
            and EUR subscriptions keep renewing in their own currency either way. iOS is not
            affected.
          </p>
          {blockedOn && (
            <p className="mt-1.5 text-xs font-semibold text-orange-600">
              USD Razorpay plans are not configured on the server yet, so this cannot be turned on.
            </p>
          )}
          {settings != null && !blockedOn && !settings.eurPlansConfigured && (
            <p className="mt-1.5 text-xs text-muted-foreground">
              EUR plans are not configured yet, so eurozone users are priced in USD for now.
            </p>
          )}
          {settingsQ.isError && (
            <p className="mt-1.5 text-xs font-semibold text-destructive">
              Could not load this setting.{' '}
              <button type="button" className="underline" onClick={() => void settingsQ.refetch()}>
                Retry
              </button>
            </p>
          )}
          {settings?.updatedAt && (
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Last changed {fmtDayMonthYearTime(new Date(settings.updatedAt))}
              {settings.updatedBy ? ` by ${settings.updatedBy}` : ''}
            </p>
          )}
        </div>
        <Switch
          checked={enabled}
          disabled={!canWrite || settings == null || blockedOn || setEnabled.isPending}
          onCheckedChange={(value) => setPending(value)}
          aria-label="International payments"
          title={canWrite ? undefined : 'Needs the billing edit permission'}
        />
      </div>

      <ConfirmDialog
        open={pending != null}
        onOpenChange={(open) => !open && setPending(null)}
        title={pending ? 'Turn on international payments?' : 'Turn off international payments?'}
        description={
          pending
            ? 'New Android purchases from phone numbers outside India will be priced and charged in USD (EUR for eurozone numbers). Indian users are unchanged.'
            : 'Every new purchase will be priced in INR again. Subscriptions already running in USD or EUR will keep renewing in their own currency.'
        }
        confirmLabel={pending ? 'Turn on' : 'Turn off'}
        destructive={pending === false}
        onConfirm={confirm}
      />
    </Card>
  );
}
