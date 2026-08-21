import { useMemo, useState } from 'react';
import { AlertCircle, Check, Gift, Loader2, Percent } from 'lucide-react';
import { ApiException, type Json } from '@/lib/api-client';
import { PLAN_KEYS, planKeyLabel } from '@/lib/constants';
import { toDateInput } from '@/lib/format';
import { useCreateVoucher, useUpdateVoucher } from '@/hooks/use-vouchers';
import type { VoucherModel } from '@/types/voucher';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

/// Create or edit a voucher.
///
/// The `type` switch is only offered on create — the backend treats `code` and
/// `type` as immutable so a redeemed voucher's meaning can't change under the
/// users who already used it.

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-3 mt-6 text-[15px] font-bold first:mt-0">{children}</h3>;
}

function Field({
  label,
  helper,
  error,
  children,
}: {
  label?: string;
  helper?: React.ReactNode;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && <Label>{label}</Label>}
      {children}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : (
        helper && <p className="text-xs leading-relaxed text-muted-foreground">{helper}</p>
      )}
    </div>
  );
}

const CODE_RE = /^[A-Za-z0-9_-]+$/;

export function VoucherFormDialog({
  voucher,
  onOpenChange,
}: {
  voucher: VoucherModel | null;
  onOpenChange: (open: boolean) => void;
}) {
  const isEdit = voucher != null;

  const [type, setType] = useState(voucher?.type ?? 'entitlement');
  const [code, setCode] = useState(voucher?.code ?? '');
  const [grantTier, setGrantTier] = useState(voucher?.grantTier ?? 'Premium');
  const [grantDays, setGrantDays] = useState(String(voucher?.grantDays ?? 30));
  const [razorpayOfferId, setRazorpayOfferId] = useState(voucher?.razorpayOfferId ?? '');
  const [previewDiscountType, setPreviewDiscountType] = useState(voucher?.previewDiscountType ?? '');
  const [previewDiscountValue, setPreviewDiscountValue] = useState(
    voucher?.previewDiscountValue != null ? String(voucher.previewDiscountValue) : '',
  );
  const [appleCodes, setAppleCodes] = useState<Record<string, string>>(() =>
    Object.fromEntries(PLAN_KEYS.map((k) => [k, voucher?.appleOfferCodes[k] ?? ''])),
  );
  const [maxRedemptions, setMaxRedemptions] = useState(String(voucher?.maxRedemptions ?? -1));
  const [perUserLimit, setPerUserLimit] = useState(String(voucher?.perUserLimit ?? 1));
  const [validPlans, setValidPlans] = useState<Set<string>>(new Set(voucher?.validPlans ?? []));
  const [validFrom, setValidFrom] = useState(toDateInput(voucher?.validFrom ?? new Date()));
  const [validUntil, setValidUntil] = useState(
    toDateInput(voucher?.validUntil ?? new Date(Date.now() + 30 * 86_400_000)),
  );
  const [notes, setNotes] = useState(voucher?.notes ?? '');
  const [tags, setTags] = useState(voucher?.tags.join(', ') ?? '');
  const [isActive, setIsActive] = useState(voucher?.isActive ?? true);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const create = useCreateVoucher();
  const update = useUpdateVoucher();
  const submitting = create.isPending || update.isPending;

  const filledAppleCodes = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(appleCodes)
          .map(([k, v]) => [k, v.trim()])
          .filter(([, v]) => v.length > 0),
      ),
    [appleCodes],
  );

  function validate(): boolean {
    const errs: Record<string, string> = {};

    if (!isEdit) {
      const c = code.trim();
      if (c.length < 3 || c.length > 32) errs.code = 'Must be 3–32 characters.';
      else if (!CODE_RE.test(c)) errs.code = 'Letters, numbers, hyphen or underscore only.';
    }

    if (type === 'entitlement') {
      const n = Number.parseInt(grantDays.trim(), 10);
      if (Number.isNaN(n) || n <= 0 || n > 3650) errs.grantDays = 'Enter 1–3650.';
    } else if (previewDiscountType) {
      const text = previewDiscountValue.trim();
      if (!text) errs.previewDiscountValue = 'Required when a preview type is set';
      else {
        const parsed = Number(text);
        if (Number.isNaN(parsed) || parsed <= 0) errs.previewDiscountValue = 'Must be greater than 0';
        else if (previewDiscountType === 'percentage' && parsed > 100)
          errs.previewDiscountValue = 'Max 100%';
      }
    }

    const maxN = Number.parseInt(maxRedemptions.trim(), 10);
    if (Number.isNaN(maxN)) errs.maxRedemptions = 'Enter a number.';
    else if (maxN !== -1 && maxN <= 0) errs.maxRedemptions = 'Use -1, or a positive number.';

    const perN = Number.parseInt(perUserLimit.trim(), 10);
    if (Number.isNaN(perN) || perN <= 0 || perN > 100) errs.perUserLimit = 'Enter 1–100.';

    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function submit() {
    setError(null);
    if (!validate()) return;

    // Cross-field rule the backend also enforces: a discount voucher with no
    // offer on either platform would be a code that looks live but can't be used.
    if (type === 'discount' && !razorpayOfferId.trim() && Object.keys(filledAppleCodes).length === 0) {
      setError(
        'A discount voucher needs a Razorpay Offer ID (Android) or at least one Apple offer code (iOS).',
      );
      return;
    }

    const from = new Date(validFrom);
    const until = new Date(validUntil);
    if (!(until.getTime() > from.getTime())) {
      setError('The end date must be after the start date.');
      return;
    }

    const common: Json = {
      maxRedemptions: Number.parseInt(maxRedemptions.trim(), 10),
      perUserLimit: Number.parseInt(perUserLimit.trim(), 10),
      validPlans: [...validPlans],
      validFrom: from.toISOString(),
      validUntil: until.toISOString(),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      tags: tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    };

    const typeFields: Json =
      type === 'entitlement'
        ? { grantTier, grantDays: Number.parseInt(grantDays.trim(), 10) }
        : {
            ...(razorpayOfferId.trim() ? { razorpayOfferId: razorpayOfferId.trim() } : {}),
            ...(Object.keys(filledAppleCodes).length > 0 ? { appleOfferCodes: filledAppleCodes } : {}),
            // Display-only preview. Sent only when BOTH are present — the server
            // rejects a type without a value, and a half-filled preview would
            // show the user a wrong number.
            ...(previewDiscountType && previewDiscountValue.trim()
              ? {
                  previewDiscountType,
                  previewDiscountValue: Number(previewDiscountValue.trim()),
                }
              : {}),
          };

    try {
      if (isEdit) {
        // `code` and `type` are immutable server-side, so they are never sent.
        await update.mutateAsync({
          id: voucher.id,
          body: { ...common, ...typeFields, isActive },
        });
      } else {
        await create.mutateAsync({
          type,
          code: code.trim().toUpperCase(),
          ...common,
          ...typeFields,
        });
      }
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof ApiException ? e.message : 'Something went wrong. Please try again.');
    }
  }

  function togglePlan(key: string) {
    setValidPlans((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !submitting && onOpenChange(open)}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit voucher' : 'New voucher'}</DialogTitle>
        </DialogHeader>

        <DialogBody>
          <SectionTitle>Type</SectionTitle>
          {isEdit ? (
            <div className="rounded-[10px] border border-border bg-muted/50 p-3.5 text-[12.5px] leading-relaxed">
              This voucher is an {voucher.type} voucher. Type and code can&apos;t change after
              creation — a redeemed code&apos;s meaning must stay the same for the users who already
              used it.
            </div>
          ) : (
            <div className="inline-flex rounded-lg border border-input p-1">
              {(
                [
                  ['entitlement', 'Entitlement', Gift],
                  ['discount', 'Discount', Percent],
                ] as const
              ).map(([value, label, Icon]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setType(value)}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-4 py-1.5 text-sm font-medium transition-colors',
                    type === value
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-secondary',
                  )}
                >
                  <Icon className="size-4" /> {label}
                </button>
              ))}
            </div>
          )}
          <p className="mt-2.5 text-[12.5px] leading-relaxed text-muted-foreground">
            {type === 'entitlement'
              ? 'Grants free access directly. Works on both platforms, no store setup needed.'
              : 'Applies a discount to a paid purchase. The discount itself must already exist in the Razorpay Dashboard / App Store Connect — it is only referenced here.'}
          </p>

          <SectionTitle>Code</SectionTitle>
          <Field
            error={fieldErrors.code}
            helper={
              isEdit
                ? 'Codes are immutable.'
                : '3–32 characters: letters, numbers, hyphen or underscore. Stored uppercase.'
            }
          >
            <Input
              value={code}
              disabled={isEdit}
              placeholder="LAUNCH30"
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
          </Field>

          {type === 'entitlement' ? (
            <>
              <SectionTitle>What it grants</SectionTitle>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Tier">
                  <Select value={grantTier} onValueChange={setGrantTier}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Premium">Premium (Pro)</SelectItem>
                      <SelectItem value="Basic">Basic</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Days of access" error={fieldErrors.grantDays}>
                  <Input
                    type="number"
                    value={grantDays}
                    onChange={(e) => setGrantDays(e.target.value)}
                  />
                </Field>
              </div>
            </>
          ) : (
            <>
              <SectionTitle>Android — Razorpay</SectionTitle>
              <Field
                label="Razorpay Offer ID"
                helper="Create the Offer in the Razorpay Dashboard first — it cannot be created through the API. Leave blank if this code is iOS-only."
              >
                <Input
                  value={razorpayOfferId}
                  placeholder="offer_XXXXXXXXXXXX"
                  onChange={(e) => setRazorpayOfferId(e.target.value)}
                />
              </Field>

              <SectionTitle>Android — what the app shows (optional)</SectionTitle>
              <p className="mb-3 text-[12.5px] leading-relaxed text-muted-foreground">
                Razorpay gives us no way to read the discount back, so enter it here to show
                &quot;₹999 → ₹799&quot; on the paywall. This is DISPLAY ONLY — Razorpay applies the
                real Offer and decides what is charged. If it disagrees with the Offer the user sees
                a wrong number, so update both together. Leave blank to show &quot;discount applied
                at checkout&quot; instead.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Preview type">
                  <Select
                    value={previewDiscountType || 'none'}
                    onValueChange={(v) => setPreviewDiscountType(v === 'none' ? '' : v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="percentage">Percentage</SelectItem>
                      <SelectItem value="flat">Flat (paise)</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field
                  label="Preview value"
                  error={fieldErrors.previewDiscountValue}
                  helper={
                    previewDiscountType === 'flat' ? 'Paise — 20000 = ₹200 off' : 'Percent off, 1-100'
                  }
                >
                  <Input
                    type="number"
                    disabled={!previewDiscountType}
                    value={previewDiscountValue}
                    placeholder={previewDiscountType === 'flat' ? '20000' : '20'}
                    onChange={(e) => setPreviewDiscountValue(e.target.value)}
                  />
                </Field>
              </div>

              <SectionTitle>iOS — App Store Connect</SectionTitle>
              <p className="mb-3 text-[12.5px] leading-relaxed text-muted-foreground">
                Apple offer codes are per-product, so a campaign covering several plans needs a
                separate code for each. Generate them in App Store Connect → your subscription →
                Offer Codes, then paste each one against its plan. Leave blank if Android-only.
              </p>
              <div className="flex flex-col gap-3">
                {PLAN_KEYS.map((key) => (
                  <Field key={key} label={planKeyLabel(key)}>
                    <Input
                      value={appleCodes[key] ?? ''}
                      placeholder="Apple offer code"
                      onChange={(e) =>
                        setAppleCodes((prev) => ({ ...prev, [key]: e.target.value }))
                      }
                    />
                  </Field>
                ))}
              </div>
            </>
          )}

          <SectionTitle>Limits</SectionTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Total redemptions"
              helper="-1 for unlimited"
              error={fieldErrors.maxRedemptions}
            >
              <Input
                type="number"
                value={maxRedemptions}
                onChange={(e) => setMaxRedemptions(e.target.value)}
              />
            </Field>
            <Field
              label="Per user"
              helper="How many times one user may redeem"
              error={fieldErrors.perUserLimit}
            >
              <Input
                type="number"
                value={perUserLimit}
                onChange={(e) => setPerUserLimit(e.target.value)}
              />
            </Field>
          </div>

          <SectionTitle>Eligible plans</SectionTitle>
          <p className="mb-2.5 text-[12.5px] text-muted-foreground">
            {validPlans.size === 0
              ? 'None selected — the code works on every plan.'
              : 'Only the selected plans can use this code.'}
          </p>
          <div className="flex flex-wrap gap-2">
            {PLAN_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => togglePlan(key)}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-[12.5px] transition-colors',
                  validPlans.has(key)
                    ? 'border-primary bg-primary/[0.12] font-semibold text-primary'
                    : 'border-input bg-card text-muted-foreground hover:bg-secondary',
                )}
              >
                {planKeyLabel(key)}
              </button>
            ))}
          </div>

          <SectionTitle>Valid period</SectionTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Starts">
              <Input
                type="date"
                value={validFrom}
                onChange={(e) => {
                  const next = e.target.value;
                  setValidFrom(next);
                  // Keep the range coherent rather than letting the admin submit
                  // an end-before-start the backend would reject anyway.
                  if (new Date(validUntil) <= new Date(next)) {
                    setValidUntil(toDateInput(new Date(new Date(next).getTime() + 30 * 86_400_000)));
                  }
                }}
              />
            </Field>
            <Field label="Ends">
              <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
            </Field>
          </div>

          <SectionTitle>Notes & tags</SectionTitle>
          <div className="flex flex-col gap-3">
            <Field>
              <Textarea
                rows={2}
                maxLength={500}
                value={notes}
                placeholder="Internal note — not shown to users"
                onChange={(e) => setNotes(e.target.value)}
              />
            </Field>
            <Field helper="Comma separated">
              <Input value={tags} placeholder="launch, festive" onChange={(e) => setTags(e.target.value)} />
            </Field>
          </div>

          {isEdit && (
            <div className="mt-5 flex items-start gap-3 rounded-lg border border-border p-3.5">
              <Switch checked={isActive} onCheckedChange={setIsActive} className="mt-0.5" />
              <div>
                <p className="text-sm font-medium">Active</p>
                <p className="text-xs text-muted-foreground">
                  Turning this off stops new redemptions. Access already granted is unaffected.
                </p>
              </div>
            </div>
          )}

          {error && (
            <div className="mt-5 flex items-start gap-2.5 rounded-[10px] border border-red-200 bg-red-50 p-3.5 dark:border-red-900 dark:bg-red-950/40">
              <AlertCircle className="mt-0.5 size-5 shrink-0 text-destructive" />
              <p className="text-[13px] text-red-900 dark:text-red-300">{error}</p>
            </div>
          )}
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={submitting} onClick={() => void submit()}>
            {submitting ? <Loader2 className="animate-spin" /> : <Check />}
            {isEdit ? 'Save changes' : 'Create voucher'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
