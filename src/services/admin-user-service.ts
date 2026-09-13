import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { adminApi, ApiException, type Json } from '@/lib/api-client';
import { currentUserCan, isAdminUserData } from '@/auth/admin-auth';
import { storage } from '@/lib/firebase';
import { fmtDateDashed, toDate } from '@/lib/format';

/// User administration, through the admin API.
///
/// This used to talk to Firestore directly from the browser, and that was the
/// highest-risk direct-write path in the panel: deletions and subscription
/// grants bypassed the backend's `requireAdmin`, its validation and its audit
/// log, and the Firestore rules allow any signed-in user to write any document,
/// so those writes were enforced by nothing. The reads were worse than
/// unsafe — the backend writes only Postgres now, so a browser reading `users`
/// showed a snapshot frozen at migration time, with no error to say so.
///
/// Every read and write below goes to the server, which re-checks the same
/// permission, validates the payload, stamps the actor from the verified ID
/// token and writes an audit entry.
///
/// ONE THING THAT DID NOT MOVE, AND WHY
///
/// **Profile-photo BYTES** still go to Firebase Storage (see
/// `uploadAndSyncProfilePhoto`). That is not a Firestore write, and there is no
/// admin bytes endpoint to move it to. Only the metadata write moved. Nothing in
/// this file reads or writes Firestore any more.

/// One row of the admin user table.
///
/// Spread from the API row, so every column the endpoint returns is readable by
/// name (`subscriptionEndDate`, `trialStartDate`, `phoneNumber`, …). Admin
/// endpoints emit timestamps as ISO strings, so date fields are strings here and
/// go through `toDate` at the point of use — the same treatment the rest of the
/// panel gives them.
///
/// `health` and `calculatedStatus` are derived client-side; the endpoint
/// deliberately returns raw entitlement columns and classifies nothing.
export type UserRow = Json & {
  uid: string;
  username: string;
  email: string;
  health: number;
  calculatedStatus: string;
  platform: string;
  profilePhoto?: string | null;
  /// Declared because `filterUsers` reads it by name to drop staff accounts.
  /// A legacy mirror of the `adm` claim — never an authorization input, only how
  /// a LIST recognises other admins, since one account cannot read another's
  /// claims.
  role?: unknown;
};

/// One departed account, as the Exits tab renders it.
///
/// `deletion_reasons.uid` is not a foreign key — the user is gone — so this row
/// is the only record they existed, and it carries no username: nothing ever
/// stored one. `label` is therefore derived, not reported.
export type DeletionRow = {
  uid: string;
  email: string | null;
  /// Best available display name: the local part of the email, else the uid.
  label: string;
  reason: string;
  /// Nullable in the table, so nullable here rather than silently "now".
  date: Date | null;
  /// Which legacy Firestore collection spelling this row came from during the
  /// migration. Diagnostic only — the four spellings are one table now.
  source: string | null;
};

export type PlatformFilter = 'Overall' | 'iOS' | 'Android';

const DAY_MS = 86_400_000;

function isIosPlatform(data: Json): boolean {
  const p = String(data.platform ?? 'Android').toLowerCase();
  return p.includes('apple') || p.includes('ios') || p.includes('iphone');
}

/// Platform is filtered here rather than by the server: `GET /api/admin/users`
/// takes only `search`, so this and the joined-date window are applied to the
/// rows that were fetched.
function matchesPlatform(data: Json, filter: PlatformFilter): boolean {
  if (filter === 'Overall') return true;
  const ios = isIosPlatform(data);
  return filter === 'iOS' ? ios : !ios;
}

/// A row with no identity on it — created by a push-token registration or a
/// payment webhook before the person ever completed a sign-up.
///
/// On Firestore these were literally empty documents, which is what the old
/// "Ghosts" filter tested. A Postgres row always carries every column, so the
/// test is now "no email and no username". Note this can no longer surface an
/// Auth account with no row at all: the endpoint selects FROM `users`, so an
/// account that was never written there is invisible to it.
function isGhostRow(data: Json): boolean {
  const blank = (v: unknown) => v == null || String(v).trim() === '';
  return blank(data.email) && blank(data.username);
}

