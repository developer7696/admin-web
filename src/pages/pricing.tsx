import { useMemo, useState } from 'react';
import { AlertTriangle, Globe, Info, Loader2, Pencil, Plus, Tags, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ApiException } from '@/lib/api-client';
import { useCan } from '@/auth/auth-context';
import { PLAN_KEYS, planKeyLabel } from '@/lib/constants';
import { allCountries, countryName } from '@/lib/countries';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { usePricingMutation, usePricingRegions } from '@/hooks/use-pricing';
import { pricingService, type NewRegion, type RegionPatch } from '@/services/pricing-service';
import type { PlanKey, PricingRegion } from '@/types/pricing';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { PageBar } from '@/components/common/page-header';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';

/**
 * Who pays what. One region per currency, each with its countries and the five
 * plan prices.
 *
 * A Razorpay plan's price cannot change, so saving a price makes the server
 * create a new plan: new purchases pay the new price, existing subscribers
 * keep renewing at theirs. That is spelled out before every price save,
 * because it is not what "edit a price" usually means.
 */

const errorText = (e: unknown, fallback: string): string =>
  e instanceof ApiException ? e.message : fallback;

/// "11.99" → 1199. Undefined unless it is a positive amount with at most two decimals.
function toMinor(text: string): number | undefined {
  const clean = text.trim().replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return undefined;
  const minor = Math.round(Number(clean) * 100);
  return minor > 0 ? minor : undefined;
}

const toMajorText = (minor: number | undefined): string =>
  minor === undefined ? '' : (minor / 100).toFixed(2);

// ── Region card ─────────────────────────────────────────────────────────────

function CountriesLine({ region }: { region: PricingRegion }) {
  if (region.isDefault && region.countries.length === 0) {
    return <p className="text-xs text-muted-foreground">Every country not listed in another region</p>;
  }
  const names = region.countries.map(countryName).sort((a, b) => a.localeCompare(b));
  const shown = names.slice(0, 6).join(', ');
  const more = names.length > 6 ? ` and ${names.length - 6} more` : '';
  return (
    <p className="text-xs text-muted-foreground">
      {shown}
      {more}
      {region.isDefault && ', plus every country not listed in another region'}
    </p>
  );
}

function RegionCard({
  region,
  canWrite,
  onEditPrices,
  onEditRegion,
  onRemove,
}: {
  region: PricingRegion;
  canWrite: boolean;
  onEditPrices: () => void;
  onEditRegion: () => void;
  onRemove: () => void;
}) {
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold">{region.name}</p>
            <Badge variant="outline">{region.currency}</Badge>
            {region.isHome && <Badge>Home</Badge>}
            {region.isDefault && <Badge variant="secondary">Default</Badge>}
            {!region.configured && <Badge variant="warning">Not live — plans missing</Badge>}
          </div>
          <CountriesLine region={region} />
        </div>
        {canWrite && (
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={onEditPrices}>
              <Tags /> Prices
            </Button>
            <Button size="sm" variant="outline" onClick={onEditRegion}>
              <Pencil /> Region
            </Button>
            {!region.isHome && !region.isDefault && (
              <Button size="sm" variant="ghost" onClick={onRemove} aria-label={`Remove ${region.name}`}>
                <Trash2 />
              </Button>
            )}
          </div>
        )}
      </div>

      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        {PLAN_KEYS.map((key) => {
          const price = region.prices[key];
          return (
            <div key={key} className="flex items-center justify-between gap-3 border-b border-dashed py-1">
              <dt className="text-muted-foreground">{planKeyLabel(key)}</dt>
              <dd className={cn('font-medium tabular-nums', !price?.planId && 'text-amber-600')}>
                {price ? formatMoney(price.amountMinor, region.currency, { decimals: true }) : '—'}
                {price && !price.planId && ' · no plan'}
              </dd>
            </div>
          );
        })}
      </dl>
    </Card>
  );
}

// ── Price inputs (shared by both dialogs) ───────────────────────────────────

