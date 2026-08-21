import { useQuery } from '@tanstack/react-query';
import { getDashboardOverview } from '@/services/dashboard-service';
import type { DashboardOverview, DashboardQuery } from '@/types/dashboard';

/// Held briefly rather than always-stale.
///
/// `staleTime: 0` meant every arrival on the Dashboard re-ran a full Firestore
/// scan server-side — so bouncing to Users and back, or clicking a row and
/// pressing Back, paid the whole scan again for numbers that had not moved.
/// Half a minute is short enough that nobody reads a stale figure and long
/// enough that navigating around the panel is instant.
///
/// Changing any filter still fetches immediately: the filters are part of the
/// query key, so a new combination has no cached entry to serve. Window-focus
/// refetch stays off for the same reason as the conversion report — a
/// full-collection scan is not cheap enough to fire every time the admin
/// alt-tabs back.

/// Dates are keyed as plain `YYYY-MM-DD`, not as Date objects: two Dates for the
/// same day are different values, and keying on them would refetch on every
/// render.
const dayKey = (d: Date | null) =>
  d == null
    ? null
    : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const dashboardOverviewKey = (q: DashboardQuery) =>
  ['dashboard', q.cohort, q.platform, dayKey(q.from), dayKey(q.to)] as const;

export function useDashboardOverview(query: DashboardQuery) {
  return useQuery<DashboardOverview>({
    queryKey: dashboardOverviewKey(query),
    queryFn: () => getDashboardOverview(query),
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
    // Changing a filter refetches, but the previous numbers stay on screen
    // meanwhile instead of collapsing the page back to a spinner.
    placeholderData: (prev) => prev,
  });
}
