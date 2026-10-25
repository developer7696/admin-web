import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { fetchAllUsers } from '@/services/admin-user-service';
import { HeaderSlot } from '@/app/header-slot';
import { SearchInput } from '@/components/common/search-input';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { PageBar } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { Json } from '@/lib/api-client';
import { toDate } from '@/lib/format';
import { cn } from '@/lib/utils';

/// Admin billing tab: search every payment-relevant user and open their full
/// billing history.
///
/// Rows come from the admin API's unpaginated user read (`fetchAllUsers` →
/// `GET /api/admin/users/export`), the only listing that carries the entitlement
/// columns this page renders. It replaced an `onSnapshot` on the whole `users`
/// collection: the backend writes only Postgres now, so that listener was
/// showing a snapshot frozen at migration time and no amount of waiting moved
/// it. There is no server push behind an HTTP GET — the list loads on mount and
/// on Refresh.
///
/// The whole population is fetched rather than a page because both of this
/// page's features span it: search matches the plan key, the provider and the
/// Razorpay subscription id (the endpoint's own `search` covers email and
/// username only), and the status breakdown counts every matching row. Search
/// therefore still runs in the browser, exactly as it did.
///
/// THREE FIELDS THE FIRESTORE DOCUMENT HAD AND THIS LISTING DOES NOT
///
///  - `lastPaymentMethod` — the CARD/UPI chip, now gone from the row.
///  - `lastPaymentId` — so a `pay_…` can no longer be pasted into the search.
///  - `upcomingPlan` / `pendingPlanKey` — the plan label's two fallbacks, so a
///    user mid-checkout or with a queued switch and no current plan reads as
///    `-`.
///
/// All of them live on `GET /api/admin/users/{uid}/subscription`, one user at a
/// time, which is the billing detail page this list opens — they are a click
/// away rather than approximated here. Restoring them to the list needs those
/// columns added to the user listing's projection.
///
/// `role` is not returned either, so admin accounts are no longer filtered out;
/// one holding a comp grant now appears in the list like any other account.

const isTrue = (value: unknown) => value === true;

const hasTier = (data: Json) =>
  isTrue(data.isPremium) ||
  isTrue(data.isBasic) ||
  data.subscriptionTier === 'Premium' ||
  data.subscriptionTier === 'Basic';

const inTrialWindow = (data: Json) => {
  const start = toDate(data.trialStartDate);
  if (start == null) return false;
  return Date.now() < start.getTime() + 7 * 86_400_000;
};

/// Payment status for display/filtering. Prefers the backend's
/// `subscriptionStatus`; falls back to legacy field maths for old accounts.
function statusOf(data: Json): string {
  const s = data.subscriptionStatus;
  if (typeof s === 'string' && s.length > 0) {
    switch (s) {
      case 'active':
        return inTrialWindow(data) && !hasTier(data) ? 'Trial' : 'Active';
      case 'pending':
        return 'Checkout pending';
      case 'cancelling':
        return 'Cancelling';
      case 'cancelled':
        return 'Cancelled';
      case 'halted':
      case 'paused':
        return 'Halted';
      case 'expired':
        return 'Expired';
    }
  }
  // Legacy accounts (no backend status).
  const subEnd = toDate(data.subscriptionEndDate);
  const subActive = subEnd != null && Date.now() < subEnd.getTime();
  if (hasTier(data) && subActive) return 'Active';
  if (inTrialWindow(data)) return 'Trial';
  if (data.trialStartDate != null || subEnd != null) return 'Expired';
  return 'None';
}

function planLabel(data: Json): string {
  const plan = String(data.subscriptionPlan ?? '');
  switch (plan) {
    case 'premium_monthly':
      return 'Pro 1 Month';
    case 'premium_quarterly':
      return 'Pro 3 Months';
    case 'premium_annual':
      return 'Pro 12 Months';
    case 'basic_monthly':
      return 'Basic 1 Month (legacy)';
    case 'basic_quarterly':
      return 'Basic 3 Months (legacy)';
    default:
      if (plan.startsWith('admin_')) return 'Admin grant';
      return plan.length === 0 ? '-' : plan;
  }
}

/// Only rows that have ever touched payments/trial — keeps the noise out.
///
/// Unchanged from the Firestore version: every field it reads is in the API row.
/// The emptiness guard that stood beside it is gone — the endpoint returns a
/// fixed key set with nulls, so there is no such thing as an empty row, and a
/// never-subscribed account fails this test anyway.
const isPaymentRelevant = (data: Json) =>
  data.paymentProvider != null ||
  data.razorpaySubscriptionId != null ||
  data.trialStartDate != null ||
  isTrue(data.hasUsedTrial) ||
  hasTier(data);

function statusTint(status: string): string {
  switch (status) {
    case 'Active':
      return 'text-emerald-600 bg-emerald-500/12';
    case 'Trial':
      return 'text-orange-600 bg-orange-500/12';
    case 'Cancelling':
    case 'Cancelled':
      return 'text-red-600 bg-red-500/12';
    case 'Checkout pending':
      return 'text-slate-600 bg-slate-500/12';
    default:
      return 'text-slate-500 bg-slate-500/12';
  }
}

