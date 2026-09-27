import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api-client';

/// A stored photo that is a blob path rather than a URL, and so needs signing.
export const isStoredPhotoPath = (photo: string | null | undefined): photo is string =>
  typeof photo === 'string' && photo.startsWith('profile_photos/');

/// How long a signed photo URL is reused before asking again. The server signs
/// for days; an hour keeps the panel well inside that.
const SIGNED_URL_STALE_MS = 60 * 60 * 1000;

/// The endpoint's per-call cap.
const SIGN_BATCH_MAX = 200;

type Pending = { resolve: (url: string | null) => void; reject: (e: unknown) => void };
let queue = new Map<string, Pending[]>();
let scheduled = false;

/// Sign one path, batched with every other path asked for in the same tick.
///
/// One request per avatar would put a page of members - hundreds of rows -
/// straight into the backend's per-user rate limit. Rows render together, so
/// their requests are collected and sent as a few calls of up to 200.
function signBatched(path: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const waiting = queue.get(path) ?? [];
    waiting.push({ resolve, reject });
    queue.set(path, waiting);
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      const batch = queue;
      queue = new Map();
      scheduled = false;
      const paths = [...batch.keys()];
      for (let i = 0; i < paths.length; i += SIGN_BATCH_MAX) {
        const chunk = paths.slice(i, i + SIGN_BATCH_MAX);
        adminApi.signProfilePhotos(chunk).then(
          (res) => {
            const urls = (res.urls ?? {}) as Record<string, string | null>;
            for (const p of chunk) for (const w of batch.get(p) ?? []) w.resolve(urls[p] ?? null);
          },
          (e: unknown) => {
            for (const p of chunk) for (const w of batch.get(p) ?? []) w.reject(e);
          },
        );
      }
    });
  });
}

/// A browser-loadable URL for a member's stored photo.
///
/// The Users list streams rows from Firestore, so an uploaded photo arrives as
/// `profile_photos/{uid}.{ext}` - which `<img>` cannot load, and which used to
/// draw every app-uploaded avatar as broken. Those paths are signed through the
/// admin-only endpoint; a Google URL or any other https URL passes through.
/// Null while signing, or when there is no photo, so the caller shows the
/// initial.
export function useProfilePhotoUrl(photo: string | null | undefined): string | null {
  const needsSigning = isStoredPhotoPath(photo);
  const signed = useQuery({
    queryKey: ['profile-photo-url', photo],
    queryFn: () => signBatched(photo as string),
    enabled: needsSigning,
    staleTime: SIGNED_URL_STALE_MS,
    retry: 1,
  });
  if (!photo) return null;
  return needsSigning ? (signed.data ?? null) : photo;
}

/// The signed-in admin's own photo: what they uploaded (already signed by
/// `GET /api/profile`), else null so the caller can fall back.
export function useMyProfilePhoto() {
  return useQuery({
    queryKey: ['my-profile-photo'],
    queryFn: async () => {
      const profile = await adminApi.myProfile();
      const photo = profile.profilePhoto;
      return typeof photo === 'string' && photo.length > 0 ? photo : null;
    },
    staleTime: SIGNED_URL_STALE_MS,
    retry: 1,
  });
}
