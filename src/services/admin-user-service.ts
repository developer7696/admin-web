import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDocs,
  onSnapshot,
  Timestamp,
  updateDoc,
  type DocumentData,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { db, storage } from '@/lib/firebase';
import { isAdminUserData } from '@/auth/admin-auth';
import { fmtDateDashed } from '@/lib/format';

/// Direct-Firestore user administration, ported from the Flutter panel's
/// `admin_user_service.dart`.
///
/// NOTE (carried over from ARCHITECTURE.md): user deletion and subscription
/// grants here write straight to Firestore, bypassing the backend's
/// `requireAdmin`, its validation, and its audit log. This is the highest-risk
/// direct-write path in the panel and is a known migration target, not an
/// oversight.

export type UserRow = DocumentData & {
  uid: string;
  username: string;
  email: string;
  health: number;
  calculatedStatus: string;
  platform: string;
  profilePhoto?: string | null;
};

export type DeletionRow = {
  uid: string;
  username: string;
  reason: string;
  date: Date;
  platform: string;
  docId: string;
  collection: string;
};

export type PlatformFilter = 'Overall' | 'iOS' | 'Android';

/// Legacy data parser: handles Timestamp, Date, int (s or ms) and ISO strings.
function parseDate(raw: unknown): Date {
  if (raw == null) return new Date();
  if (raw instanceof Timestamp) return raw.toDate();
  if (raw instanceof Date) return raw;
  if (typeof raw === 'number') {
    return new Date(raw < 10_000_000_000 ? raw * 1000 : raw);
  }
  if (typeof raw === 'string') {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? new Date() : d;
  }
  if (typeof raw === 'object' && 'toDate' in raw && typeof (raw as { toDate: unknown }).toDate === 'function') {
    return (raw as { toDate: () => Date }).toDate();
  }
  return new Date();
}

function isIosPlatform(data: DocumentData): boolean {
  const p = String(data.platform ?? 'Android').toLowerCase();
  return p.includes('apple') || p.includes('ios') || p.includes('iphone');
}

function matchesPlatform(data: DocumentData, filter: PlatformFilter): boolean {
  if (filter === 'Overall') return true;
  const ios = isIosPlatform(data);
  return filter === 'iOS' ? ios : !ios;
}

/// Subscription state as the panel displays it. `Expired` means a trial that
/// ran out; `Inactive` means there was never a trial at all.
export function calculateStatus(data: DocumentData): string {
  const isPremium = data.isPremium === true;
  const isBasic = data.isBasic === true || data.subscriptionTier === 'Basic';
  const subEnd = data.subscriptionEndDate as Timestamp | undefined;
  const isSubActive = subEnd != null && Date.now() < subEnd.toDate().getTime();

  if (isPremium && isSubActive) return 'Premium';
  if (isBasic && isSubActive) return 'Basic';

  const trialStart = data.trialStartDate as Timestamp | undefined;
  if (trialStart != null) {
    const expiry = trialStart.toDate().getTime() + 7 * 24 * 60 * 60 * 1000;
    return Date.now() < expiry ? 'Trial' : 'Expired';
  }
  return 'Inactive';
}

/// Deep field discovery: normalises the four historical deletion-reason schemas
/// into one shape.
function normalizeDeletionData(data: DocumentData, docId: string, col: string): DeletionRow {
  return {
    uid: String(data.uid ?? data.userId ?? data.id ?? docId),
    username: String(data.username ?? data.name ?? 'Unknown User'),
    reason: String(data.reason ?? data.Reason ?? data.message ?? 'No reason provided'),
    date: parseDate(data.deletedAt ?? data.timestamp ?? data.date ?? data.time),
    platform: String(data.platform ?? 'Unknown'),
    docId,
    collection: col,
  };
}

const DELETION_COLLECTIONS = [
  'deletion_reasons',
  'DeletionReasons',
  'deletion_reason',
  'user_deletions',
];

