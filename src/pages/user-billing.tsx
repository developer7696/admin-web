import { useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  Banknote,
  Bolt,
  Building2,
  ChevronLeft,
  CircleDashed,
  CircleSlash,
  Clock,
  Copy,
  CreditCard,
  Gift,
  IndianRupee,
  Loader2,
  PlayCircle,
  QrCode,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  SwitchCamera,
  TimerOff,
  User,
  Wallet,
} from 'lucide-react';
import { toast } from 'sonner';
import { adminApi, ApiException, type Json } from '@/lib/api-client';
import { fmtDayMonthYearClock } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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
import { LoadingState } from '@/components/common/states';
import { cn } from '@/lib/utils';

/// Full billing history for one user: current entitlement, the LIVE Razorpay
/// subscription/invoices/payments (with refund status + refund action), and a
/// merged timeline of webhook events + admin/user actions.
///
/// Data source: GET /api/admin/users/:uid/payment-history.

function rupees(paise: unknown): string {
  if (typeof paise !== 'number') return '-';
  const r = paise / 100;
  return `₹${Number.isInteger(r) ? r : r.toFixed(2)}`;
}

/// Razorpay entities use epoch SECONDS; our own records use ISO strings.
function fmtWhen(value: unknown): string {
  let dt: Date | null = null;
  if (typeof value === 'number' && value > 0) dt = new Date(value * 1000);
  else if (typeof value === 'string' && value.length > 0) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) dt = parsed;
  }
  return dt ? fmtDayMonthYearClock(dt) : '-';
}

function copy(label: string, value: string) {
  void navigator.clipboard.writeText(value);
  toast(`${label} copied.`);
}

function MethodIcon({ method }: { method: string }) {
  const cls = 'size-4 text-slate-700 dark:text-slate-300';
  switch (method.toLowerCase()) {
    case 'card':
      return <CreditCard className={cls} />;
    case 'upi':
      return <QrCode className={cls} />;
    case 'netbanking':
      return <Building2 className={cls} />;
    case 'wallet':
      return <Wallet className={cls} />;
    case 'emandate':
      return <RefreshCw className={cls} />;
    default:
      return <Banknote className={cls} />;
  }
}

function SectionCard({
  title,
  trailing,
  children,
}: {
  title: string;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="mb-3.5 p-3.5">
      <div className="flex items-center gap-2">
        <h2 className="min-w-0 flex-1 text-[15px] font-bold">{title}</h2>
        {trailing}
      </div>
      <div className="mt-2">{children}</div>
    </Card>
  );
}

function KV({
  k,
  v,
  copyValue,
  valueClass,
}: {
  k: string;
  v: string;
  copyValue?: string;
  valueClass?: string;
}) {
  return (
    <div className="flex items-start gap-3 py-0.5">
      <span className="w-[110px] shrink-0 text-xs text-muted-foreground">{k}</span>
      {copyValue ? (
        <button
          type="button"
          onClick={() => copy(k, copyValue)}
          className={cn(
            'min-w-0 flex-1 break-all text-left text-[12.5px] font-medium underline decoration-dotted underline-offset-2',
            valueClass,
          )}
        >
          {v}
        </button>
      ) : (
        <span className={cn('min-w-0 flex-1 break-all text-[12.5px] font-medium', valueClass)}>{v}</span>
      )}
    </div>
  );
}

type EventMeta = { label: string; icon: React.ReactNode; className: string };

