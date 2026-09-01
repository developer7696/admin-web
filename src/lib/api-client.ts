import { auth } from './firebase';

/// Deployed API by default. Overridable so the panel can be pointed at a local
/// server — needed whenever it depends on an endpoint that has not shipped yet,
/// which is otherwise a "Route not found" against production.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'https://api.aarambh.app';

const NETWORK_MESSAGE =
  "Couldn't reach the server. Please check your internet connection and try again.";
const TIMEOUT_MESSAGE = 'The server took too long to respond. Please try again in a moment.';

/// Total budget for one request, matching the Flutter client's 20s.
const REQUEST_TIMEOUT_MS = 20_000;
/// Uploads stream a file body, so they get the longer budget the Dart client
/// gave `_sendBytes`.
const UPLOAD_TIMEOUT_MS = 60_000;

/// Thrown when the backend returns a non-2xx response. Carries the backend's
/// error `code` and human `message` so the UI can react.
export class ApiException extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'ApiException';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export type Json = Record<string, unknown>;

/// `YYYY-MM-DD` in local time. `toISOString()` would convert to UTC first, so an
/// admin in IST picking the 21st would send the 20th for anything before 05:30.
const localDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function fallbackForStatus(status: number): string {
  if (status >= 500) {
    return 'Our servers are having a problem right now. Please try again in a few minutes.';
  }
  if (status === 401 || status === 403) {
    return 'Your session has expired. Please sign in again.';
  }
  return 'Something went wrong. Please try again.';
}

/// The response body as an object.
///
/// The server does not always label JSON as JSON, so a body that IS json but
/// arrives as text/plain is decoded anyway — that is what keeps `error.code`
/// reachable, and without it a mislabelled 409 loses `exercise_exists` and the
/// form shows a generic failure instead of "that id is already taken".
///
/// A 204 gives no body and a proxy error page gives HTML; neither is worth
/// surfacing as a parse error, so both fall through to `{}` and the status code
/// decides what happens next.
async function asMap(res: Response): Promise<Json> {
  let text: string;
  try {
    text = await res.text();
  } catch {
    return {};
  }
  if (!text) return {};
  try {
    const decoded: unknown = JSON.parse(text);
    if (decoded && typeof decoded === 'object' && !Array.isArray(decoded)) {
      return decoded as Json;
    }
  } catch {
    // Not JSON — HTML from a proxy, or a plain-text error.
  }
  return {};
}

async function idToken(forceRefresh: boolean): Promise<string> {
  const user = auth.currentUser;
  if (!user) {
    throw new ApiException(401, 'no_user', 'You are not signed in. Please sign in and try again.');
  }
  try {
    const token = await user.getIdToken(forceRefresh);
    if (!token) {
      throw new ApiException(401, 'auth', 'Your session has expired. Please sign in again.');
    }
    return token;
  } catch (e) {
    if (e instanceof ApiException) throw e;
    const code = (e as { code?: string })?.code;
    if (code === 'auth/network-request-failed') {
      throw new ApiException(0, 'network', NETWORK_MESSAGE);
    }
    throw new ApiException(401, 'auth', 'Your session has expired. Please sign in again.');
  }
}

function throwFromError(e: unknown): never {
  if (e instanceof ApiException) throw e;
  if (e instanceof DOMException && e.name === 'AbortError') {
    throw new ApiException(0, 'timeout', TIMEOUT_MESSAGE);
  }
  throw new ApiException(0, 'network', NETWORK_MESSAGE);
}