/// Subscription state as the panel displays it. `Expired` means a trial that
/// ran out; `Inactive` means there was never a trial at all.
///
/// Derived here, not by the server, which returns the raw entitlement columns
/// on purpose. Beware that `trialStartDate` is a legacy auto-grant on most
/// accounts rather than evidence of a real trial, so `Trial` here is a display
/// bucket and not a conversion signal.
export function calculateStatus(data: Json): string {
  const isPremium = data.isPremium === true;
  const isBasic = data.isBasic === true || data.subscriptionTier === 'Basic';
  const subEnd = toDate(data.subscriptionEndDate);
  const isSubActive = subEnd != null && Date.now() < subEnd.getTime();

  if (isPremium && isSubActive) return 'Premium';
  if (isBasic && isSubActive) return 'Basic';

  const trialStart = toDate(data.trialStartDate);
  if (trialStart != null) {
    const expiry = trialStart.getTime() + 7 * DAY_MS;
    return Date.now() < expiry ? 'Trial' : 'Expired';
  }
  return 'Inactive';
}

/// Health score, 0–100. Three weighted components, unchanged from the Flutter
/// service so a user's score does not shift under the same data:
///   workout velocity (40) — against a target of 3 workouts/week
///   recency          (30) — decays to zero over 14 days of inactivity
///   loyalty          (30) — total workouts, saturating at 50
///
/// The recency term reads `lastLogin` first for the same reason it always did,
/// but the admin endpoint does not return a login timestamp (nothing writes
/// one), so in practice every account now scores recency off `updatedAt`.
function healthScore(data: Json): number {
  const rawWorkouts = data.totalWorkouts;
  const workouts =
    typeof rawWorkouts === 'number'
      ? rawWorkouts
      : Number.parseInt(String(rawWorkouts ?? '0'), 10) || 0;

  const createdAt = toDate(data.createdAt) ?? new Date();
  const daysJoined = Math.min(
    1000,
    Math.max(1, Math.floor((Date.now() - createdAt.getTime()) / DAY_MS)),
  );

  const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

  const workoutVelocity = clamp01(workouts / (daysJoined * 0.43)) * 40;

  const lastActive = toDate(data.lastLogin ?? data.updatedAt) ?? createdAt;
  const daysSinceActive = Math.floor((Date.now() - lastActive.getTime()) / DAY_MS);
  const recencyScore = clamp01(1 - daysSinceActive / 14) * 30;

  const loyaltyBase = clamp01(workouts / 50) * 30;

  return workoutVelocity + recencyScore + loyaltyBase;
}

/// One API row → one table row.
///
/// Exported for the unit suite: the display fallbacks (a blank username
/// becoming the local part of the email, a ghost row becoming a labelled
/// placeholder) are the part of this file that can be wrong without any request
/// failing.
export function parseUserRow(raw: Json): UserRow {
  const uid = String(raw.uid ?? '');

  if (isGhostRow(raw)) {
    return {
      ...raw,
      uid,
      username: 'Ghost Record',
      email: 'No identity on this row',
      health: 0,
      calculatedStatus: 'Ghost',
      platform: raw.platform != null ? String(raw.platform) : 'Unknown',
      profilePhoto: null,
    };
  }

  const email = raw.email != null && String(raw.email).trim() !== '' ? String(raw.email) : 'No email';
  let username = raw.username != null && String(raw.username).trim() !== '' ? String(raw.username) : 'User';
  if (username === 'User') {
    username =
      email !== 'No email' && email.includes('@') ? email.split('@')[0] : `User_${uid.slice(0, 5)}`;
  }

  return {
    ...raw,
    uid,
    health: healthScore(raw),
    calculatedStatus: calculateStatus(raw),
    username,
    email,
    profilePhoto: raw.profilePhoto != null ? String(raw.profilePhoto) : null,
    platform: raw.platform != null ? String(raw.platform) : 'Android',
  };
}

/// The endpoint's own ceiling. Asking for more is a 400, not a bigger page.
export const USERS_PAGE_SIZE = 200;

export type UsersPage = {
  users: UserRow[];
  /// Rows matching `search`, ignoring the page window.
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
};

