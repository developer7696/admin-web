import { currentUserCan } from '@/auth/admin-auth';
import { adminApi, ApiException, type Json } from '@/lib/api-client';
import { putToAzure } from '@/services/exercise-catalog-repository';
import type { NotificationAudience, NotificationDeeplink } from '@/types/notification';

/**
 * Composing and sending a push campaign.
 *
 * The `currentUserCan` pre-checks here are a courtesy, not the boundary — the
 * server enforces `notifications:write` on every one of these routes. They exist
 * so a UI bug shows as a clear message rather than a 403 from a request that
 * should never have been made.
 */

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * Permit → PUT → confirm, the same three steps as recipe and article images.
 *
 * The confirm writes `imageUrl` onto the campaign server-side, after Azure has
 * been asked whether the bytes actually arrived — so this does not patch the
 * campaign itself, and a failure throws rather than quietly leaving a campaign
 * that will render a broken image on every phone.
 */
async function uploadImage(file: Blob, notificationId: string): Promise<void> {
  const extension = EXT_BY_TYPE[file.type];
  if (!extension) {
    throw new ApiException(0, 'unsupported_media_type', 'Images must be JPEG, PNG or WebP.');
  }

  const ticket = await adminApi.notificationImageUploadUrl(notificationId, extension);
  const uploadUrl = String(ticket.uploadUrl ?? '');
  const path = String(ticket.path ?? '');
  if (!uploadUrl || !path) {
    throw new ApiException(0, 'upload_ticket', 'The server did not return an upload URL.');
  }

  await putToAzure(uploadUrl, String(ticket.contentType ?? file.type), file);
  await adminApi.notificationImageUploadConfirm(notificationId, path);
}

export type ComposeInput = {
  title: string;
  body: string;
  category: string;
  audience: NotificationAudience;
  deeplink?: NotificationDeeplink | null;
  /// Omitted or null means "hold as a draft". A time in the past is refused by
  /// the server rather than firing immediately.
  scheduledAt?: string | null;
  imageFile?: Blob | null;
};

/**
 * Create a campaign. NOTHING IS SENT BY THIS.
 *
 * The campaign is created first so the image has an id to live under, matching
 * how articles and recipes do it.
 */
export async function createNotification(input: ComposeInput): Promise<string> {
  if (!currentUserCan('notifications:write')) throw new Error('Unauthorized access');

  const body: Json = {
    title: input.title.trim(),
    body: input.body.trim(),
    category: input.category,
    audience: input.audience,
  };
  if (input.deeplink) body.deeplink = input.deeplink;
  if (input.scheduledAt) body.scheduledAt = input.scheduledAt;

  const created = await adminApi.createNotification(body);
  const id = String((created.notification as Record<string, unknown> | undefined)?.id ?? '');
  if (!id) throw new ApiException(0, 'create_failed', 'The server did not return a notification.');

  if (input.imageFile) {
    await uploadImage(input.imageFile, id);
  }
  return id;
}

/** Patch a campaign that has not gone out. The server 409s if it has. */
export async function updateNotification(
  id: string,
  patch: Partial<ComposeInput>,
): Promise<void> {
  if (!currentUserCan('notifications:write')) throw new Error('Unauthorized access');

  const body: Json = {};
  if (patch.title !== undefined) body.title = patch.title.trim();
  if (patch.body !== undefined) body.body = patch.body.trim();
  if (patch.category !== undefined) body.category = patch.category;
  if (patch.audience !== undefined) body.audience = patch.audience;
  // `null` CLEARS the deeplink; omitting it leaves what is stored.
  if (patch.deeplink !== undefined) body.deeplink = patch.deeplink;
  // Clearing `scheduledAt` demotes a scheduled campaign back to a draft, which
  // is how a send is called off without discarding the copy.
  if (patch.scheduledAt !== undefined) body.scheduledAt = patch.scheduledAt;

  if (Object.keys(body).length > 0) {
    await adminApi.updateNotification(id, body);
  }
  if (patch.imageFile) {
    await uploadImage(patch.imageFile, id);
  }
}

/**
 * Send to the calling admin's own devices only.
 *
 * The guardrail before an unrecallable action, and the one call here that is
 * safe to make freely.
 */
export async function sendTest(id: string): Promise<{ pushSent: number; pushFailed: number }> {
  if (!currentUserCan('notifications:write')) throw new Error('Unauthorized access');
  const res = await adminApi.testNotification(id);
  return {
    pushSent: Number(res.pushSent ?? 0),
    pushFailed: Number(res.pushFailed ?? 0),
  };
}
