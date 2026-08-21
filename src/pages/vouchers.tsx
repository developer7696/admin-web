import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  CloudOff,
  Gift,
  Layers,
  MoreHorizontal,
  Percent,
  Plus,
  Receipt,
  RefreshCw,
  SquarePen,
  Ticket,
  TrendingUp,
  User,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { PLAN_KEYS, planKeyLabel } from '@/lib/constants';
import { fmtDayMonth, fmtDayMonthYear, fmtDayMonthYearTime, rupeesFromPaise } from '@/lib/format';
import { ApiException } from '@/lib/api-client';
import {
  useDeactivateVoucher,
  useVoucherRedemptions,
  useVoucherStats,
  useVouchers,
  type VoucherListParams,
} from '@/hooks/use-vouchers';
import {
  discountPlatforms,
  isDiscount,
  isEntitlement,
  isUnlimited,
  savedPaise,
  voucherStatus,
  voucherSummary,
  type VoucherModel,
} from '@/types/voucher';
import { Badge } from '@/components/ui/badge';
import { PageBar } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { HeaderSlot } from '@/app/header-slot';
import { SearchInput } from '@/components/common/search-input';
import { EmptyState, LoadingState } from '@/components/common/states';
import { cn } from '@/lib/utils';
import { VoucherFormDialog } from './voucher-form';

/// Voucher management — the admin side of the backend's `vouchers` module.
///
/// Type/status filters are applied server-side (they are part of the query key);
/// the text search is client-side because the backend has no search param.

function FilterChip({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1.5 text-[12.5px] transition-colors',
        selected
          ? 'border-primary bg-primary/[0.12] font-bold text-primary'
          : 'border-input bg-card font-medium text-slate-600 hover:bg-secondary dark:text-slate-300',
      )}
    >
      {label}
    </button>
  );
}

function StatTile({
  label,
  value,
  icon,
  tint,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tint: string;
}) {
  return (
    <Card className="flex items-center gap-3 px-4 py-3.5">
      <div className={cn('rounded-[10px] p-2 [&_svg]:size-4.5 [&_svg]:size-[18px]', tint)}>{icon}</div>
      <div className="min-w-0">
        <p className="tabular text-xl font-extrabold leading-none">{value}</p>
        <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">{label}</p>
      </div>
    </Card>
  );
}

function statusVariant(status: string) {
  switch (status) {
    case 'Active':
      return 'success' as const;
    case 'Scheduled':
      return 'default' as const;
    case 'Expired':
      return 'warning' as const;
    case 'Limit reached':
      return 'warning' as const;
    default:
      return 'secondary' as const;
  }
}

function Meta({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400 [&_svg]:size-3.5 [&_svg]:text-slate-400">
      {icon}
      {children}
    </span>
  );
}

function VoucherCard({
  voucher: v,
  onEdit,
  onRedemptions,
  onDeactivate,
}: {
  voucher: VoucherModel;
  onEdit: () => void;
  onRedemptions: () => void;
  onDeactivate: () => void;
}) {
  const entitlement = isEntitlement(v);
  const platforms = discountPlatforms(v);

  return (
    <Card className="mb-3 p-[18px]">
      <div className="flex items-start gap-3.5">
        <div
          className={cn(
            'rounded-[10px] p-2.5 [&_svg]:size-5',
            entitlement
              ? 'bg-purple-500/10 text-purple-600 dark:text-purple-400'
              : 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
          )}
        >
          {entitlement ? <Gift /> : <Percent />}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-[17px] font-extrabold tracking-wide">{v.code}</span>
            <Badge variant={statusVariant(voucherStatus(v))}>{voucherStatus(v)}</Badge>
          </div>
          <p className="mt-1 text-[13px] text-slate-600 dark:text-slate-400">{voucherSummary(v)}</p>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onEdit}>
              <SquarePen /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onRedemptions}>
              <Receipt /> Redemptions
            </DropdownMenuItem>
            {v.isActive && (
              <DropdownMenuItem destructive onSelect={onDeactivate}>
                <Ban /> Deactivate
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="mt-3.5 flex flex-wrap gap-x-5 gap-y-2">
        <Meta icon={<Users />}>
          {isUnlimited(v)
            ? `${v.redemptionCount} used · unlimited`
            : `${v.redemptionCount}/${v.maxRedemptions} used${
                v.remainingRedemptions != null ? ` · ${v.remainingRedemptions} left` : ''
              }`}
        </Meta>
        <Meta icon={<User />}>{v.perUserLimit} per user</Meta>
        <Meta icon={<Ticket />}>
          {fmtDayMonth(v.validFrom)} – {fmtDayMonthYear(v.validUntil)}
        </Meta>
        <Meta icon={<Layers />}>
          {v.validPlans.length === 0 ? 'All plans' : v.validPlans.map(planKeyLabel).join(', ')}
        </Meta>
      </div>

      {isDiscount(v) && platforms.length === 0 && (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-100 px-3 py-2.5 dark:bg-amber-950/40">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400" />
          <p className="text-xs text-amber-900 dark:text-amber-300">
            No Razorpay Offer or Apple offer code linked — this code cannot be used on any platform.
          </p>
        </div>
      )}

      {v.notes && (
        <p className="mt-2.5 line-clamp-2 text-[12.5px] italic text-muted-foreground">{v.notes}</p>
      )}

      {v.tags.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {v.tags.map((t) => (
            <Badge key={t} variant="outline" className="bg-background text-[11px] font-medium">
              {t}
            </Badge>
          ))}
        </div>
      )}
    </Card>
  );
}