type PaymentRow = {
  uid: string;
  username: string;
  email: string;
  status: string;
  plan: string;
  provider: string;
  endDate: Date | null;
  updatedAt: Date | null;
  /// Everything free-text search may match, lowercased once at parse time
  /// rather than rebuilt on every keystroke.
  haystack: string;
};

function paymentRowFrom(data: Json): PaymentRow {
  const uid = String(data.uid ?? '');
  const email = String(data.email ?? 'No email');
  let username = String(data.username ?? '');
  if (username.length === 0 || username === 'User') {
    username = email.includes('@') ? email.split('@')[0] : 'User';
  }

  return {
    uid,
    username,
    email,
    status: statusOf(data),
    plan: planLabel(data),
    provider: String(data.paymentProvider ?? '-'),
    endDate: toDate(data.subscriptionEndDate),
    updatedAt: toDate(data.updatedAt),
    /// Everything an admin might paste in: email, username, uid, Razorpay
    /// subscription id, plan key, provider.
    haystack: [
      uid,
      data.email ?? '',
      data.username ?? '',
      data.razorpaySubscriptionId ?? '',
      data.subscriptionPlan ?? '',
      data.paymentProvider ?? '',
    ]
      .join(' ')
      .toLowerCase(),
  };
}

export function PaymentsPage() {
  const [query, setQuery] = useState('');

  const navigate = useNavigate();
  const usersQ = useQuery({
    queryKey: ['payments-users'],
    queryFn: () => fetchAllUsers(),
    // Every visit re-reads: this pane is opened to answer "what is this
    // account's billing state right now", and a cached answer is the wrong one.
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  const all = useMemo(() => {
    const out = (usersQ.data?.rows ?? []).filter(isPaymentRelevant).map(paymentRowFrom);

    // Most recently touched first (payment activity bubbles up).
    out.sort((a, b) => {
      const ta = a.updatedAt;
      const tb = b.updatedAt;
      if (ta && tb) return tb.getTime() - ta.getTime();
      if (tb) return 1;
      if (ta) return -1;
      return 0;
    });

    return out;
  }, [usersQ.data]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q.length === 0 ? all : all.filter((row) => row.haystack.includes(q));
  }, [all, query]);

  const breakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
    return ['Active', 'Trial', 'Cancelling', 'Cancelled', 'Halted']
      .filter((s) => (counts[s] ?? 0) > 0)
      .map((s) => `${s} ${counts[s]}`)
      .join(' | ');
  }, [rows]);

  return (
    <div className="flex h-full flex-col">
      <HeaderSlot>
        <SearchInput
          value={query}
          onChange={setQuery}
          variant="header"
          placeholder="Search email, username, uid, sub_…, plan"
          className="w-full max-w-md"
        />
      </HeaderSlot>

      {/* This pane had no title at all — only a status line — so it was the one
          place the sidebar selection was the sole indication of where you were. */}
      <PageBar
        title="Payments"
        status={
          usersQ.isLoading
            ? 'Loading…'
            : breakdown.length === 0
              ? `${rows.length} users`
              : `${rows.length} users · ${breakdown}`
        }
        statusTitle="Only accounts that have ever touched payments or a trial are listed."
        className="shrink-0 px-4 pb-2.5 pt-4"
      >
        {/* The list no longer updates itself, so without this there is no way to
            re-read it short of leaving the pane and coming back. */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => void usersQ.refetch()}
          disabled={usersQ.isFetching}
        >
          <RefreshCw className={cn(usersQ.isFetching && 'animate-spin')} />
          Refresh
        </Button>
      </PageBar>

      {usersQ.isLoading && <LoadingState />}
      {usersQ.isError && (
        <ErrorState error={usersQ.error} onRetry={() => void usersQ.refetch()} />
      )}

      {!usersQ.isLoading && !usersQ.isError && (
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          {/* The cap cutting the read short would hide accounts silently, and
              this list is used to establish that an account has NOT paid. */}
          {usersQ.data?.truncated === true && (
            <Card className="mb-2.5 border-orange-500/30 bg-orange-500/10 p-3">
              <p className="text-xs font-semibold text-orange-600">
                This list hit the server's row cap, so it is missing accounts. Narrow it with a
                search before concluding an account is absent.
              </p>
            </Card>
          )}

          {rows.length === 0 ? (
            <EmptyState title="No matching users." />
          ) : (
            rows.map((row) => {
              const end = row.endDate;
              return (
                <button
                  key={row.uid}
                  type="button"
                  onClick={() =>
                    navigate(`/users/${row.uid}/billing`, {
                      state: { username: row.username, email: row.email },
                    })
                  }
                  className="mb-2.5 block w-full text-left"
                >
                  <Card className="p-3.5 transition-colors hover:bg-muted/50">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[15px] font-bold">
                        {row.username}
                      </span>
                      <span
                        className={cn(
                          'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold',
                          statusTint(row.status),
                        )}
                      >
                        {row.status}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">{row.email}</p>
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                      <span className="font-medium text-slate-800 dark:text-slate-300">
                        {row.plan}
                      </span>
                      <span className="text-muted-foreground">via {row.provider}</span>
                      {end && (
                        <span className="text-muted-foreground">
                          ends {end.getDate()}/{end.getMonth() + 1}/{end.getFullYear()}
                        </span>
                      )}
                    </div>
                  </Card>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
