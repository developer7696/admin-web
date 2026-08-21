import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Timestamp, type DocumentData } from 'firebase/firestore';
import { useRawUsersStream } from '@/hooks/use-admin-users';
import { isAdminUserData } from '@/auth/admin-auth';
import { HeaderSlot } from '@/app/header-slot';
import { SearchInput } from '@/components/common/search-input';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { PageBar } from '@/components/common/page-header';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/// Admin billing tab: search every payment-relevant user and open their full
/// billing history. Data comes straight from the `users` collection (same
/// pattern as the other admin pages); the detail page pulls live Razorpay data
/// through the backend.
///
/// Search is the only filter — it lives in the top navbar via `HeaderSlot`, so
/// this page renders as a bare result list.

const hasTier = (data: DocumentData) =>
  data.isPremium === true ||
  data.isBasic === true ||
  data.subscriptionTier === 'Premium' ||
  data.subscriptionTier === 'Basic';

const inTrialWindow = (data: DocumentData) => {
  const start = data.trialStartDate as Timestamp | undefined;
  if (start == null) return false;
  return Date.now() < start.toDate().getTime() + 7 * 86_400_000;
};

/// Payment status for display/filtering. Prefers the backend's
/// `subscriptionStatus`; falls back to legacy field maths for old accounts.
function statusOf(data: DocumentData): string {
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
  const subEnd = data.subscriptionEndDate as Timestamp | undefined;
  const subActive = subEnd != null && Date.now() < subEnd.toDate().getTime();
  if (hasTier(data) && subActive) return 'Active';
  if (inTrialWindow(data)) return 'Trial';
  if (data.trialStartDate != null || subEnd != null) return 'Expired';
  return 'None';
}

function planLabel(data: DocumentData): string {
  const plan = String(data.subscriptionPlan ?? data.upcomingPlan ?? data.pendingPlanKey ?? '');
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
const isPaymentRelevant = (data: DocumentData) =>
  data.paymentProvider != null ||
  data.razorpaySubscriptionId != null ||
  data.trialStartDate != null ||
  data.hasUsedTrial === true ||
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

export function PaymentsPage() {
  const [query, setQuery] = useState('');

  const navigate = useNavigate();
  const { data: users, loading, error } = useRawUsersStream();

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();

    /// Free-text search across everything an admin might paste in: email,
    /// username, uid, Razorpay subscription id, payment id, plan key, method.
    const matchesQuery = (uid: string, data: DocumentData) => {
      if (!q) return true;
      return [
        uid,
        data.email ?? '',
        data.username ?? '',
        data.name ?? '',
        data.razorpaySubscriptionId ?? '',
        data.lastPaymentId ?? '',
        data.subscriptionPlan ?? '',
        data.upcomingPlan ?? '',
        data.lastPaymentMethod ?? '',
        data.paymentProvider ?? '',
      ]
        .join(' ')
        .toLowerCase()
        .includes(q);
    };

    const out = users
      .filter(({ uid, data }) => {
        if (Object.keys(data).length === 0 || isAdminUserData(data)) return false;
        if (!isPaymentRelevant(data)) return false;
        return matchesQuery(uid, data);
      })
      .map(({ uid, data }) => {
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
          method: String(data.lastPaymentMethod ?? ''),
          endDate: data.subscriptionEndDate as Timestamp | undefined,
          updatedAt: data.updatedAt as Timestamp | undefined,
        };
      });

    // Most recently touched first (payment activity bubbles up).
    out.sort((a, b) => {
      const ta = a.updatedAt;
      const tb = b.updatedAt;
      if (ta && tb) return tb.toMillis() - ta.toMillis();
      if (tb) return 1;
      if (ta) return -1;
      return 0;
    });

    return out;
  }, [users, query]);

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
          placeholder="Search email, username, uid, sub_…, pay_…, plan"
          className="w-full max-w-md"
        />
      </HeaderSlot>

      {/* This pane had no title at all — only a status line — so it was the one
          place the sidebar selection was the sole indication of where you were. */}
      <PageBar
        title="Payments"
        status={
          loading
            ? 'Loading…'
            : breakdown.length === 0
              ? `${rows.length} users`
              : `${rows.length} users · ${breakdown}`
        }
        statusTitle="Only accounts that have ever touched payments or a trial are listed."
        className="shrink-0 px-4 pb-2.5 pt-4"
      />

      {loading && <LoadingState />}
      {error && <ErrorState error="Could not load users." />}

      {!loading && !error && (
        <>
          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-4 pb-4">
            {rows.length === 0 ? (
              <EmptyState title="No matching users." />
            ) : (
              rows.map((row) => {
                const end = row.endDate?.toDate();
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
                        {row.method && (
                          <span className="text-muted-foreground">{row.method.toUpperCase()}</span>
                        )}
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
        </>
      )}
    </div>
  );
}