async function fetchWithTimeout(
  path: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${API_BASE_URL}${path}`, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/// Core request. Attempt 0 uses the current token; attempt 1 force-refreshes it,
/// which is what makes an expired session recover instead of bouncing the admin
/// to the login screen mid-edit.
async function send(
  method: string,
  path: string,
  body?: unknown,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Json> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await idToken(attempt === 1);

    let res: Response;
    try {
      res = await fetchWithTimeout(
        path,
        {
          method,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        },
        timeoutMs,
      );
    } catch (e) {
      throwFromError(e);
    }

    if (res.status === 401 && attempt === 0) {
      continue; // token likely expired — refresh and retry once
    }

    const json = await asMap(res);
    if (res.ok) return json;

    const error = json.error as { code?: unknown; message?: unknown } | undefined;
    throw new ApiException(
      res.status,
      error?.code != null ? String(error.code) : 'error',
      error?.message != null ? String(error.message) : fallbackForStatus(res.status),
    );
  }
  throw new ApiException(401, 'unauthorized', 'Your session has expired. Please sign in again.');
}

/// Binary POST (cover images). Same auth/401 retry as `send`, but the body is
/// the file itself — JSON-encoding it would corrupt the bytes and Azure would
/// store garbage.
async function sendBytes(
  path: string,
  bytes: ArrayBuffer | Uint8Array | Blob,
  contentType: string,
): Promise<Json> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await idToken(attempt === 1);

    let res: Response;
    try {
      res = await fetchWithTimeout(
        path,
        {
          method: 'POST',
          headers: { 'Content-Type': contentType, Authorization: `Bearer ${token}` },
          body: bytes as BodyInit,
        },
        UPLOAD_TIMEOUT_MS,
      );
    } catch (e) {
      throwFromError(e);
    }

    if (res.status === 401 && attempt === 0) continue;

    const json = await asMap(res);
    if (res.ok) return json;

    const error = json.error as { code?: unknown; message?: unknown } | undefined;
    throw new ApiException(
      res.status,
      error?.code != null ? String(error.code) : 'error',
      error?.message != null ? String(error.message) : fallbackForStatus(res.status),
    );
  }
  throw new ApiException(401, 'unauthorized', 'Your session has expired. Please sign in again.');
}

/// Thin client for the Aarambh backend's admin endpoints. Every request is
/// authenticated with the current Firebase ID token; on a 401 the token is
/// refreshed once and retried. There is deliberately one client and one base
/// URL for the whole panel — the auth header, the 401 retry and the error
/// unwrapping exist in exactly one place.
export const adminApi = {
  // ── Billing ───────────────────────────────────────────────────────────────

  /// Full billing picture for one user: firestore state, webhook events, audit
  /// log, and LIVE Razorpay subscription + invoices + payments.
  paymentHistory: (uid: string) => send('GET', `/api/admin/users/${uid}/payment-history`),

  /// Refund one of the user's subscription payments. Full refund unless
  /// `amountPaise` is given (partial, in paise: 500 = Rs 5).
  refundPayment: (args: { uid: string; paymentId: string; amountPaise?: number; reason?: string }) =>
    send('POST', `/api/admin/users/${args.uid}/refund`, {
      paymentId: args.paymentId,
      ...(args.amountPaise != null ? { amountPaise: args.amountPaise } : {}),
      ...(args.reason ? { reason: args.reason } : {}),
    }),

  // ── Dashboard ─────────────────────────────────────────────────────────────

  /// Application-analytics overview for the home screen: audience, signup
  /// growth, training activity, subscription mix, running trials and alerts.
  ///
  /// A full `users` scan like the conversion report, so it gets the same longer
  /// budget. `cohort` decides whether internal and QA accounts are counted.
  /// `from`/`to` select a signup cohort; omitting them means all time. Dates are
  /// sent as plain `YYYY-MM-DD` in the admin's own timezone — an ISO instant
  /// would shift the boundary by the UTC offset and silently move a day's
  /// signups into the neighbouring bucket.
  dashboardOverview: (query: {
    cohort: 'customers' | 'all';
    platform: 'all' | 'ios' | 'android';
    from: Date | null;
    to: Date | null;
  }) => {
    const qs = new URLSearchParams({ cohort: query.cohort, platform: query.platform });
    if (query.from) qs.set('from', localDate(query.from));
    if (query.to) qs.set('to', localDate(query.to));
    return send('GET', `/api/admin/dashboard?${qs.toString()}`, undefined, 60_000);
  },

  // ── Conversion ────────────────────────────────────────────────────────────
  // Full-collection scans. The backend re-reads Firestore on every call.

  /// Live trial/subscriber report of every user document.
  conversionReport: () => send('GET', '/api/admin/conversion', undefined, 60_000),

  /// Live Razorpay + Apple webhook evidence. Fetched only when the Payments tab opens.
  conversionPayments: () => send('GET', '/api/admin/conversion/payments', undefined, 60_000),

  // ── Apple subscription links ──────────────────────────────────────────────
  // An Apple subscription belongs to an Apple ID, not to an app account, so the
  // backend claims it for the FIRST account that validates it. A user with two
  // sign-ins then hits "already linked to another account" forever.

  /// Which account owns an Apple subscription. `linked: false` means nobody
  /// claimed it.
  appleLink: (originalTransactionId: string) =>
    send('GET', `/api/admin/apple/link/${originalTransactionId}`),

  /// MOVE an Apple subscription to `toUid`. The previous owner drops to Free in
  /// the same transaction — one Apple subscription entitles one account.
  transferAppleLink: (args: { originalTransactionId: string; toUid: string; reason?: string }) =>
    send('POST', `/api/admin/apple/link/${args.originalTransactionId}/transfer`, {
      toUid: args.toUid,
      ...(args.reason ? { reason: args.reason } : {}),
    }),

  // ── Workouts ──────────────────────────────────────────────────────────────
  // The panel used to walk `users/{uid}/programs/{p}/weeks/{w}/days/{d}` from
  // the browser — over a hundred sequential round trips for one active user,
  // and no way at all to ask "who trained today" across users. Both questions
  // are answered server-side now.

  /// Cross-user feed of completed sessions, newest first. Cursor-paged: pass
  /// the previous response's `nextCursor` back as `cursor`; null means the end.
  ///
  /// `from`/`to` go as plain `YYYY-MM-DD` in the admin's own timezone, with the
  /// offset alongside — an ISO instant would shift the boundary and move an
  /// evening workout into the neighbouring day.
  workoutLogs: (query: {
    limit?: number;
    cursor?: string | null;
    from?: Date | null;
    to?: Date | null;
    uid?: string | null;
  }) => {
    const qs = new URLSearchParams({
      limit: String(query.limit ?? 50),
      utcOffsetMinutes: String(-new Date().getTimezoneOffset()),
    });
    if (query.cursor) qs.set('cursor', query.cursor);
    if (query.from) qs.set('from', localDate(query.from));
    if (query.to) qs.set('to', localDate(query.to));
    if (query.uid) qs.set('uid', query.uid);
    return send('GET', `/api/admin/workouts/logs?${qs.toString()}`, undefined, 45_000);
  },

  /// One user's stats and session history. `full: false` omits the per-exercise
  /// sets, which is four fewer Firestore reads per session.
  userWorkouts: (uid: string, query?: { days?: number; full?: boolean }) => {
    const qs = new URLSearchParams({
      days: String(query?.days ?? 90),
      full: String(query?.full ?? true),
    });
    return send('GET', `/api/admin/workouts/users/${uid}?${qs.toString()}`, undefined, 45_000);
  },

  /// One session's exercise detail, for a feed row the admin expanded.
  workoutSession: (args: {
    uid: string;
    programId: string;
    weekId: string;
    dayId: string;
  }) =>
    send(
      'GET',
      `/api/admin/workouts/users/${args.uid}/sessions/${args.programId}/${args.weekId}/${args.dayId}`,
    ),

  // ── Articles ──────────────────────────────────────────────────────────────

  /// Every article newest-first, plus aggregate stats and the category list.
  listArticles: () => send('GET', '/api/admin/articles'),
  createArticle: (body: Json) => send('POST', '/api/admin/articles', body),
  /// Partial update: omit a field to leave it alone, send `imageUrl: null` to
  /// clear it.
  updateArticle: (id: string, body: Json) => send('PATCH', `/api/admin/articles/${id}`, body),
  deleteArticle: (id: string) => send('DELETE', `/api/admin/articles/${id}`),

  // ── Media signing ─────────────────────────────────────────────────────────

  /// Short-lived SAS URLs for arbitrary Azure blob paths.
  ///
  /// The exercise catalogue endpoint only signs media it can reach through an
  /// exercise document. Program and session images are bare asset paths that
  /// belong to no exercise, so they need signing by path instead. Returns
  /// `{path: url}` for whatever it could resolve.
  signMedia: async (paths: string[]): Promise<Record<string, string>> => {
    if (paths.length === 0) return {};
    const json = await send('POST', '/api/media/sign', { paths });
    const out: Record<string, string> = {};
    for (const a of (json.assets as unknown[]) ?? []) {
      const asset = a as { path?: unknown; url?: unknown };
      if (typeof asset.path === 'string' && typeof asset.url === 'string') {
        out[asset.path] = asset.url;
      }
    }
    return out;
  },

  // ── Exercise catalogue ────────────────────────────────────────────────────

  /// The catalogue with each exercise's video and image resolved to their real
  /// Azure Blob locations, plus short-lived SAS URLs for previewing them.
  ///
  /// Capped at 30/min server-side and signs ~314 SAS URLs per call — fetch it
  /// after a mutation, never per render.
  exerciseCatalog: (sign = true) => send('GET', `/api/admin/exercise-catalog?sign=${sign}`),

  /// Create one exercise. Throws `exercise_exists` (409) if the id is taken —
  /// ids are referenced by schedules and history, so a collision is never
  /// silently merged.
  createExercise: (body: Json) => send('POST', '/api/admin/exercise-catalog', body),

  /// Update one exercise. Omit a field to leave it alone; send it as `null` to
  /// CLEAR it. Media is re-resolved whenever a filename is included.
  updateExercise: (id: string, body: Json) => send('PUT', `/api/admin/exercise-catalog/${id}`, body),

  /// Remove an exercise. 404 if already gone; 409 if a program still names it.
  deleteExercise: (id: string) => send('DELETE', `/api/admin/exercise-catalog/${id}`),

  /// Ask for a short-lived write URL to upload one exercise file. Only the
  /// extension is sent — the server decides the blob path.
  exerciseUploadUrl: (id: string, kind: string, extension: string) =>
    send('POST', `/api/admin/exercise-catalog/${id}/media/upload-url`, { kind, extension }),

  /// Tell the server the upload finished. It verifies with Azure before linking
  /// the blob to the exercise.
  exerciseUploadConfirm: (id: string, kind: string, path: string) =>
    send('POST', `/api/admin/exercise-catalog/${id}/media/confirm`, { kind, path }),

  // ── Program catalogue ─────────────────────────────────────────────────────

  /// Program summaries only — a listing with every week expanded would be
  /// megabytes.
  listPrograms: () => send('GET', '/api/admin/program-catalog'),
  getProgram: (id: string) => send('GET', `/api/admin/program-catalog/${id}`),

  /// Create a program. Throws `program_exists` (409) if the id is taken, and
  /// `unknown_exercise_codes` (400) if a session names an exercise that is not
  /// in the catalogue.
  createProgram: (body: Json) => send('POST', '/api/admin/program-catalog', body),

  /// Replace a program's content. `weeks` is replaced wholesale, so send the
  /// complete plan, not a patch.
  updateProgram: (id: string, body: Json) => send('PUT', `/api/admin/program-catalog/${id}`, body),
  deleteProgram: (id: string) => send('DELETE', `/api/admin/program-catalog/${id}`),

  programCoverUploadUrl: (id: string, extension: string) =>
    send('POST', `/api/admin/program-catalog/${id}/cover/upload-url`, { extension }),
  programCoverUploadConfirm: (id: string, path: string) =>
    send('POST', `/api/admin/program-catalog/${id}/cover/confirm`, { path }),

  /// Upload cover bytes through the API. Azure blob CORS is not enabled, so the
  /// browser cannot PUT to the SAS URL itself.
  programCoverUpload: (args: {
    id: string;
    extension: string;
    bytes: ArrayBuffer | Uint8Array | Blob;
    contentType: string;
  }) =>
    sendBytes(
      `/api/admin/program-catalog/${args.id}/cover?extension=${encodeURIComponent(args.extension)}`,
      args.bytes,
      args.contentType,
    ),

  // ── Vouchers ──────────────────────────────────────────────────────────────
  // Two kinds: `entitlement` grants access directly (tier + days); `discount`
  // points at a discount that ALREADY exists in the Razorpay Dashboard or App
  // Store Connect. Neither can be created through their APIs, so those artefacts
  // come from the provider consoles first and are only referenced here.

  listVouchers: (args: { type?: string; status?: string; limit?: number } = {}) => {
    const qs = new URLSearchParams({ limit: String(args.limit ?? 200) });
    if (args.type) qs.set('type', args.type);
    if (args.status) qs.set('status', args.status);
    return send('GET', `/api/admin/vouchers?${qs.toString()}`);
  },
  voucherStats: () => send('GET', '/api/admin/vouchers/stats'),
  /// Who redeemed this voucher, newest first.
  voucherRedemptions: (id: string, limit = 100) =>
    send('GET', `/api/admin/vouchers/${id}/redemptions?limit=${limit}`),
  createVoucher: (body: Json) => send('POST', '/api/admin/vouchers', body),
  /// Partial update. `code` and `type` are immutable server-side — a redeemed
  /// voucher's meaning must not change under the users who already used it.
  updateVoucher: (id: string, body: Json) => send('PATCH', `/api/admin/vouchers/${id}`, body),
  /// Soft delete. Keeps the redemption ledger, and access already granted by
  /// this code is unaffected.
  deactivateVoucher: (id: string) => send('DELETE', `/api/admin/vouchers/${id}`),

  /// Status/priority lists for the complaints queue. Same document as the
  /// mobile submit-complaint categories (`GET /api/content/complaint-categories`).
  complaintCategories: () => send('GET', '/api/content/complaint-categories'),

  /// Tag chips and difficulty labels. Same document the app uses
  /// (`GET /api/content/recipe-filters`).
  recipeFilters: () => send('GET', '/api/content/recipe-filters'),

  /// Recipe image upload: same permit-then-confirm shape as program covers.
  /// The bytes go browser → Azure on the returned SAS URL; confirm is what
  /// writes `imageUrl` onto the recipe document, server-side.
  recipeImageUploadUrl: (id: string, extension: string) =>
    send('POST', `/api/admin/recipes/${id}/image/upload-url`, { extension }),
  recipeImageUploadConfirm: (id: string, path: string) =>
    send('POST', `/api/admin/recipes/${id}/image/confirm`, { path }),

  /// Article category chips. Same document the app uses
  /// (`GET /api/content/article-categories`).
  articleCategories: () => send('GET', '/api/content/article-categories'),

  // ── IAM (Super Admin) ─────────────────────────────────────────────────────
  // Who may use this panel, and for what. Reading the roster needs `iam:read`;
  // every write needs `iam:write`, which only Super Admin holds.

  /// The permission and role catalogue the SERVER enforces. Fetched rather than
  /// read from `auth/permissions.ts` so the screen shows what is actually being
  /// applied, not this build's copy of it.
  iamCatalog: () => send('GET', '/api/admin/iam/roles'),

  /// Everyone who holds - or held - admin access. Revoked rows are included,
  /// flagged with `revokedAt`.
  iamMembers: () => send('GET', '/api/admin/iam/members'),

  /// Resolve an email to an account before granting it access. 404 when no such
  /// account exists, which is the check against granting to a typo.
  iamLookup: (email: string) =>
    send('GET', `/api/admin/iam/lookup?email=${encodeURIComponent(email)}`),

  /// REPLACE a member's grant - send the complete set, not a patch. An omitted
  /// role is a removed role.
  iamSetMember: (uid: string, body: Json) => send('PUT', `/api/admin/iam/members/${uid}`, body),

  /// Revoke all access. Soft: the roster row survives with `revokedAt` set, so
  /// "who used to have access" stays answerable.
  iamRevokeMember: (uid: string, reason?: string) =>
    send('DELETE', `/api/admin/iam/members/${uid}`, reason ? { reason } : {}),
};