/// Hyper-sync deletion engine: merges records from the collections above,
/// de-duplicating by uid so one event logged twice shows once.
///
/// Emits `[]` immediately so the page never hangs in a loading state waiting on
/// a collection that may not exist.
export function subscribeDeletions(
  onData: (rows: DeletionRow[]) => void,
  range?: { startDate?: Date | null; endDate?: Date | null },
): () => void {
  const latest: Record<string, DeletionRow[]> = {};
  let cancelled = false;

  const emit = () => {
    if (cancelled) return;
    const unique = new Map<string, DeletionRow>();
    for (const list of Object.values(latest)) {
      for (const item of list) unique.set(item.uid, item);
    }
    let rows = [...unique.values()];
    if (range?.startDate) {
      const from = range.startDate.getTime();
      rows = rows.filter((r) => r.date.getTime() > from);
    }
    if (range?.endDate) {
      const to = range.endDate.getTime() + 24 * 60 * 60 * 1000;
      rows = rows.filter((r) => r.date.getTime() < to);
    }
    rows.sort((a, b) => b.date.getTime() - a.date.getTime());
    onData(rows);
  };

  emit();

  const unsubs = DELETION_COLLECTIONS.map((col) =>
    onSnapshot(
      collection(db, col),
      (snap) => {
        latest[col] = snap.docs.map((d) => normalizeDeletionData(d.data(), d.id, col));
        emit();
      },
      () => {
        // A missing or unreadable collection must not block the others.
        latest[col] = [];
        emit();
      },
    ),
  );

  return () => {
    cancelled = true;
    for (const u of unsubs) u();
  };
}

export async function deleteDeletionRecord(col: string, docId: string): Promise<void> {
  await deleteDoc(doc(db, col, docId));
}

/// Permanent deletion: removes the user from `users` without an audit log.
export async function deleteUser(uid: string): Promise<void> {
  await deleteDoc(doc(db, 'users', uid));
}

/// Manual subscription grant with tiered durations. `days` wins over `months`
/// when both are given, matching the Flutter service.
export async function updateUserSubscription(
  uid: string,
  tier: 'Premium' | 'Basic' | 'Trial' | 'None',
  opts: { months?: number; days?: number } = {},
): Promise<void> {
  const { months = 1, days = 0 } = opts;
  const now = new Date();

  let expiry: Date;
  if (days > 0) {
    expiry = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  } else {
    let year = now.getFullYear();
    let month = now.getMonth() + 1 + months;
    while (month > 12) {
      year++;
      month -= 12;
    }
    expiry = new Date(year, month - 1, now.getDate());
  }

  const updates: Record<string, unknown> = {};
  switch (tier) {
    case 'Premium':
      updates.isPremium = true;
      updates.isBasic = false;
      updates.subscriptionTier = 'Premium';
      updates.subscriptionEndDate = Timestamp.fromDate(expiry);
      updates.subscriptionStartDate = Timestamp.fromDate(now);
      break;
    case 'Basic':
      updates.isPremium = false;
      updates.isBasic = true;
      updates.subscriptionTier = 'Basic';
      updates.subscriptionEndDate = Timestamp.fromDate(expiry);
      updates.subscriptionStartDate = Timestamp.fromDate(now);
      break;
    case 'Trial': {
      updates.isPremium = false;
      updates.isBasic = false;
      updates.subscriptionTier = 'Free';
      updates.trialStartDate = Timestamp.fromDate(now);
      updates.subscriptionEndDate = Timestamp.fromDate(
        new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      );
      break;
    }
    default:
      updates.isPremium = false;
      updates.isBasic = false;
      updates.subscriptionTier = 'Free';
      updates.subscriptionEndDate = deleteField();
      updates.subscriptionStartDate = deleteField();
      updates.trialStartDate = deleteField();
      break;
  }

  await updateDoc(doc(db, 'users', uid), updates);
}

