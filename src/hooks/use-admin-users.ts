import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  keepPreviousData,
  useInfiniteQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  DELETIONS_PAGE_SIZE,
  fetchDeletionRecordsPage,
  fetchUsersPage,
  filterDeletionRecords,
  filterUsers,
  USERS_PAGE_SIZE,
  type DeletionRow,
  type PlatformFilter,
  type UserRow,
} from '@/services/admin-user-service';

/// Data for the Users pane.
///
/// NEITHER LIST IS LIVE ANY MORE. Both were Firestore `onSnapshot` listeners —
/// one on the whole `users` collection, one fanned out across four historical
/// spellings of the deletion-reasons collection. They are now `GET
/// /api/admin/users` and `GET /api/admin/deletion-records`, paged, through React
/// Query. There is no server push to replace a snapshot listener, so a grant or
/// a deletion no longer moves a list by itself: every mutation the page performs
/// refetches afterwards (`useRefreshUsers`, or the list's own `refetch`). That is
/// an explicit reload rather than a pretence of being live.
///
/// Neither endpoint filters beyond `search` on the user table. Platform, joined
/// date, the Ghosts view and the exits date window are applied to the rows in
/// hand, which means they scope what has been LOADED, not the whole table — the
/// page says so next to the count, and `hasMore`/`loadMore` are how the rest is
/// brought in.
///
/// There is no separate stats query here. It was a second full read of the same
/// collection plus an `audit_logs` query, re-run on every platform change, for
/// four counts the loaded rows produce for free.

const USERS_KEY = 'admin-users';
const DELETIONS_KEY = 'admin-deletion-records';

/// Debounced so typing in the search box is one request per pause rather than
/// one per keystroke — the term is part of the query key, and the server
/// resolves a substring search as a table scan.
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/// A paged list, as the page consumes it.
///
/// One shape for both lists so the "Load more" control and the count line can
/// drive either without knowing which is on screen.
export type PagedQuery<T> = {
  /// Rows that passed the client-side filters, from the pages loaded so far.
  data: T[];
  /// Rows loaded, before those filters — the denominator the count line needs.
  loaded: number;
  /// Rows the server has, whether loaded or not.
  total: number;
  loading: boolean;
  error: Error | null;
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => void;
  refetch: () => void;
};

/// The parts of a `useInfiniteQuery` result the shape below needs. Named so the
/// assembly can be shared without either hook depending on the other.
type InfiniteState = {
  isPending: boolean;
  error: Error | null;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => unknown;
  refetch: () => unknown;
};

function pagedShape<T>(
  query: InfiniteState,
  args: { data: T[]; loaded: number; total: number },
): PagedQuery<T> {
  return {
    ...args,
    loading: query.isPending,
    error: query.error,
    hasMore: query.hasNextPage,
    loadingMore: query.isFetchingNextPage,
    loadMore: () => void query.fetchNextPage(),
    refetch: () => void query.refetch(),
  };
}

export function useUsers(filters: {
  platformFilter: PlatformFilter;
  /// Server-side, matching username and email. Previously a client-side
  /// username-only match over the streamed rows.
  search?: string;
  /// Returns ONLY identity-less rows: accounts a push token or a webhook created
  /// before anyone signed up properly.
  ghosts: boolean;
  startDate?: Date | null;
  endDate?: Date | null;
}): PagedQuery<UserRow> {
  const search = useDebounced(filters.search?.trim() ?? '', 350);

  const query = useInfiniteQuery({
    queryKey: [USERS_KEY, 'page', search],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      fetchUsersPage({ search, offset: pageParam, limit: USERS_PAGE_SIZE }),
    getNextPageParam: (last) => (last.hasMore ? last.offset + last.users.length : undefined),
    // A new search term keeps the previous rows on screen while the new ones
    // arrive, so the list does not blink through an empty loading state on every
    // pause in typing.
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  const pages = query.data?.pages ?? [];
  const loaded = useMemo(() => pages.flatMap((p) => p.users), [pages]);

  // Dates are keyed by value, not identity — a new Date object with the same
  // instant must not re-run the filter and hand the page a new array.
  const startKey = filters.startDate?.getTime() ?? null;
  const endKey = filters.endDate?.getTime() ?? null;

  const data = useMemo(
    () =>
      filterUsers(loaded, {
        platformFilter: filters.platformFilter,
        ghosts: filters.ghosts,
        startDate: startKey != null ? new Date(startKey) : null,
        endDate: endKey != null ? new Date(endKey) : null,
      }),
    [loaded, filters.platformFilter, filters.ghosts, startKey, endKey],
  );

  return pagedShape(query, {
    data,
    loaded: loaded.length,
    total: pages.at(-1)?.total ?? loaded.length,
  });
}

/// Refetch the user list after a mutation.
///
/// This is what replaces the snapshot listener: nothing pushes a grant or a
/// deletion to the browser, so the page asks again once its own write has
/// returned. Invalidating the whole key covers the paged list and the
/// whole-population read together, which is the point — they are two views of
/// one table and must not disagree.
export function useRefreshUsers(): () => void {
  const qc = useQueryClient();
  return useCallback(() => {
    void qc.invalidateQueries({ queryKey: [USERS_KEY] });
  }, [qc]);
}

/// Exit feedback, newest first, paged.
///
/// Was four `onSnapshot` listeners merged in the browser; the migration folded
/// those collections into one table, so this is one paged read. Deleting a
/// record calls `refetch` on the way back — the same explicit pattern the user
/// list uses, since nothing pushes the removal here either.
export function useDeletionRecords(range: {
  startDate?: Date | null;
  endDate?: Date | null;
}): PagedQuery<DeletionRow> {
  const query = useInfiniteQuery({
    queryKey: [DELETIONS_KEY],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      fetchDeletionRecordsPage({ offset: pageParam, limit: DELETIONS_PAGE_SIZE }),
    getNextPageParam: (last) => (last.hasMore ? last.offset + last.records.length : undefined),
    staleTime: 30_000,
  });

  const pages = query.data?.pages ?? [];
  const loaded = useMemo(() => pages.flatMap((p) => p.records), [pages]);

  const startKey = range.startDate?.getTime() ?? null;
  const endKey = range.endDate?.getTime() ?? null;

  const data = useMemo(
    () =>
      filterDeletionRecords(loaded, {
        startDate: startKey != null ? new Date(startKey) : null,
        endDate: endKey != null ? new Date(endKey) : null,
      }),
    [loaded, startKey, endKey],
  );

  return pagedShape(query, {
    data,
    loaded: loaded.length,
    total: pages.at(-1)?.total ?? loaded.length,
  });
}
