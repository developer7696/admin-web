// `currentUserCan` rather than the old `isCurrentUserAdmin`: that helper now
// means "holds ANY permission", so a reader would sail straight past it. These
// are client-side pre-checks only — the server enforces the same permissions
// again; see ARCHITECTURE.md "The gap".
import { currentUserCan } from '@/auth/admin-auth';
import { adminApi, type Json } from '@/lib/api-client';
import { toDate } from '@/lib/format';

/// The customer-support queue, through the admin API.
///
/// This used to read and write the `complaints` Firestore collection straight
/// from the browser. It no longer does: the server validates the payload, checks
/// the permission itself, and writes an audit entry per change. Since the
/// backend moved to Postgres, that collection is also a snapshot frozen at
/// migration time, so a screen reading it looks fine and shows nothing new.
///
/// Admin-relevant subset only: the consumer-facing methods (submitComplaint,
/// getUserComplaints) belong to the mobile app.

/// One complaint as the admin queue consumes it.
///
/// Typed out rather than `DocumentData` now that the payload is a known shape.
/// The `user*` fields are the snapshot taken when the ticket was filed — they
/// are NOT re-resolved against the user record, so a since-renamed reporter
/// still reads as they did then.
export type ComplaintRow = {
  id: string;
  userId: string | null;
  userEmail: string | null;
  userName: string | null;
  userProfilePhoto: string | null;
  subject: string;
  description: string;
  category: string;
  /// Always populated. An untriaged ticket has NO stored status or priority, and
  /// the API reports the defaults (`pending` / `medium`) for it — in the row, in
  /// the filter and in the statistics alike. The Firestore path had the tile
  /// counting such a ticket as pending while the pending TAB excluded it,
  /// because an equality filter cannot match a missing field; do not re-apply a
  /// client-side default on top of this or it will be applied twice.
  status: string;
  priority: string;
  adminResponse: string | null;
  adminResponseAt: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  isRead: boolean;
};

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

const text = (raw: unknown): string => (typeof raw === 'string' ? raw : '');
const nullableText = (raw: unknown): string | null => (typeof raw === 'string' ? raw : null);

export function parseComplaint(raw: Json): ComplaintRow {
  return {
    id: String(raw.id ?? ''),
    userId: nullableText(raw.userId),
    userEmail: nullableText(raw.userEmail),
    userName: nullableText(raw.userName),
    userProfilePhoto: nullableText(raw.userProfilePhoto),
    subject: text(raw.subject),
    description: text(raw.description),
    category: text(raw.category),
    status: text(raw.status),
    priority: text(raw.priority),
    adminResponse: nullableText(raw.adminResponse),
    adminResponseAt: toDate(raw.adminResponseAt),
    createdAt: toDate(raw.createdAt),
    updatedAt: toDate(raw.updatedAt),
    isRead: raw.isRead === true,
  };
}

export type ComplaintQuery = {
  /// One configured status, or `all` — which is the tab the queue opens on and
  /// is spelled out server-side rather than being an omitted parameter.
  status?: string;
  priority?: string;
  /// `false` is the unread queue. Omit for both.
  isRead?: boolean;
  /// One reporter's tickets, by uid.
  uid?: string;
  limit?: number;
  offset?: number;
};

export type ComplaintsPayload = {
  complaints: ComplaintRow[];
  /// Whether another page exists. There is no total here — `/statistics`
  /// reports it exactly, and counting it per page would double the work.
  hasMore: boolean;
  limit: number;
  offset: number;
};

/// One page of the queue, newest first, filters composed server-side.
///
/// A fetch rather than the Firestore stream this replaces — the API cannot push,
/// so every mutation refetches. The trade is losing changes made by ANOTHER
/// admin while the page sits open.
///
/// Ordering is now the server's (`ORDER BY created_at DESC`) for every filter,
/// not just the unfiltered one: the client-side sort existed because a Firestore
/// equality filter plus an ordering needed a composite index.
export async function listComplaints(query: ComplaintQuery = {}): Promise<ComplaintsPayload> {
  const json = await adminApi.listComplaints(query);
  return {
    complaints: ((json.complaints as Json[]) ?? []).map(parseComplaint),
    hasMore: json.hasMore === true,
    limit: typeof json.limit === 'number' ? json.limit : 0,
    offset: typeof json.offset === 'number' ? json.offset : 0,
  };
}

/// Triage a ticket. `adminResponse` is only sent when there is something to
/// write: the dialog sends the response box's contents with every status change,
/// and an empty box means "I did not touch the reply", not "erase it". (The
/// server reads a null the same way, so this is belt and braces — and it is why
/// `adminResponseAt` is the server's to stamp, not this file's.)
export async function updateComplaintStatus(args: {
  complaintId: string;
  status: string;
  adminResponse?: string | null;
}): Promise<boolean> {
  if (!currentUserCan('complaints:write')) throw new Error('Unauthorized access');

  await adminApi.setComplaintStatus(args.complaintId, {
    status: args.status,
    ...(args.adminResponse ? { adminResponse: args.adminResponse } : {}),
  });
  return true;
}

export async function updateComplaintPriority(
  complaintId: string,
  priority: string,
): Promise<boolean> {
  if (!currentUserCan('complaints:write')) throw new Error('Unauthorized access');
  await adminApi.setComplaintPriority(complaintId, priority);
  return true;
}

/// Best-effort: a failed read-receipt must not interrupt opening the complaint.
/// Idempotent server-side, and re-marking an already-read ticket does not move
/// its `updatedAt`.
export async function markComplaintAsRead(complaintId: string): Promise<void> {
  if (!currentUserCan('complaints:write')) return;
  try {
    await adminApi.markComplaintRead(complaintId);
  } catch {
    // ignored
  }
}

export async function deleteComplaint(complaintId: string): Promise<void> {
  if (!currentUserCan('complaints:write')) throw new Error('Unauthorized access');
  await adminApi.deleteComplaint(complaintId);
}

export type ComplaintStats = {
  total: number;
  pending: number;
  inProgress: number;
  resolved: number;
  closed: number;
  unread: number;
};

const EMPTY_STATS: ComplaintStats = {
  total: 0,
  pending: 0,
  inProgress: 0,
  resolved: 0,
  closed: 0,
  unread: 0,
};

const count = (raw: unknown): number => (typeof raw === 'number' ? Math.trunc(raw) : 0);

/// The counts, as reported. They are one SQL aggregate over the table now, not a
/// pass over every document the browser had to download first — and `pending`
/// already includes the untriaged tickets, so nothing is bucketed again here.
/// The endpoint also returns `read` and a `byPriority` breakdown, which this
/// screen has nowhere to show.
export function parseComplaintStats(json: unknown): ComplaintStats {
  const rec = json && typeof json === 'object' ? (json as Record<string, unknown>) : {};
  return {
    total: count(rec.total),
    pending: count(rec.pending),
    inProgress: count(rec.inProgress),
    resolved: count(rec.resolved),
    closed: count(rec.closed),
    unread: count(rec.unread),
  };
}

/// Zeros rather than a throw on failure: the counts sit in the page header, and
/// losing them must not take the queue down with it.
export async function getComplaintStatistics(): Promise<ComplaintStats> {
  if (!currentUserCan('complaints:read')) return EMPTY_STATS;
  try {
    return parseComplaintStats(await adminApi.complaintStatistics());
  } catch {
    return EMPTY_STATS;
  }
}
