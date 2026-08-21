import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
  type DocumentData,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { isCurrentUserAdmin } from '@/auth/admin-auth';
import { adminApi } from '@/lib/api-client';

/// Admin-relevant subset of the mobile app's customer-support service (the
/// `complaints` collection). Consumer-facing methods (submitComplaint,
/// getUserComplaints) aren't needed here.

export type ComplaintRow = DocumentData & { id: string };

export type SupportCatalog = {
  statuses: string[];
  priorities: string[];
};

const strings = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string' && v.trim() !== '') : [];

export async function fetchSupportCatalog(): Promise<SupportCatalog> {
  const json = await adminApi.complaintCategories();
  return {
    statuses: strings(json.statuses),
    priorities: strings(json.priorities),
  };
}

/// `status === 'all'` subscribes to the whole collection ordered by date;
/// anything else filters server-side. The status query has no `orderBy` — that
/// combination needs a composite index, so those tabs sort client-side.
export function subscribeComplaints(
  status: string,
  onData: (rows: ComplaintRow[]) => void,
  onError?: (e: Error) => void,
): () => void {
  const ref =
    status === 'all'
      ? query(collection(db, 'complaints'), orderBy('createdAt', 'desc'))
      : query(collection(db, 'complaints'), where('status', '==', status));

  return onSnapshot(
    ref,
    (snapshot) => onData(snapshot.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (e) => onError?.(e),
  );
}

export async function updateComplaintStatus(args: {
  complaintId: string;
  status: string;
  adminResponse?: string | null;
}): Promise<boolean> {
  if (!isCurrentUserAdmin()) throw new Error('Unauthorized access');

  const update: Record<string, unknown> = {
    status: args.status,
    updatedAt: new Date(),
  };
  if (args.adminResponse) {
    update.adminResponse = args.adminResponse;
    update.adminResponseAt = new Date();
  }

  await updateDoc(doc(db, 'complaints', args.complaintId), update);
  return true;
}

export async function updateComplaintPriority(
  complaintId: string,
  priority: string,
): Promise<boolean> {
  if (!isCurrentUserAdmin()) throw new Error('Unauthorized access');
  await updateDoc(doc(db, 'complaints', complaintId), { priority, updatedAt: new Date() });
  return true;
}

/// Best-effort: a failed read-receipt must not interrupt opening the complaint.
export async function markComplaintAsRead(complaintId: string): Promise<void> {
  if (!isCurrentUserAdmin()) return;
  try {
    await updateDoc(doc(db, 'complaints', complaintId), { isRead: true, updatedAt: new Date() });
  } catch {
    // ignored
  }
}

export async function deleteComplaint(complaintId: string): Promise<void> {
  if (!isCurrentUserAdmin()) throw new Error('Unauthorized access');
  await deleteDoc(doc(db, 'complaints', complaintId));
}

export type ComplaintStats = {
  total: number;
  pending: number;
  inProgress: number;
  resolved: number;
  closed: number;
  unread: number;
};

export async function getComplaintStatistics(): Promise<ComplaintStats> {
  const empty: ComplaintStats = {
    total: 0,
    pending: 0,
    inProgress: 0,
    resolved: 0,
    closed: 0,
    unread: 0,
  };
  if (!isCurrentUserAdmin()) return empty;

  try {
    const snapshot = await getDocs(collection(db, 'complaints'));
    const stats = { ...empty, total: snapshot.docs.length };

    for (const d of snapshot.docs) {
      const data = d.data();
      switch (data.status ?? 'pending') {
        case 'pending':
          stats.pending++;
          break;
        case 'in_progress':
          stats.inProgress++;
          break;
        case 'resolved':
          stats.resolved++;
          break;
        case 'closed':
          stats.closed++;
          break;
      }
      if (data.isRead !== true) stats.unread++;
    }

    return stats;
  } catch {
    return empty;
  }
}