/// Health score, 0–100. Three weighted components, unchanged from the Flutter
/// service so a user's score does not shift under the same data:
///   workout velocity (40) — against a target of 3 workouts/week
///   recency          (30) — decays to zero over 14 days of inactivity
///   loyalty          (30) — total workouts, saturating at 50
function healthScore(data: DocumentData): number {
  const rawWorkouts = data.totalWorkouts;
  const workouts =
    typeof rawWorkouts === 'number'
      ? rawWorkouts
      : Number.parseInt(String(rawWorkouts ?? '0'), 10) || 0;

  const createdAt = (data.createdAt as Timestamp | undefined)?.toDate() ?? new Date();
  const daysJoined = Math.min(
    1000,
    Math.max(1, Math.floor((Date.now() - createdAt.getTime()) / 86_400_000)),
  );

  const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

  const workoutVelocity = clamp01(workouts / (daysJoined * 0.43)) * 40;

  const lastLoginRaw = data.lastLogin ?? data.updatedAt;
  const lastActive = lastLoginRaw instanceof Timestamp ? lastLoginRaw.toDate() : createdAt;
  const daysSinceActive = Math.floor((Date.now() - lastActive.getTime()) / 86_400_000);
  const recencyScore = clamp01(1 - daysSinceActive / 14) * 30;

  const loyaltyBase = clamp01(workouts / 50) * 30;

  return workoutVelocity + recencyScore + loyaltyBase;
}

/// Live user list with health/engagement scoring.
///
/// `ghosts` inverts the usual filter and returns ONLY empty documents — auth
/// records whose user doc was never written.
///
/// This deliberately does NOT filter by subscription status. It used to take the
/// whole status string, which meant every status chip click tore the snapshot
/// listener down and re-downloaded the collection — while the page filtered by
/// status a second time client-side anyway. Only the Ghosts case actually needs
/// the listener rebuilt, so only that is in the signature.
export function subscribeUsers(
  filters: {
    platformFilter: PlatformFilter;
    ghosts: boolean;
    startDate?: Date | null;
    endDate?: Date | null;
  },
  onData: (rows: UserRow[]) => void,
  onError?: (e: Error) => void,
): () => void {
  return onSnapshot(
    collection(db, 'users'),
    (snapshot) => {
      const rows = snapshot.docs
        .filter((d) => {
          const data = d.data();
          const isEmpty = Object.keys(data).length === 0;

          if (filters.ghosts) return isEmpty;
          if (isEmpty || isAdminUserData(data)) return false;
          if (!matchesPlatform(data, filters.platformFilter)) return false;

          if (filters.startDate || filters.endDate) {
            const createdAt = parseDate(data.createdAt).getTime();
            if (filters.startDate && createdAt < filters.startDate.getTime()) return false;
            if (filters.endDate && createdAt > filters.endDate.getTime() + 86_400_000) return false;
          }
          return true;
        })
        .map<UserRow>((d) => {
          const data = d.data();
          const uid = d.id;

          if (Object.keys(data).length === 0) {
            return {
              uid,
              username: 'Ghost Record',
              email: 'Empty Document',
              health: 0,
              calculatedStatus: 'Ghost',
              platform: 'Unknown',
              createdAt: null,
            };
          }

          const email = String(data.email ?? 'No email');
          let username = String(data.username ?? 'User');
          if (username === 'User' || username.length === 0) {
            username =
              email !== 'No email' && email.includes('@')
                ? email.split('@')[0]
                : `User_${uid.slice(0, 5)}`;
          }

          return {
            ...data,
            uid,
            health: healthScore(data),
            calculatedStatus: calculateStatus(data),
            username,
            email,
            profilePhoto: data.profilePhoto ?? null,
            platform: String(data.platform ?? 'Android'),
          };
        });
      onData(rows);
    },
    (e) => onError?.(e),
  );
}

export async function updateProfilePhoto(uid: string, photoUrl: string): Promise<void> {
  await updateDoc(doc(db, 'users', uid), { profilePhoto: photoUrl });
}

