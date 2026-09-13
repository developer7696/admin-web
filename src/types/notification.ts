import { toDateOrNow } from '@/lib/format';

/// A push campaign, as the backend returns it.
///
/// The lifecycle is the thing to keep in mind reading this file: `draft` →
/// `scheduled` → `sending` → `sent`, with `cancelled` reachable from the first
/// two and `failed` from a send that exhausted its retries. Only `draft` and
/// `scheduled` are editable — once a campaign is `sending` it is on its way to
/// real phones and cannot be called back.
export type NotificationStatus =
  | 'draft'
  | 'scheduled'
  | 'sending'
  | 'sent'
  | 'failed'
  | 'cancelled';

export type NotificationCategory =
  | 'recipe'
  | 'program'
  | 'article'
  | 'exercise'
  | 'announcement'
  | 'reminder'
  | 'system';

/// Where tapping the notification lands in the app.
export type NotificationDeeplink = {
  type: 'recipe' | 'program' | 'article' | 'exercise';
  targetId: string;
};

/// Who the campaign goes to, as a PREDICATE rather than a resolved list.
///
/// A discriminated union on purpose: "everyone" has to be stated as
/// `{kind:'all'}`, so there is no shape that reaches the entire user base by
/// having forgotten to fill something in.
export type NotificationAudience =
  | { kind: 'all' }
  | {
      kind: 'segment';
      tier?: 'premium' | 'basic' | 'free';
      platform?: 'ios' | 'android';
      program?: string;
      assessmentCompleted?: boolean;
    }
  | { kind: 'users'; uids: string[] };

export type NotificationModel = {
  id: string;
  title: string;
  body: string;
  imageUrl: string | null;
  category: NotificationCategory;
  deeplink: NotificationDeeplink | null;
  audience: NotificationAudience;
  status: NotificationStatus;
  scheduledAt: Date | null;
  sentAt: Date | null;

  /// `manual`, or `auto:<rule key>` for one raised by a publish.
  source: string;
  sourceRef: string | null;
  createdBy: string | null;

  /// How many accounts it reached, and how the push went. All zero until it
  /// has been sent.
  recipientCount: number;
  pushSent: number;
  pushFailed: number;

  attempts: number;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/// An auto-on-publish template.
export type NotificationRule = {
  key: string;
  enabled: boolean;
  titleTemplate: string;
  bodyTemplate: string;
  category: NotificationCategory;
  audience: NotificationAudience;
  updatedAt: Date;
  updatedBy: string | null;
};

/// What an audience resolves to, before anything is sent.
export type AudiencePreview = {
  count: number;
  sample: { uid: string; email: string | null; username: string | null }[];
};

const int = (v: unknown) => (typeof v === 'number' ? Math.trunc(v) : 0);
const strOrNull = (v: unknown) => (v == null ? null : String(v));
const dateOrNull = (v: unknown) => (v == null ? null : toDateOrNow(v));

/// Default to `{kind:'all'}` only when the field is missing entirely — a row
/// written before this shape existed. A malformed audience is NOT silently
/// widened to everyone.
function parseAudience(v: unknown): NotificationAudience {
  if (v && typeof v === 'object' && 'kind' in v) {
    return v as NotificationAudience;
  }
  return { kind: 'all' };
}

export function parseNotification(json: Record<string, unknown>): NotificationModel {
  return {
    id: String(json.id ?? ''),
    title: String(json.title ?? ''),
    body: String(json.body ?? ''),
    imageUrl: strOrNull(json.imageUrl),
    category: (json.category as NotificationCategory) ?? 'announcement',
    deeplink: (json.deeplink as NotificationDeeplink | null) ?? null,
    audience: parseAudience(json.audience),
    status: (json.status as NotificationStatus) ?? 'draft',
    scheduledAt: dateOrNull(json.scheduledAt),
    sentAt: dateOrNull(json.sentAt),
    source: String(json.source ?? 'manual'),
    sourceRef: strOrNull(json.sourceRef),
    createdBy: strOrNull(json.createdBy),
    recipientCount: int(json.recipientCount),
    pushSent: int(json.pushSent),
    pushFailed: int(json.pushFailed),
    attempts: int(json.attempts),
    lastError: strOrNull(json.lastError),
    createdAt: toDateOrNow(json.createdAt),
    updatedAt: toDateOrNow(json.updatedAt),
  };
}

export function parseRule(json: Record<string, unknown>): NotificationRule {
  return {
    key: String(json.key ?? ''),
    enabled: json.enabled === true,
    titleTemplate: String(json.titleTemplate ?? ''),
    bodyTemplate: String(json.bodyTemplate ?? ''),
    category: (json.category as NotificationCategory) ?? 'announcement',
    audience: parseAudience(json.audience),
    updatedAt: toDateOrNow(json.updatedAt),
    updatedBy: strOrNull(json.updatedBy),
  };
}

/// Can this campaign still be edited or called off?
export const isEditable = (n: NotificationModel): boolean =>
  n.status === 'draft' || n.status === 'scheduled';

/// Human labels. Kept beside the union so a new status cannot be added without
/// this list being the obvious next place to look.
export const STATUS_LABELS: Record<NotificationStatus, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  sending: 'Sending',
  sent: 'Sent',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  recipe: 'Recipe',
  program: 'Program',
  article: 'Article',
  exercise: 'Exercise',
  announcement: 'Announcement',
  reminder: 'Reminder',
  system: 'System',
};

/// Categories an admin may compose under. `system` is excluded: it bypasses
/// every user's mute settings, so it is for account and security messages the
/// server raises, not for anything typed into a form.
export const COMPOSABLE_CATEGORIES: NotificationCategory[] = [
  'announcement',
  'recipe',
  'program',
  'article',
  'exercise',
  'reminder',
];
