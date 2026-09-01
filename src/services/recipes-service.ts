import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  type DocumentData,
} from 'firebase/firestore';
import { deleteObject, ref } from 'firebase/storage';
import { auth, db, storage } from '@/lib/firebase';
// `currentUserCan` rather than the old `isCurrentUserAdmin`: that helper now
// means "holds ANY permission", so a reader would sail straight past it. These
// are client-side pre-checks only — see ARCHITECTURE.md "The gap".
import { currentUserCan } from '@/auth/admin-auth';
import { adminApi, ApiException } from '@/lib/api-client';
import { putToAzure } from './exercise-catalog-repository';

/// The `recipes` collection, written directly from the browser (same pattern as
/// the mobile app). Images live in Azure under `recipe_images/{id}.{ext}` in
/// the public-read container: the browser asks the API for a one-blob write
/// SAS, PUTs the bytes straight to Azure, and the confirm endpoint - which
/// verifies the blob landed - writes `imageUrl` onto the document server-side.
/// Pre-migration recipes may still point at Firebase Storage; those blobs are
/// left in place.

export type RecipeRow = DocumentData & { id: string };

export type RecipeInput = {
  name: string;
  description: string;
  ingredients: string[];
  instructions: string[];
  nutrition: Record<string, unknown>;
  servings: number;
  totalTime: number;
  difficulty: string;
  tags: string[];
};

export type RecipeFilterCatalog = {
  tags: string[];
  difficulties: string[];
};

const strings = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string' && v.trim() !== '') : [];

export function parseRecipeFilters(json: unknown): RecipeFilterCatalog {
  const rec = json && typeof json === 'object' ? (json as Record<string, unknown>) : {};
  return {
    tags: strings(rec.tags),
    difficulties: strings(rec.difficulties),
  };
}

export async function fetchRecipeFilters(): Promise<RecipeFilterCatalog> {
  return parseRecipeFilters(await adminApi.recipeFilters());
}

export function subscribeRecipes(
  onData: (rows: RecipeRow[]) => void,
  onError?: (e: Error) => void,
): () => void {
  return onSnapshot(
    query(collection(db, 'recipes'), orderBy('createdAt', 'desc')),
    (snapshot) => onData(snapshot.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (e) => onError?.(e),
  );
}

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/// Permit → PUT → confirm. The confirm writes `imageUrl` server-side, so this
/// deliberately does not touch the document; failures throw so the dialog can
/// say why, instead of silently saving the recipe with no image.
async function uploadImage(file: Blob, recipeId: string): Promise<void> {
  const extension = EXT_BY_TYPE[file.type];
  if (!extension) {
    throw new ApiException(0, 'unsupported_media_type', 'Images must be JPEG, PNG or WebP.');
  }

  const ticket = await adminApi.recipeImageUploadUrl(recipeId, extension);
  const uploadUrl = String(ticket.uploadUrl ?? '');
  const path = String(ticket.path ?? '');
  if (!uploadUrl || !path) {
    throw new ApiException(0, 'upload_ticket', 'The server did not return an upload URL.');
  }

  await putToAzure(uploadUrl, String(ticket.contentType ?? file.type), file);
  await adminApi.recipeImageUploadConfirm(recipeId, path);
}

/// Best-effort: an orphaned blob is cheaper than a failed recipe write.
/// `ref(storage, url)` accepts a full gs:// or https download URL, which is
/// what a pre-migration `imageUrl` is. An Azure URL makes it throw, which the
/// catch turns into the intended no-op — Azure blobs are never deleted from
/// the browser.
async function deleteImage(imageUrl: string): Promise<void> {
  try {
    await deleteObject(ref(storage, imageUrl));
  } catch {
    // ignored
  }
}

export async function createRecipe(input: RecipeInput, imageFile?: Blob | null): Promise<void> {
  if (!currentUserCan('recipes:write')) throw new Error('Unauthorized access');
  const user = auth.currentUser;
  if (!user) throw new Error('Please login to create a recipe');

  // Created first so the image has an id to live under; the confirm endpoint
  // then writes `imageUrl` onto the document server-side.
  const recipeRef = await addDoc(collection(db, 'recipes'), {
    ...input,
    authorId: user.uid,
    authorEmail: user.email,
    authorName: user.displayName ?? 'Admin',
    imageUrl: null,
    isPublished: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    views: 0,
  });

  if (imageFile) await uploadImage(imageFile, recipeRef.id);
}

export async function updateRecipe(
  recipeId: string,
  input: RecipeInput,
  opts: { newImageFile?: Blob | null } = {},
): Promise<void> {
  if (!currentUserCan('recipes:write')) throw new Error('Unauthorized access');

  // A replaced image overwrites its Azure blob in place (stable name, fresh
  // `?v=` stamp), and a legacy Firebase blob is simply left behind — so there
  // is nothing to delete here.
  if (opts.newImageFile) await uploadImage(opts.newImageFile, recipeId);

  await updateDoc(doc(db, 'recipes', recipeId), { ...input, updatedAt: new Date() });
}

export async function deleteRecipe(recipeId: string, imageUrl?: string | null): Promise<void> {
  if (!currentUserCan('recipes:write')) throw new Error('Unauthorized access');
  if (imageUrl) await deleteImage(imageUrl);
  await deleteDoc(doc(db, 'recipes', recipeId));
}

export async function togglePublishStatus(recipeId: string, currentStatus: boolean): Promise<void> {
  if (!currentUserCan('recipes:write')) throw new Error('Unauthorized access');
  await updateDoc(doc(db, 'recipes', recipeId), {
    isPublished: !currentStatus,
    updatedAt: new Date(),
  });
}

export type RecipeStats = {
  total: number;
  published: number;
  unpublished: number;
  totalViews: number;
};

export async function getRecipeStatistics(): Promise<RecipeStats> {
  const empty: RecipeStats = { total: 0, published: 0, unpublished: 0, totalViews: 0 };
  if (!currentUserCan('recipes:read')) return empty;

  try {
    const snapshot = await getDocs(collection(db, 'recipes'));
    const stats = { ...empty, total: snapshot.docs.length };

    for (const d of snapshot.docs) {
      const data = d.data();
      if (data.isPublished === true) stats.published++;
      else stats.unpublished++;
      stats.totalViews += typeof data.views === 'number' ? data.views : 0;
    }

    return stats;
  } catch {
    return empty;
  }
}
