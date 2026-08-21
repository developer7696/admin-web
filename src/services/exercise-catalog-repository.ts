import { adminApi, ApiException } from '@/lib/api-client';
import {
  parseCatalogSnapshot,
  parseSaveOutcome,
  parseUploadTicket,
  type CatalogSnapshot,
  type ExercisePatch,
  type SaveOutcome,
  type UploadTicket,
} from '@/types/exercise-catalog';

/// The exercise catalogue, as data. Nothing above this layer knows whether it
/// came from the API or Firestore.
///
/// It is entirely the API today — the browser never touches `exercise_catalog`
/// directly. That matters for correctness, not just tidiness: the server joins
/// each exercise against `media_assets` to find its Azure blob (the browser has
/// no such inventory), refuses an id that already exists instead of silently
/// merging into it, and bumps `content_meta/exercise_catalog.version` so
/// installed apps know to refetch.
///
/// Every function throws `ApiException` and nothing else, so callers handle one
/// error type regardless of where the data lives.

/// One error type out of this layer. `ApiException` passes through untouched;
/// anything else (a malformed payload, a parse that should never fail) becomes
/// one, so no caller has to catch a transport-specific type.
async function guard<T>(body: () => Promise<T>): Promise<T> {
  try {
    return await body();
  } catch (e) {
    if (e instanceof ApiException) throw e;
    throw new ApiException(
      0,
      'unexpected',
      `Unexpected problem with the catalogue: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

/// The direct-to-blob transfer. A bare `fetch`, not the admin client: this goes
/// to Azure, not to our API, and must NOT carry the Firebase token — the SAS
/// token embedded in the URL is the whole authorisation.
export async function putToAzure(
  uploadUrl: string,
  contentType: string,
  bytes: Blob | ArrayBuffer,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        // Azure rejects a block blob PUT without this header.
        'x-ms-blob-type': 'BlockBlob',
        'Content-Type': contentType,
      },
      body: bytes as BodyInit,
    });
  } catch {
    throw new ApiException(
      0,
      'azure_upload_failed',
      "Couldn't reach Azure to upload the file. The storage account needs a blob CORS rule " +
        'allowing PUT from this origin (see aarambhmedia → Resource sharing).',
    );
  }

  if (!res.ok) {
    throw new ApiException(
      res.status,
      'azure_upload_failed',
      res.status === 403
        ? 'Azure refused the write (403). The App Service identity needs Storage Blob Data ' +
          'Contributor on aarambhmedia.'
        : `Azure rejected the upload (${res.status}). The link may have expired.`,
    );
  }
}

export const exerciseCatalogRepository = {
  /// The whole catalogue in one call: every exercise, with its Azure media
  /// resolved and signed for preview.
  ///
  /// Not realtime, and deliberately so — there is one admin and no concurrent
  /// editors, so the only change worth seeing is your own. The endpoint is rate
  /// limited to 30/min and signs ~314 blobs per call, so refetch after a
  /// mutation, never per render.
  fetchAll: (): Promise<CatalogSnapshot> =>
    guard(async () => parseCatalogSnapshot(await adminApi.exerciseCatalog())),

  /// Create one exercise. Throws `ApiException` with code `exercise_exists`
  /// (409) if the id is taken — ids are referenced by schedules and workout
  /// history, so a collision is never silently merged.
  create: (id: string, patch: ExercisePatch): Promise<SaveOutcome> =>
    guard(async () => parseSaveOutcome(await adminApi.createExercise({ id, ...patch.toJSON() }))),

  /// Update one exercise. See `ExercisePatch` for how omitting a field differs
  /// from clearing it.
  update: (id: string, patch: ExercisePatch): Promise<SaveOutcome> =>
    guard(async () => parseSaveOutcome(await adminApi.updateExercise(id, patch.toJSON()))),

  /// Remove an exercise. Throws `ApiException` with code `exercise_in_use`
  /// (409) if a program still names this id.
  remove: (id: string): Promise<void> =>
    guard(async () => {
      await adminApi.deleteExercise(id);
    }),

  /// Upload a video or image for `id` and link it to the exercise.
  ///
  /// Three steps, and the middle one deliberately does NOT go through our
  /// server: the bytes go browser → Azure directly, so a 40MB video never
  /// occupies an App Service request. The server only issues the permit and
  /// then verifies the blob landed.
  uploadMedia: (args: {
    id: string;
    kind: string;
    extension: string;
    file: Blob;
  }): Promise<SaveOutcome> =>
    guard(async () => {
      const ticket: UploadTicket = parseUploadTicket(
        await adminApi.exerciseUploadUrl(args.id, args.kind, args.extension),
      );
      if (!ticket.uploadUrl || !ticket.path) {
        throw new ApiException(0, 'upload_ticket', 'The server did not return an upload URL.');
      }

      await putToAzure(ticket.uploadUrl, ticket.contentType, args.file);

      return parseSaveOutcome(
        await adminApi.exerciseUploadConfirm(args.id, args.kind, ticket.path),
      );
    }),
};