/// Uploads bytes to `user_profiles/{uid}.jpg` and syncs the download URL onto
/// the user document.
export async function uploadAndSyncProfilePhoto(uid: string, file: Blob): Promise<string> {
  try {
    const objectRef = ref(storage, `user_profiles/${uid}.jpg`);
    const task = await uploadBytes(objectRef, file, { contentType: 'image/jpeg' });
    const downloadUrl = await getDownloadURL(task.ref);
    await updateProfilePhoto(uid, downloadUrl);
    return downloadUrl;
  } catch (e) {
    throw new Error(`Photo sync failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function deleteProfilePhoto(uid: string): Promise<void> {
  await updateDoc(doc(db, 'users', uid), { profilePhoto: deleteField() });
}

const CSV_HEADER = [
  'S.No', 'User ID', 'Username', 'Email', 'Phone', 'City', 'Platform', 'Joined Date',
  'Status', 'Gender', 'Age', 'Height(cm)', 'Weight(kg)', 'BMI',
  'Goal', 'Diet', 'Exp Level', 'Activity', 'Workout Time',
  'Calories', 'Total Workouts',
];

/// Filtered user list flattened for CSV export.
export async function getUsersCsvData(opts: {
  platformFilter?: PlatformFilter;
  startDate?: Date | null;
  endDate?: Date | null;
} = {}): Promise<unknown[][]> {
  const { platformFilter = 'Overall', startDate, endDate } = opts;
  const snapshot = await getDocs(collection(db, 'users'));

  const users = snapshot.docs
    .filter((d) => {
      const data = d.data();
      if (Object.keys(data).length === 0) return false;
      if (isAdminUserData(data)) return false;
      return matchesPlatform(data, platformFilter);
    })
    .filter((d) => {
      const data = d.data();
      // A row with neither an email nor a join date carries nothing worth
      // exporting.
      if (!('email' in data) && !('createdAt' in data)) return false;
      if (!startDate) return true;
      const createdAt = parseDate(data.createdAt).getTime();
      let inRange = createdAt >= startDate.getTime() - 1000;
      if (endDate) inRange = inRange && createdAt < endDate.getTime() + 86_400_000;
      return inRange;
    });

  const rows: unknown[][] = [CSV_HEADER];

  users.forEach((d, i) => {
    const data = d.data();
    const email = String(data.email ?? 'No email');
    let username = String(data.username ?? 'User');
    if (username === 'User' || username.length === 0) username = email.split('@')[0];

    rows.push([
      i + 1,
      d.id,
      username,
      email,
      data.phoneNumber ?? '-',
      data.city ?? '-',
      data.platform ?? 'Android',
      data.createdAt != null ? fmtDateDashed(parseDate(data.createdAt)) : '-',
      calculateStatus(data),
      data.gender ?? '-',
      data.age ?? '-',
      data.height ?? '-',
      data.weight ?? '-',
      data.bmi ?? '-',
      data.fitnessGoal ?? '-',
      data.dietType ?? '-',
      data.experienceLevel ?? '-',
      data.activityLevel ?? '-',
      data.preferredWorkoutTime ?? '-',
      data.dailyCalories ?? '-',
      data.totalWorkouts ?? '0',
    ]);
  });

  return rows;
}

/// Push the filtered export to a Google Apps Script endpoint.
///
/// `no-cors` is deliberate: Apps Script web apps answer with a 302 to a
/// googleusercontent.com URL that sends no CORS headers, so the browser can
/// never read the response. The POST still arrives, so success here means
/// "sent", not "confirmed stored".
export async function syncToGoogleSheets(
  scriptUrl: string,
  opts: { platformFilter?: PlatformFilter; startDate?: Date | null; endDate?: Date | null } = {},
): Promise<boolean> {
  try {
    const rows = await getUsersCsvData(opts);
    await fetch(scriptUrl, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(rows),
    });
    return true;
  } catch {
    return false;
  }
}