function historyEventMeta(event: string): EventMeta {
  const size = 'size-4';
  switch (event) {
    case 'purchased':
      return { label: 'Purchased', icon: <ShieldCheck className={size} />, className: 'text-emerald-700' };
    case 'plan_queued':
      return { label: 'Plan queued', icon: <Clock className={size} />, className: 'text-orange-700' };
    case 'plan_started':
      return { label: 'Queued plan started', icon: <PlayCircle className={size} />, className: 'text-emerald-700' };
    case 'renewed':
      return { label: 'Renewed', icon: <RefreshCw className={size} />, className: 'text-blue-700' };
    case 'cancelled':
      return { label: 'Cancelled', icon: <CircleSlash className={size} />, className: 'text-orange-800' };
    case 'switch_aborted':
      return { label: 'Switch cancelled', icon: <RotateCcw className={size} />, className: 'text-slate-500' };
    case 'expired':
      return { label: 'Access ended', icon: <TimerOff className={size} />, className: 'text-slate-600' };
    case 'refunded':
      return { label: 'Refunded', icon: <IndianRupee className={size} />, className: 'text-red-700' };
    case 'voucher_granted':
      return { label: 'Voucher granted', icon: <Gift className={size} />, className: 'text-primary' };
    case 'admin_granted':
      return { label: 'Admin granted', icon: <ShieldCheck className={size} />, className: 'text-primary' };
    case 'transferred':
      return { label: 'Transferred', icon: <SwitchCamera className={size} />, className: 'text-violet-700' };
    default:
      return {
        label: event.length === 0 ? 'Event' : event,
        icon: <CircleDashed className={size} />,
        className: 'text-slate-600',
      };
  }
}