/// Redemption ledger for one voucher.
function RedemptionsDialog({
  voucher,
  onOpenChange,
}: {
  voucher: VoucherModel;
  onOpenChange: (open: boolean) => void;
}) {
  const { data, isLoading, error } = useVoucherRedemptions(voucher.id);

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{voucher.code} · redemptions</DialogTitle>
          <DialogDescription>{voucherSummary(voucher)}</DialogDescription>
        </DialogHeader>
        <DialogBody className="p-0">
          {isLoading && <LoadingState />}
          {error && (
            <p className="p-8 text-center text-sm text-muted-foreground">
              {error instanceof Error ? error.message : String(error)}
            </p>
          )}
          {data?.length === 0 && (
            <p className="py-16 text-center text-sm text-muted-foreground">
              Nobody has redeemed this code yet.
            </p>
          )}
          {data && data.length > 0 && (
            <ul className="divide-y divide-border">
              {data.map((r, i) => {
                const saved = savedPaise(r);
                return (
                  <li key={`${r.uid}-${i}`} className="flex items-center gap-4 px-5 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-[13px]">{r.uid}</p>
                      <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                        {[
                          fmtDayMonthYearTime(r.redeemedAt),
                          r.platform,
                          r.planKey ? planKeyLabel(r.planKey) : null,
                          r.count > 1 ? `×${r.count}` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                    {saved != null && (
                      <span className="tabular shrink-0 text-[13px] font-bold text-emerald-600 dark:text-emerald-400">
                        −{rupeesFromPaise(saved)}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

export function VouchersPage() {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string | undefined>();
  const [statusFilter, setStatusFilter] = useState<string | undefined>();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<VoucherModel | null>(null);
  const [redemptionsFor, setRedemptionsFor] = useState<VoucherModel | null>(null);
  const [deactivating, setDeactivating] = useState<VoucherModel | null>(null);

  const params: VoucherListParams = { type: typeFilter, status: statusFilter };
  const { data: all, isLoading, isError, error, refetch } = useVouchers(params);
  const { data: stats } = useVoucherStats();
  const deactivate = useDeactivateVoucher();

  const filtered = useMemo(() => {
    if (!all) return [];
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (v) =>
        v.code.toLowerCase().includes(q) ||
        (v.notes?.toLowerCase().includes(q) ?? false) ||
        v.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }, [all, search]);

  const n = (key: string) => (typeof stats?.[key] === 'number' ? (stats[key] as number) : 0);

  async function runDeactivate(v: VoucherModel) {
    try {
      await deactivate.mutateAsync(v.id);
      toast.success(`${v.code} deactivated.`);
    } catch (e) {
      toast.error(e instanceof ApiException ? e.message : 'Something went wrong. Please try again.');
    }
  }

  return (
    <div className="flex h-full flex-col">
      {stats && (
        <div className="grid gap-2.5 px-4 pb-2.5 sm:grid-cols-2 xl:grid-cols-5">
          <StatTile label="Total" value={n('totalVouchers')} icon={<Ticket />} tint="bg-blue-500/10 text-blue-600 dark:text-blue-400" />
          <StatTile label="Active now" value={n('activeVouchers')} icon={<CheckCircle2 />} tint="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" />
          <StatTile label="Entitlement" value={n('entitlementVouchers')} icon={<Gift />} tint="bg-purple-500/10 text-purple-600 dark:text-purple-400" />
          <StatTile label="Discount" value={n('discountVouchers')} icon={<Percent />} tint="bg-orange-500/10 text-orange-600 dark:text-orange-400" />
          <StatTile label="Redemptions" value={n('totalRedemptions')} icon={<TrendingUp />} tint="bg-cyan-500/10 text-cyan-600 dark:text-cyan-400" />
        </div>
      )}

      <HeaderSlot>
        <SearchInput
          value={search}
          onChange={setSearch}
          variant="header"
          placeholder="Search code, notes or tags…"
          className="w-full max-w-md"
        />
      </HeaderSlot>

      <PageBar
        title="Vouchers"
        status={
          all == null
            ? 'Loading…'
            : filtered.length === all.length
              ? `${all.length} codes`
              : `${filtered.length} of ${all.length} codes`
        }
        className="px-4 pb-2.5 pt-4"
      >
        <Button
          size="sm"
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus /> New voucher
        </Button>
      </PageBar>

      <div className="flex flex-wrap items-center gap-1.5 px-4">
        <FilterChip label="All types" selected={typeFilter == null} onClick={() => setTypeFilter(undefined)} />
        <FilterChip label="Entitlement" selected={typeFilter === 'entitlement'} onClick={() => setTypeFilter('entitlement')} />
        <FilterChip label="Discount" selected={typeFilter === 'discount'} onClick={() => setTypeFilter('discount')} />
        <div className="mx-1 h-[22px] w-px bg-border" />
        <FilterChip label="Any status" selected={statusFilter == null} onClick={() => setStatusFilter(undefined)} />
        <FilterChip label="Active" selected={statusFilter === 'active'} onClick={() => setStatusFilter('active')} />
        <FilterChip label="Inactive" selected={statusFilter === 'inactive'} onClick={() => setStatusFilter('inactive')} />
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-3">
        {isLoading && <LoadingState />}

        {isError && (
          <div className="flex flex-col items-center justify-center gap-3.5 py-16 text-center">
            <CloudOff className="size-11 text-destructive" />
            <p className="text-[15px] font-semibold">Could not load vouchers</p>
            <p className="max-w-lg text-[12.5px] text-muted-foreground">
              {error instanceof Error ? error.message : String(error)}
            </p>
            <Button onClick={() => void refetch()}>
              <RefreshCw /> Retry
            </Button>
          </div>
        )}

        {all && filtered.length === 0 && (
          <EmptyState
            icon={<Ticket className="size-12" />}
            title={all.length === 0 ? 'No vouchers yet' : 'No vouchers match these filters'}
            hint={
              all.length === 0
                ? 'Create an entitlement voucher to grant free access, or a discount voucher that points at an existing Razorpay Offer / Apple offer code.'
                : 'Try clearing the search or filters.'
            }
            action={
              all.length === 0 ? (
                <Button
                  onClick={() => {
                    setEditing(null);
                    setFormOpen(true);
                  }}
                >
                  <Plus /> New voucher
                </Button>
              ) : undefined
            }
          />
        )}

        {filtered.map((v) => (
          <VoucherCard
            key={v.id}
            voucher={v}
            onEdit={() => {
              setEditing(v);
              setFormOpen(true);
            }}
            onRedemptions={() => setRedemptionsFor(v)}
            onDeactivate={() => setDeactivating(v)}
          />
        ))}
      </div>

      {formOpen && (
        <VoucherFormDialog
          voucher={editing}
          onOpenChange={(open) => {
            setFormOpen(open);
            if (!open) setEditing(null);
          }}
        />
      )}

      {redemptionsFor && (
        <RedemptionsDialog
          voucher={redemptionsFor}
          onOpenChange={(open) => !open && setRedemptionsFor(null)}
        />
      )}

      {deactivating && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setDeactivating(null)}
          title={`Deactivate ${deactivating.code}?`}
          description="The code stops working for new redemptions immediately. Access already granted by this code is NOT revoked, and the redemption history is kept."
          confirmLabel="Deactivate"
          destructive
          onConfirm={() => runDeactivate(deactivating)}
        />
      )}
    </div>
  );
}

export { PLAN_KEYS };