/// One page of the user table.
///
/// Paged for real — `limit`/`offset`, with the grand total the server computes
/// alongside the page. It is deliberately NOT looped to assemble the whole
/// table: that is what the old whole-collection read did, and what the export
/// endpoint exists for when every row genuinely is needed at once.
export async function fetchUsersPage(
  params: { search?: string | null; limit?: number; offset?: number } = {},
): Promise<UsersPage> {
  if (!currentUserCan('users:read')) throw new Error('Unauthorized access');

  const limit = Math.min(params.limit ?? USERS_PAGE_SIZE, USERS_PAGE_SIZE);
  const offset = params.offset ?? 0;
  const json = await adminApi.listUsers({ search: params.search, limit, offset });

  const users = ((json.users as Json[]) ?? []).map(parseUserRow);
  return {
    users,
    total: typeof json.total === 'number' ? json.total : users.length,
    limit,
    offset,
    // Trust the server's own computation — it is the one place the off-by-one
    // between "a full last page" and "a further page" is decided.
    hasMore: json.hasMore === true,
  };
}

export type UsersExport = {
  rows: Json[];
  /// True when the server's row cap cut the export short. Surfaced rather than
  /// swallowed: a spreadsheet that is quietly missing its tail is worse than one
  /// that refuses to pretend.
  truncated: boolean;
  limit: number;
};

/// Every matching row in one request, for the exports and for the panes that
/// need the whole population rather than a page.
export async function fetchAllUsers(search?: string | null): Promise<UsersExport> {
  if (!currentUserCan('users:read')) throw new Error('Unauthorized access');

  const json = await adminApi.exportUsers(search);
  return {
    rows: (json.users as Json[]) ?? [],
    truncated: json.truncated === true,
    limit: typeof json.limit === 'number' ? json.limit : 0,
  };
}

/// The filters the endpoint does not offer, applied to the rows in hand.
///
/// `ghosts` inverts the usual filter and returns ONLY identity-less rows.
/// Subscription status is deliberately absent: the page filters by status chip
/// over these same rows, and threading it through here only meant every chip
/// click re-fetched a list that was about to be filtered again anyway.
///
/// Staff accounts are dropped outright. `role` is a legacy mirror — authority is
/// the `adm` claim, never this column — but it is the only signal a LIST has for
/// recognising other admins, since one account cannot read another's claims.
export function filterUsers(
  rows: UserRow[],
  filters: {
    platformFilter: PlatformFilter;
    ghosts: boolean;
    startDate?: Date | null;
    endDate?: Date | null;
  },
): UserRow[] {
  return rows.filter((row) => {
    const ghost = row.calculatedStatus === 'Ghost';
    if (filters.ghosts) return ghost;
    if (ghost || isAdminUserData(row)) return false;
    if (!matchesPlatform(row, filters.platformFilter)) return false;

    if (filters.startDate || filters.endDate) {
      const createdAt = toDate(row.createdAt)?.getTime();
      if (createdAt == null) return false;
      if (filters.startDate && createdAt < filters.startDate.getTime()) return false;
      if (filters.endDate && createdAt > filters.endDate.getTime() + DAY_MS) return false;
    }
    return true;
  });
}

/// One API record → one Exits row.
///
/// Exported for the unit suite: the derived `label` and the blank-reason
/// fallback are display decisions, and display decisions are what go wrong
/// without any request failing.
export function parseDeletionRow(raw: Json): DeletionRow {
  const uid = String(raw.uid ?? '');
  const email = raw.email != null && String(raw.email).trim() !== '' ? String(raw.email) : null;
  const reason = raw.reason != null && String(raw.reason).trim() !== '' ? String(raw.reason) : null;

  return {
    uid,
    email,
    label: email != null && email.includes('@') ? email.split('@')[0] : `User_${uid.slice(0, 5)}`,
    reason: reason ?? 'No reason provided',
    date: toDate(raw.deletedAt),
    source: raw.source != null ? String(raw.source) : null,
  };
}

/// The endpoint's own ceiling, as with the user table.
export const DELETIONS_PAGE_SIZE = 200;