function RefundDialog({
  payment,
  uid,
  onClose,
  onDone,
}: {
  payment: Json;
  uid: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const paymentId = String(payment.id ?? '');
  const amount = typeof payment.amount === 'number' ? payment.amount : 0;
  const alreadyRefunded =
    typeof payment.amount_refunded === 'number' ? payment.amount_refunded : 0;
  const refundable = amount - alreadyRefunded;

  const [full, setFull] = useState(true);
  const [amountText, setAmountText] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    let amountPaise: number | undefined;
    if (!full) {
      const parsed = Number(amountText.trim());
      if (!Number.isFinite(parsed) || parsed <= 0) {
        toast.error('Enter a valid refund amount.');
        return;
      }
      amountPaise = Math.round(parsed * 100);
    }

    setBusy(true);
    let message: string;
    try {
      await adminApi.refundPayment({
        uid,
        paymentId,
        amountPaise,
        reason: reason.trim() || undefined,
      });
      message = 'Refund issued.';
    } catch (e) {
      message = e instanceof ApiException ? e.message : 'Something went wrong. Please try again.';
    }
    // Always re-pull — shows the updated refund status either way.
    onDone();
    setBusy(false);
    toast(message);
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Issue Refund</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <p className="text-xs text-muted-foreground">Payment {paymentId}</p>
          <p className="text-[13px] font-semibold">Refundable: {rupees(refundable)}</p>

          <div className="mt-3 flex gap-2">
            {[
              [true, 'Full'],
              [false, 'Partial'],
            ].map(([value, label]) => (
              <button
                key={String(label)}
                type="button"
                onClick={() => setFull(value as boolean)}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-xs transition-colors',
                  full === value
                    ? 'border-primary bg-primary/10 font-semibold text-primary'
                    : 'border-input bg-card text-muted-foreground hover:bg-secondary',
                )}
              >
                {label as string}
              </button>
            ))}
          </div>

          {!full && (
            <div className="mt-3">
              <Label htmlFor="refund-amount">Amount in ₹</Label>
              <Input
                id="refund-amount"
                type="number"
                className="mt-1.5"
                value={amountText}
                onChange={(e) => setAmountText(e.target.value)}
              />
            </div>
          )}

          <div className="mt-3">
            <Label htmlFor="refund-reason">Reason (optional)</Label>
            <Input
              id="refund-reason"
              className="mt-1.5"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={busy} onClick={() => void submit()}>
            {busy && <Loader2 className="animate-spin" />} Refund
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function UserBillingPage() {
  const { uid = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();

  const nav = (location.state ?? {}) as { username?: string; email?: string };
  const username = nav.username ?? 'Member';
  const email = nav.email ?? uid;

  const [timelineFilter, setTimelineFilter] = useState<'All' | 'Razorpay' | 'Actions'>('All');
  const [refunding, setRefunding] = useState<Json | null>(null);

  const { data, isLoading, error, refetch } = useQuery<Json>({
    queryKey: ['payment-history', uid],
    queryFn: () => adminApi.paymentHistory(uid),
    enabled: uid.length > 0,
  });

  const fs = (data?.firestore ?? {}) as Json;
  const rzp = data?.razorpay as Json | undefined;
  const sub = rzp?.subscription as Json | undefined;
  const payments = (rzp?.payments as Json[]) ?? [];
  const historyRows = (data?.history as Json[]) ?? [];

  const timelineEntries = useMemo(() => {
    const webhookEvents = (data?.webhookEvents as Json[]) ?? [];
    const auditLog = (data?.auditLog as Json[]) ?? [];

    // Merge both sources into one chronological "what happened" feed.
    const entries: { kind: string; title: string; sub: string; at: string; failed: boolean }[] = [];

    if (timelineFilter !== 'Actions') {
      for (const m of webhookEvents) {
        entries.push({
          kind: 'webhook',
          title: String(m.eventType ?? 'unknown'),
          sub: `webhook - ${String(m.status ?? '')}`,
          at: String(m.receivedAt ?? ''),
          failed: m.status === 'failed',
        });
      }
    }
    if (timelineFilter !== 'Razorpay') {
      for (const m of auditLog) {
        const details = (m.details ?? {}) as Json;
        const mode = String(details.mode ?? details.tier ?? details.amount ?? '');
        entries.push({
          kind: 'action',
          title: String(m.action ?? 'action'),
          sub: `by ${m.actorUid === uid ? 'user' : 'admin'}${mode ? ` - ${mode}` : ''}`,
          at: String(m.at ?? ''),
          failed: false,
        });
      }
    }

    entries.sort((a, b) => b.at.localeCompare(a.at));
    return entries;
  }, [data, timelineFilter, uid]);

  const tier = String(fs.subscriptionTier ?? '-');

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border bg-card px-4">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ChevronLeft />
        </Button>
        <div className="min-w-0">
          <p className="truncate text-base font-bold">{username}</p>
          <p className="truncate text-[11px] text-muted-foreground">{email}</p>
        </div>
        <div className="flex-1" />
        <Button variant="ghost" size="icon" title="Copy uid" onClick={() => copy('uid', uid)}>
          <Copy className="size-[18px]" />
        </Button>
        <Button variant="ghost" size="icon" title="Reload" onClick={() => void refetch()}>
          <RefreshCw className="size-[18px]" />
        </Button>
      </header>

      {isLoading && <LoadingState />}

      {error && (
        <div className="flex flex-col items-center gap-3 p-10 text-center">
          <p className="text-sm text-slate-700 dark:text-slate-300">
            {error instanceof ApiException ? error.message : 'Something went wrong. Please try again.'}
          </p>
          <Button onClick={() => void refetch()}>Retry</Button>
        </div>
      )}

      {data && (
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-4">
          <SectionCard title="Current State (our database)">
            <KV
              k="Tier"
              v={tier}
              valueClass={
                tier === 'Premium' ? 'text-primary' : tier === 'Basic' ? 'text-teal-600' : undefined
              }
            />
            <KV k="Status" v={String(fs.subscriptionStatus ?? '-')} />
            <KV k="Plan" v={String(fs.subscriptionPlan ?? '-')} />
            <KV k="Provider" v={String(fs.paymentProvider ?? '-')} />
            <KV k="Paid via" v={String(fs.lastPaymentMethod ?? '-').toUpperCase()} />
            <KV k="Access until" v={fmtWhen(fs.subscriptionEndDate)} />
            <KV k="Trial started" v={fmtWhen(fs.trialStartDate)} />
            {fs.hasUpcomingPlan === true && (
              <KV
                k="Upcoming plan"
                v={`${String(fs.upcomingPlan ?? '-')} (${String(fs.upcomingPlanTier ?? '-')})`}
              />
            )}
            {fs.razorpaySubscriptionId ? (
              <KV
                k="Subscription"
                v={String(fs.razorpaySubscriptionId)}
                copyValue={String(fs.razorpaySubscriptionId)}
              />
            ) : null}
          </SectionCard>

          {/* The subscription timeline, in our own vocabulary. Distinct from the
              raw webhook/audit feed lower down: this answers "what happened to
              this person's subscription and when" in one read. Entries only
              exist from the day the history feature shipped — nothing was
              backfilled, so an empty card on an old account is expected. */}
          <SectionCard
            title="Subscription timeline"
            trailing={
              historyRows.length > 0 ? (
                <span className="text-xs text-muted-foreground">{historyRows.length}</span>
              ) : undefined
            }
          >
            {historyRows.length === 0 ? (
              <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                No entries yet. History is recorded from the day this feature shipped — earlier
                activity is only in the raw event feed below.
              </p>
            ) : (
              historyRows.map((row, i) => {
                const meta = historyEventMeta(String(row.event ?? ''));
                const plan = String(row.planKey ?? '');
                const amount = row.amountPaise;
                return (
                  <div key={i} className="flex items-start gap-2.5 py-1.5">
                    <span className={cn('mt-0.5 shrink-0', meta.className)}>{meta.icon}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={cn('text-[13px] font-semibold', meta.className)}>
                          {meta.label}
                        </span>
                        {plan && (
                          <span className="text-xs text-slate-700 dark:text-slate-400">{plan}</span>
                        )}
                        {typeof amount === 'number' && (
                          <span className="tabular text-xs text-slate-700 dark:text-slate-400">
                            {rupees(amount)}
                          </span>
                        )}
                      </div>
                      {row.note ? (
                        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                          {String(row.note)}
                        </p>
                      ) : null}
                      {row.startsAt != null && (
                        <p className="mt-0.5 text-[11.5px] font-medium text-orange-700 dark:text-orange-400">
                          Starts {fmtWhen(row.startsAt)}
                        </p>
                      )}
                    </div>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {fmtWhen(row.at)}
                    </span>
                  </div>
                );
              })
            )}
          </SectionCard>

          <SectionCard title={sub ? 'Razorpay Subscription (live)' : 'Razorpay (live)'}>
            {sub ? (
              <>
                <KV k="Id" v={String(sub.id ?? '-')} copyValue={String(sub.id ?? '')} />
                <KV
                  k="Status"
                  v={String(sub.status ?? '-')}
                  valueClass={
                    sub.status === 'active'
                      ? 'text-emerald-600'
                      : sub.status === 'cancelled'
                        ? 'text-red-600'
                        : undefined
                  }
                />
                <KV k="Cycle" v={`${String(sub.paid_count ?? 0)} of ${String(sub.total_count ?? '-')} paid`} />
                <KV k="Current cycle ends" v={fmtWhen(sub.current_end)} />
                <KV k="First charge at" v={fmtWhen(sub.start_at)} />
                {sub.ended_at != null && <KV k="Ended at" v={fmtWhen(sub.ended_at)} />}
              </>
            ) : (
              <p className="text-[12.5px] text-muted-foreground">
                No live Razorpay data (Apple/admin provider, or no subscription).
              </p>
            )}
          </SectionCard>

          <SectionCard
            title="Payments & Refunds (live from Razorpay)"
            trailing={<span className="text-xs text-muted-foreground">{payments.length}</span>}
          >
            {payments.length === 0 ? (
              <p className="text-[12.5px] text-muted-foreground">
                No payments found for this subscription.
              </p>
            ) : (
              payments.map((p, i) => {
                const id = String(p.id ?? '-');
                const method = String(p.method ?? '');
                const status = String(p.status ?? '-');
                const amount = typeof p.amount === 'number' ? p.amount : 0;
                const refunded = typeof p.amount_refunded === 'number' ? p.amount_refunded : 0;
                const refundStatus = String(p.refund_status ?? '');

                // The refund answer, at a glance.
                let refundLabel: string;
                let refundClass: string;
                if (refunded >= amount && amount > 0) {
                  refundLabel = `REFUNDED ${rupees(refunded)}`;
                  refundClass = 'text-emerald-600 bg-emerald-500/12';
                } else if (refunded > 0) {
                  refundLabel = `PARTIAL ${rupees(refunded)} of ${rupees(amount)}`;
                  refundClass = 'text-orange-600 bg-orange-500/12';
                } else if (status === 'captured') {
                  refundLabel = 'NO REFUND';
                  refundClass = 'text-slate-500 bg-slate-500/12';
                } else {
                  refundLabel = status.toUpperCase(); // authorized / failed / created
                  refundClass =
                    status === 'failed'
                      ? 'text-red-600 bg-red-500/12'
                      : 'text-slate-500 bg-slate-500/12';
                }

                const canRefund = status === 'captured' && refunded < amount;

                return (
                  <div key={i} className="mb-2 rounded-[10px] border border-border bg-muted/40 p-2.5">
                    <div className="flex items-center gap-1.5">
                      <MethodIcon method={method} />
                      <span className="tabular text-sm font-bold">{rupees(amount)}</span>
                      {method && (
                        <span className="text-[11px] text-muted-foreground">
                          {method.toUpperCase()}
                        </span>
                      )}
                      <span
                        className={cn(
                          'ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold',
                          refundClass,
                        )}
                      >
                        {refundLabel}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => copy('Payment id', id)}
                      className="mt-1 block break-all text-left text-[11px] text-muted-foreground"
                    >
                      {id} - {fmtWhen(p.created_at)}
                      {refundStatus ? ` - refund: ${refundStatus}` : ''}
                    </button>

                    {canRefund && (
                      <div className="flex justify-end">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-600 hover:text-red-700"
                          onClick={() => setRefunding(p)}
                        >
                          Refund...
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </SectionCard>

          <SectionCard
            title="Timeline"
            trailing={
              <div className="flex gap-1">
                {(['All', 'Razorpay', 'Actions'] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setTimelineFilter(f)}
                    className={cn(
                      'rounded-full px-2 py-0.5 text-[10px] transition-colors',
                      timelineFilter === f
                        ? 'bg-foreground text-background'
                        : 'bg-secondary text-slate-700 dark:text-slate-300',
                    )}
                  >
                    {f}
                  </button>
                ))}
              </div>
            }
          >
            {timelineEntries.length === 0 ? (
              <p className="text-[12.5px] text-muted-foreground">Nothing recorded yet.</p>
            ) : (
              timelineEntries.slice(0, 50).map((e, i) => {
                const isWebhook = e.kind === 'webhook';
                return (
                  <div key={i} className="flex items-start gap-2 py-1.5">
                    <span className="mt-0.5 shrink-0 [&_svg]:size-[15px]">
                      {e.failed ? (
                        <AlertCircle className="text-red-600" />
                      ) : isWebhook ? (
                        <Bolt className="text-violet-600" />
                      ) : (
                        <User className="text-slate-500" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          'text-[12.5px] font-semibold',
                          e.failed ? 'text-red-600' : undefined,
                        )}
                      >
                        {e.title}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {e.sub} - {fmtWhen(e.at)}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </SectionCard>
        </div>
      )}

      {refunding && (
        <RefundDialog
          payment={refunding}
          uid={uid}
          onClose={() => setRefunding(null)}
          onDone={() => void qc.refetchQueries({ queryKey: ['payment-history', uid] })}
        />
      )}
    </div>
  );
}