function PriceInputs({
  currency,
  values,
  current,
  onChange,
}: {
  currency: string;
  values: Record<PlanKey, string>;
  current?: PricingRegion['prices'];
  onChange: (key: PlanKey, value: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {PLAN_KEYS.map((key) => {
        const invalid = values[key].trim() !== '' && toMinor(values[key]) === undefined;
        const now = current?.[key];
        return (
          <div key={key} className="space-y-1">
            <Label htmlFor={`price-${key}`}>
              {planKeyLabel(key)} <span className="text-muted-foreground">({currency || '—'})</span>
            </Label>
            <Input
              id={`price-${key}`}
              inputMode="decimal"
              placeholder="0.00"
              value={values[key]}
              onChange={(e) => {
                onChange(key, e.target.value);
              }}
              aria-invalid={invalid}
            />
            {now && (
              <p className="text-[11px] text-muted-foreground">
                Now {formatMoney(now.amountMinor, currency, { decimals: true })}
              </p>
            )}
            {invalid && <p className="text-[11px] text-red-600">Enter an amount like 11.99</p>}
          </div>
        );
      })}
    </div>
  );
}

const emptyPrices = (): Record<PlanKey, string> =>
  Object.fromEntries(PLAN_KEYS.map((k) => [k, ''])) as Record<PlanKey, string>;

// ── Edit prices ─────────────────────────────────────────────────────────────

function PricesDialog({ region, onClose }: { region: PricingRegion; onClose: () => void }) {
  const [values, setValues] = useState<Record<PlanKey, string>>(
    () =>
      Object.fromEntries(
        PLAN_KEYS.map((k) => [k, toMajorText(region.prices[k]?.amountMinor)]),
      ) as Record<PlanKey, string>,
  );
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = usePricingMutation((prices: Partial<Record<PlanKey, number>>) =>
    pricingService.setPrices(region.currency, prices),
  );

  const parsed = PLAN_KEYS.map((key) => ({ key, minor: toMinor(values[key]) }));
  const allValid = parsed.every((p) => p.minor !== undefined);
  // A price that is unchanged but has no Razorpay plan is still sent: saving
  // creates the missing plan.
  const changes = parsed.filter(
    (p) =>
      p.minor !== undefined &&
      (p.minor !== region.prices[p.key]?.amountMinor || !region.prices[p.key]?.planId),
  );

  async function submit() {
    setError(null);
    try {
      await save.mutateAsync(Object.fromEntries(changes.map((c) => [c.key, c.minor])));
      toast.success(`${region.name} prices saved`);
      onClose();
    } catch (e) {
      setConfirming(false);
      setError(errorText(e, 'Could not save the prices.'));
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !save.isPending && !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {confirming ? 'Confirm new prices' : `Prices — ${region.name} (${region.currency})`}
          </DialogTitle>
          {!confirming && (
            <DialogDescription>Amounts in {region.currency}, as users will be charged.</DialogDescription>
          )}
        </DialogHeader>

        <DialogBody>
          {!confirming ? (
            <PriceInputs
              currency={region.currency}
              values={values}
              current={region.prices}
              onChange={(key, value) => {
                setValues((v) => ({ ...v, [key]: value }));
              }}
            />
          ) : (
            <div className="space-y-3 text-sm">
              <ul className="space-y-1">
                {changes.map(({ key, minor }) => {
                  const before = region.prices[key];
                  return (
                    <li key={key} className="flex justify-between gap-3 border-b border-dashed py-1">
                      <span>{planKeyLabel(key)}</span>
                      <span className="tabular-nums">
                        {before && before.amountMinor !== minor && (
                          <span className="text-muted-foreground line-through">
                            {formatMoney(before.amountMinor, region.currency, { decimals: true })}
                          </span>
                        )}{' '}
                        <strong>{formatMoney(minor, region.currency, { decimals: true })}</strong>
                      </span>
                    </li>
                  );
                })}
              </ul>
              <div className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
                <div className="space-y-1">
                  <p>
                    New purchases in {region.name} pay these prices within a minute. People already
                    subscribed <strong>keep renewing at their current price</strong>.
                  </p>
                  <p>
                    Each new price creates a new Razorpay plan. Android coupons that use a Razorpay
                    offer must be linked to the new plans in the Razorpay dashboard, or they stop
                    applying here.
                  </p>
                </div>
              </div>
            </div>
          )}
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        </DialogBody>

        <DialogFooter>
          {!confirming ? (
            <>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                disabled={!allValid || changes.length === 0}
                onClick={() => {
                  setConfirming(true);
                }}
              >
                Review {changes.length > 0 ? `${changes.length} change${changes.length === 1 ? '' : 's'}` : ''}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                disabled={save.isPending}
                onClick={() => {
                  setConfirming(false);
                }}
              >
                Back
              </Button>
              <Button disabled={save.isPending} onClick={() => void submit()}>
                {save.isPending && <Loader2 className="animate-spin" />} Save prices
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Countries checklist ─────────────────────────────────────────────────────

function CountryPicker({
  selected,
  takenBy,
  onChange,
}: {
  selected: Set<string>;
  /// Country → the other region that already lists it.
  takenBy: Map<string, string>;
  onChange: (next: Set<string>) => void;
}) {
  const [search, setSearch] = useState('');
  const countries = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = allCountries();
    return q === ''
      ? list
      : list.filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase() === q);
  }, [search]);

  function toggle(code: string) {
    const next = new Set(selected);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    onChange(next);
  }

  return (
    <div className="space-y-2">
      <Input
        placeholder="Search countries"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
        }}
      />
      <div className="scrollbar-thin max-h-56 overflow-y-auto rounded-md border">
        {countries.map(({ code, name }) => {
          const other = takenBy.get(code);
          return (
            <label
              key={code}
              className={cn(
                'flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted/60',
                other && 'cursor-not-allowed opacity-60',
              )}
            >
              <Checkbox
                checked={selected.has(code)}
                disabled={other !== undefined}
                onCheckedChange={() => {
                  toggle(code);
                }}
              />
              <span className="flex-1">{name}</span>
              <span className="text-[11px] text-muted-foreground">{other ? `in ${other}` : code}</span>
            </label>
          );
        })}
        {countries.length === 0 && <p className="p-3 text-sm text-muted-foreground">No match.</p>}
      </div>
      <p className="text-[11px] text-muted-foreground">{selected.size} selected</p>
    </div>
  );
}

// ── New / edit region ───────────────────────────────────────────────────────

function RegionDialog({
  region,
  regions,
  onClose,
}: {
  /// Null for a new region.
  region: PricingRegion | null;
  regions: PricingRegion[];
  onClose: () => void;
}) {
  const isNew = region === null;
  const [currency, setCurrency] = useState(region?.currency ?? '');
  const [name, setName] = useState(region?.name ?? '');
  const [makeDefault, setMakeDefault] = useState(false);
  const [countries, setCountries] = useState<Set<string>>(() => new Set(region?.countries ?? []));
  const [prices, setPrices] = useState<Record<PlanKey, string>>(emptyPrices);
  const [error, setError] = useState<string | null>(null);

  const create = usePricingMutation((body: NewRegion) => pricingService.create(body));
  const update = usePricingMutation((patch: RegionPatch) =>
    pricingService.update(region?.currency ?? '', patch),
  );
  const pending = create.isPending || update.isPending;

  const takenBy = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of regions) {
      if (r.currency === region?.currency) continue;
      for (const c of r.countries) map.set(c, r.name);
    }
    return map;
  }, [regions, region]);

  const code = currency.trim().toUpperCase();
  const codeValid = /^[A-Z]{3}$/.test(code);
  const codeTaken = isNew && regions.some((r) => r.currency === code);
  const parsedPrices = PLAN_KEYS.map((k) => [k, toMinor(prices[k])] as const);
  const pricesValid = parsedPrices.every(([, v]) => v !== undefined);
  const canSave =
    name.trim() !== '' &&
    (!isNew || (codeValid && !codeTaken && pricesValid && (countries.size > 0 || makeDefault)));

  async function submit() {
    setError(null);
    try {
      if (isNew) {
        await create.mutateAsync({
          currency: code,
          name: name.trim(),
          countries: [...countries],
          isDefault: makeDefault,
          prices: Object.fromEntries(parsedPrices) as Record<PlanKey, number>,
        });
        toast.success(`${name.trim()} added`);
      } else {
        const patch: RegionPatch = {};
        if (name.trim() !== region.name) patch.name = name.trim();
        const list = [...countries].sort();
        if (list.join() !== [...region.countries].sort().join()) patch.countries = list;
        if (makeDefault) patch.isDefault = true;
        if (Object.keys(patch).length === 0) {
          onClose();
          return;
        }
        await update.mutateAsync(patch);
        toast.success(`${name.trim()} saved`);
      }
      onClose();
    } catch (e) {
      setError(errorText(e, 'Could not save the region.'));
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !pending && !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isNew ? 'New price region' : `Region — ${region.name}`}</DialogTitle>
          <DialogDescription>
            {isNew
              ? 'Users whose phone number is from one of these countries are charged in this currency.'
              : 'Changing countries moves new purchases from them to this region at once.'}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[8rem_1fr]">
            <div className="space-y-1">
              <Label htmlFor="region-currency">Currency</Label>
              <Input
                id="region-currency"
                value={currency}
                maxLength={3}
                placeholder="GBP"
                disabled={!isNew}
                onChange={(e) => {
                  setCurrency(e.target.value.toUpperCase());
                }}
              />
              {codeTaken && <p className="text-[11px] text-red-600">Already a region.</p>}
            </div>
            <div className="space-y-1">
              <Label htmlFor="region-name">Name</Label>
              <Input
                id="region-name"
                value={name}
                maxLength={60}
                placeholder="United Kingdom"
                onChange={(e) => {
                  setName(e.target.value);
                }}
              />
            </div>
          </div>

          {!region?.isDefault && !region?.isHome && (
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={makeDefault}
                onCheckedChange={(v) => {
                  setMakeDefault(v === true);
                }}
              />
              <span>
                Default region — also prices every country no region lists
                <span className="block text-[11px] text-muted-foreground">
                  Takes over from {regions.find((r) => r.isDefault)?.name ?? 'the current default'}.
                </span>
              </span>
            </label>
          )}

          <div className="space-y-1">
            <Label>Countries</Label>
            <CountryPicker selected={countries} takenBy={takenBy} onChange={setCountries} />
          </div>

          {isNew && (
            <div className="space-y-2">
              <Label>Prices</Label>
              <PriceInputs
                currency={code}
                values={prices}
                onChange={(key, value) => {
                  setPrices((v) => ({ ...v, [key]: value }));
                }}
              />
              <p className="text-[11px] text-muted-foreground">
                Saving creates five Razorpay plans in {codeValid ? code : 'this currency'}. Only
                currencies with two decimal places can be used.
              </p>
            </div>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!canSave || pending} onClick={() => void submit()}>
            {pending && <Loader2 className="animate-spin" />} {isNew ? 'Create region' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export function PricingPage() {
  const canWrite = useCan('billing:write');
  const query = usePricingRegions();
  const regions = query.data ?? [];

  const [pricesFor, setPricesFor] = useState<PricingRegion | null>(null);
  const [regionFor, setRegionFor] = useState<PricingRegion | 'new' | null>(null);
  const [removing, setRemoving] = useState<PricingRegion | null>(null);
  const remove = usePricingMutation((currency: string) => pricingService.remove(currency));

  return (
    <div className="scrollbar-thin h-full overflow-y-auto p-4">
      <div className="mx-auto max-w-4xl space-y-3">
        <PageBar
          title="Pricing"
          status={query.data ? `${regions.length} region${regions.length === 1 ? '' : 's'}` : undefined}
        >
          {canWrite && (
            <Button
              size="sm"
              onClick={() => {
                setRegionFor('new');
              }}
            >
              <Plus /> New region
            </Button>
          )}
        </PageBar>

        <div className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3">
          <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">
            Android prices by the country of the user&apos;s phone number. India, iOS and older app
            versions always pay the INR prices; other regions apply only while{' '}
            <strong>Feature Flags → International payments</strong> is on. A price change reaches
            new purchases within a minute; existing subscribers keep their price.
            {!canWrite && ' You can view prices but not change them.'}
          </p>
        </div>

        {query.isLoading && <LoadingState label="Loading prices…" />}
        {query.isError && (
          <ErrorState
            error={query.error}
            onRetry={() => {
              void query.refetch();
            }}
          />
        )}
        {query.isSuccess && regions.length === 0 && (
          <EmptyState icon={<Globe />} title="No price regions" hint="The server returned none." />
        )}
        {regions.map((region) => (
          <RegionCard
            key={region.currency}
            region={region}
            canWrite={canWrite}
            onEditPrices={() => {
              setPricesFor(region);
            }}
            onEditRegion={() => {
              setRegionFor(region);
            }}
            onRemove={() => {
              setRemoving(region);
            }}
          />
        ))}
      </div>

      {pricesFor && (
        <PricesDialog
          region={pricesFor}
          onClose={() => {
            setPricesFor(null);
          }}
        />
      )}
      {regionFor && (
        <RegionDialog
          region={regionFor === 'new' ? null : regionFor}
          regions={regions}
          onClose={() => {
            setRegionFor(null);
          }}
        />
      )}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={`Remove ${removing?.name ?? ''}?`}
        description={
          <>
            New purchases from its countries are priced by the default region instead. People
            already subscribed in {removing?.currency} keep renewing in {removing?.currency}.
          </>
        }
        confirmLabel="Remove region"
        destructive
        onConfirm={async () => {
          if (!removing) return;
          try {
            await remove.mutateAsync(removing.currency);
            toast.success(`${removing.name} removed`);
          } catch (e) {
            toast.error(errorText(e, 'Could not remove the region.'));
          }
        }}
      />
    </div>
  );
}