export type DeletionRecordsPage = {
  records: DeletionRow[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
};

/// One page of exit feedback, newest first.
///
/// Was a fan-out of four Firestore `onSnapshot` listeners — one per historical
/// spelling of the collection — merged and de-duplicated by uid in the browser.
/// The migration folded all four into `deletion_reasons` with uid as its primary
/// key, so there is nothing left to merge or de-duplicate: the row's `source`
/// records which spelling it came from, and the server orders and pages it.
export async function fetchDeletionRecordsPage(
  params: { limit?: number; offset?: number } = {},
): Promise<DeletionRecordsPage> {
  if (!currentUserCan('users:read')) throw new Error('Unauthorized access');

  const limit = Math.min(params.limit ?? DELETIONS_PAGE_SIZE, DELETIONS_PAGE_SIZE);
  const offset = params.offset ?? 0;
  const json = await adminApi.listDeletionRecords({ limit, offset });

  const records = ((json.records as Json[]) ?? []).map(parseDeletionRow);
  return {
    records,
    total: typeof json.total === 'number' ? json.total : records.length,
    limit,
    offset,
    hasMore: json.hasMore === true,
  };
}

/// The joined-date window, applied to the rows in hand — the endpoint pages and
/// orders but does not filter.
///
/// A row with no `deletedAt` is dropped once a range is set rather than being
/// treated as today, for the same reason a user with no `createdAt` is: the
/// alternative is a row that silently answers a question it has no data for.
export function filterDeletionRecords(
  rows: DeletionRow[],
  range: { startDate?: Date | null; endDate?: Date | null },
): DeletionRow[] {
  if (!range.startDate && !range.endDate) return rows;
  return rows.filter((r) => {
    if (r.date == null) return false;
    const at = r.date.getTime();
    if (range.startDate && at <= range.startDate.getTime()) return false;
    if (range.endDate && at >= range.endDate.getTime() + DAY_MS) return false;
    return true;
  });
}

/// Removes one exit-feedback row.
///
/// Keyed by the uid of the account that left, because `deletion_reasons` has uid
/// as its primary key — the (collection, docId) pair the Firestore version
/// needed identifies nothing server-side. It deletes no user data and cannot:
/// that account is already gone, which is what wrote the row. It does move the
/// churn tally on the conversion report, so the server audits it.
export async function deleteDeletionRecord(uid: string): Promise<void> {
  if (!currentUserCan('users:write')) throw new Error('Unauthorized access');
  await adminApi.deleteDeletionRecord(uid);
}

/// Permanent deletion: the user's data AND their Auth account, in one audited
/// server-side operation.
///
/// Was a bare `deleteDoc` on the user document, which left the Auth account able
/// to sign back in and a live Razorpay mandate still charging. The server
/// cascades every user-scoped table, cancels the subscription first, and refuses
/// to delete an admin or the caller themselves.
export async function deleteUser(uid: string): Promise<void> {
  if (!currentUserCan('users:write')) throw new Error('Unauthorized access');
  await adminApi.deleteUser(uid);
}

/// `months` expressed as a day count, keeping the expiry date the old client-side
/// arithmetic produced (same day-of-month, N months on) — the endpoint grants in
/// days, and treating a month as 30 days would drift a year's grant by five.
/// Rounded UP, so the conversion never shortens a grant.
///
/// Exported for the unit suite: month-length arithmetic is the kind of thing
/// that is only wrong in February.
export function grantDaysForMonths(months: number, now = new Date()): number {
  let year = now.getFullYear();
  let month = now.getMonth() + 1 + months;
  while (month > 12) {
    year++;
    month -= 12;
  }
  const expiry = new Date(year, month - 1, now.getDate());
  return Math.max(1, Math.ceil((expiry.getTime() - now.getTime()) / DAY_MS));
}

/// Manual subscription change. `days` wins over `months` when both are given,
/// matching the Flutter service.
///
/// The panel no longer writes entitlement fields itself — it asks the server,
/// which owns them (there is exactly one code path that sets `isPremium`,
/// `subscriptionTier` and `subscriptionEndDate`, and this is not it). Two
/// consequences worth knowing at the call site, both surfaced as the server's
/// own message:
///   - a grant is REFUSED (409) when the user already holds an active paid
///     subscription, where the direct write would silently overwrite it;
///   - `None` is a provider-aware cancel, so an Apple subscription is refused
///     rather than quietly cleared while the App Store keeps charging.
export async function updateUserSubscription(
  uid: string,
  tier: 'Premium' | 'Basic' | 'Trial' | 'None',
  opts: { months?: number; days?: number } = {},
): Promise<void> {
  if (!currentUserCan('billing:write')) throw new Error('Unauthorized access');

  if (tier === 'None') {
    // `immediate` because the old write cleared the entitlement fields outright,
    // taking access away at once.
    await adminApi.updateUserSubscription(uid, { action: 'cancel', immediate: true });
    return;
  }

  if (tier === 'Trial') {
    // Refused rather than approximated. The old write set `trialStartDate` and a
    // seven-day end date on a FREE account — not an entitlement grant — and the
    // server's grant takes Basic or Premium only. Granting Basic for seven days
    // instead would entitle the user to content a trial never gave them, so the
    // gap is named here instead of being papered over.
    throw new ApiException(
      0,
      'unsupported_tier',
      'Trials can no longer be granted from the panel: the API grants Basic or Premium only.',
    );
  }

  const { months = 1, days = 0 } = opts;
  await adminApi.updateUserSubscription(uid, {
    action: 'grant',
    tier,
    days: days > 0 ? days : grantDaysForMonths(months),
  });
}

/// Points a user's avatar at an already-hosted image.
///
/// The server accepts an https URL or a `profile_photos/…` blob path and rejects
/// anything else — a `data:` URI, a relative path — rather than storing a value
/// that renders as a broken avatar on someone's phone. It also 404s on a uid
/// that no longer exists instead of upserting a phantom account, which the
/// browser-side `updateDoc` could not distinguish.
export async function updateProfilePhoto(uid: string, photoUrl: string): Promise<void> {
  if (!currentUserCan('users:write')) throw new Error('Unauthorized access');
  await adminApi.setUserProfilePhoto(uid, photoUrl);
}

/// Uploads photo bytes, then records the resulting URL through the API.
///
/// The BYTES still go to Firebase Storage at `user_profiles/{uid}.jpg`. That is
/// not a Firestore write, and there is nowhere else to send it: the only
/// bytes-accepting photo endpoint is `POST /api/profile/photo`, which streams to
/// Azure under the CALLER's own verified uid — the user's own route, unusable by
/// an admin acting on someone else's account. Only the metadata write moved, and
/// a Storage download URL is https, which is one of the two forms the API takes.
export async function uploadAndSyncProfilePhoto(uid: string, file: Blob): Promise<string> {
  if (!currentUserCan('users:write')) throw new Error('Unauthorized access');

  let downloadUrl: string;
  try {
    const objectRef = ref(storage, `user_profiles/${uid}.jpg`);
    const task = await uploadBytes(objectRef, file, { contentType: 'image/jpeg' });
    downloadUrl = await getDownloadURL(task.ref);
  } catch (e) {
    throw new Error(`Photo upload failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Outside the catch on purpose: if the API rejects the URL it says why, and
  // relabelling that as an upload failure would hide the reason.
  await updateProfilePhoto(uid, downloadUrl);
  return downloadUrl;
}

/// Clears the avatar field. The blob is left in place — a field is cheap to set
/// again, an unrecoverable image is not, and a Google-hosted photo URL was never
/// ours to delete.
export async function deleteProfilePhoto(uid: string): Promise<void> {
  if (!currentUserCan('users:write')) throw new Error('Unauthorized access');
  await adminApi.deleteUserProfilePhoto(uid);
}

const CSV_HEADER = [
  'S.No', 'User ID', 'Username', 'Email', 'Phone', 'City', 'Platform', 'Joined Date',
  'Status', 'Gender', 'Age', 'Height(cm)', 'Weight(kg)', 'BMI',
  'Goal', 'Diet', 'Exp Level', 'Activity', 'Workout Time',
  'Calories', 'Total Workouts',
];

/// Export rows, header included, in the column order the Google Sheet expects —
/// the Sheet maps by position, so a column may go empty but must never move.
///
/// Two columns changed source rather than meaning: `City` reads `cityTown` and
/// `Calories` reads `maintenanceCalories`, the names the assessment shape uses
/// everywhere else in the codebase.
///
/// Exported for the unit suite: a column mapping is exactly the thing that goes
/// wrong silently.
export function csvRowsFromUsers(users: Json[]): unknown[][] {
  const rows: unknown[][] = [CSV_HEADER];

  users.forEach((data, i) => {
    const email = data.email != null ? String(data.email) : 'No email';
    let username = data.username != null && String(data.username).trim() !== '' ? String(data.username) : 'User';
    if (username === 'User') username = email.split('@')[0];

    const joined = toDate(data.createdAt);

    rows.push([
      i + 1,
      data.uid ?? '',
      username,
      email,
      data.phoneNumber ?? '-',
      data.cityTown ?? '-',
      data.platform ?? 'Android',
      joined != null ? fmtDateDashed(joined) : '-',
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
      data.maintenanceCalories ?? '-',
      data.totalWorkouts ?? '0',
    ]);
  });

  return rows;
}

export type UsersCsvData = {
  rows: unknown[][];
  /// The export hit the server's row cap — the file is incomplete. The caller
  /// must say so rather than handing over a partial spreadsheet as if it were
  /// the whole table.
  truncated: boolean;
  limit: number;
};

/// Filtered user list flattened for CSV export.
///
/// One request to `GET /api/admin/users/export` instead of a whole-collection
/// read; platform and joined-date are applied here because the endpoint filters
/// on `search` only.
export async function getUsersCsvData(
  opts: {
    platformFilter?: PlatformFilter;
    search?: string | null;
    startDate?: Date | null;
    endDate?: Date | null;
  } = {},
): Promise<UsersCsvData> {
  const { platformFilter = 'Overall', search, startDate, endDate } = opts;
  const exported = await fetchAllUsers(search);

  const users = exported.rows.filter((data) => {
    // Staff accounts are not customers, and a CSV that counts them is a CSV
    // every downstream number is quietly wrong from.
    if (isAdminUserData(data)) return false;
    if (!matchesPlatform(data, platformFilter)) return false;

    // A row with neither an email nor a join date carries nothing worth
    // exporting. Every key is now always present, null where unset, so this
    // tests the values rather than the keys.
    if (data.email == null && data.createdAt == null) return false;

    if (!startDate) return true;
    const createdAt = toDate(data.createdAt)?.getTime();
    if (createdAt == null) return false;
    let inRange = createdAt >= startDate.getTime() - 1000;
    if (endDate) inRange = inRange && createdAt < endDate.getTime() + DAY_MS;
    return inRange;
  });

  return { rows: csvRowsFromUsers(users), truncated: exported.truncated, limit: exported.limit };
}

export type SheetsSyncResult = {
  sent: boolean;
  /// The rows that were sent were already incomplete — the sheet now holds a
  /// partial table. Reported separately from `sent` because the POST succeeding
  /// is not the same as the sheet being right.
  truncated: boolean;
};

/// Push the filtered export to a Google Apps Script endpoint.
///
/// The rows come from the API's export endpoint now, so the sheet is built from
/// live data rather than a frozen Firestore snapshot.
///
/// `no-cors` is deliberate: Apps Script web apps answer with a 302 to a
/// googleusercontent.com URL that sends no CORS headers, so the browser can
/// never read the response. The POST still arrives, so success here means
/// "sent", not "confirmed stored".
export async function syncToGoogleSheets(
  scriptUrl: string,
  opts: {
    platformFilter?: PlatformFilter;
    search?: string | null;
    startDate?: Date | null;
    endDate?: Date | null;
  } = {},
): Promise<SheetsSyncResult> {
  try {
    const { rows, truncated } = await getUsersCsvData(opts);
    await fetch(scriptUrl, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(rows),
    });
    return { sent: true, truncated };
  } catch {
    return { sent: false, truncated: false };
  }
}
