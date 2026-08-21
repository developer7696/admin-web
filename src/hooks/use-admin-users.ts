import { useEffect, useState } from 'react';
import { collection, onSnapshot, type DocumentData } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  subscribeDeletions,
  subscribeUsers,
  type DeletionRow,
  type PlatformFilter,
  type UserRow,
} from '@/services/admin-user-service';

/// Firestore `onSnapshot` has no place in React Query's fetch model, so the live
/// collections stay as subscriptions.
///
/// There is no separate stats query here any more. It was a second full read of
/// the `users` collection this file already streams, plus an `audit_logs` query,
/// re-run on every platform change — for four counts the streamed rows can
/// produce for free.

type Subscription<T> = { data: T[]; loading: boolean; error: Error | null };

export function useUsersStream(filters: {
  platformFilter: PlatformFilter;
  /// Only the Ghosts view changes what the listener must fetch. Subscription
  /// status is filtered from the streamed rows in the page, so switching a
  /// status chip costs nothing.
  ghosts: boolean;
  startDate?: Date | null;
  endDate?: Date | null;
}): Subscription<UserRow> {
  const [state, setState] = useState<Subscription<UserRow>>({
    data: [],
    loading: true,
    error: null,
  });

  // Dates are compared by value, not identity — a new Date object with the same
  // instant must not tear down and re-open the snapshot listener.
  const startKey = filters.startDate?.getTime() ?? null;
  const endKey = filters.endDate?.getTime() ?? null;

  useEffect(() => {
    setState((prev) => ({ ...prev, loading: true }));
    return subscribeUsers(
      {
        platformFilter: filters.platformFilter,
        ghosts: filters.ghosts,
        startDate: startKey != null ? new Date(startKey) : null,
        endDate: endKey != null ? new Date(endKey) : null,
      },
      (data) => setState({ data, loading: false, error: null }),
      (error) => setState({ data: [], loading: false, error }),
    );
  }, [filters.platformFilter, filters.ghosts, startKey, endKey]);

  return state;
}

export function useDeletionStream(range: {
  startDate?: Date | null;
  endDate?: Date | null;
}): Subscription<DeletionRow> {
  const [state, setState] = useState<Subscription<DeletionRow>>({
    data: [],
    loading: true,
    error: null,
  });

  const startKey = range.startDate?.getTime() ?? null;
  const endKey = range.endDate?.getTime() ?? null;

  useEffect(() => {
    setState((prev) => ({ ...prev, loading: true }));
    return subscribeDeletions(
      (data) => setState({ data, loading: false, error: null }),
      {
        startDate: startKey != null ? new Date(startKey) : null,
        endDate: endKey != null ? new Date(endKey) : null,
      },
    );
  }, [startKey, endKey]);

  return state;
}

/// Raw `users` collection stream — used by the Billing pane, which (like the
/// mobile original) reads Firestore directly rather than through a service
/// method; all its filters are applied client-side over this same stream.
export function useRawUsersStream(): Subscription<{ uid: string; data: DocumentData }> {
  const [state, setState] = useState<Subscription<{ uid: string; data: DocumentData }>>({
    data: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    return onSnapshot(
      collection(db, 'users'),
      (snapshot) =>
        setState({
          data: snapshot.docs.map((d) => ({ uid: d.id, data: d.data() })),
          loading: false,
          error: null,
        }),
      (error) => setState({ data: [], loading: false, error }),
    );
  }, []);

  return state;
}
