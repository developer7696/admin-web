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
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { auth, db, storage } from '@/lib/firebase';
// `currentUserCan` rather than the old `isCurrentUserAdmin`: that helper now
// means "holds ANY permission", so a reader would sail straight past it. These
// are client-side pre-checks only — see ARCHITECTURE.md "The gap".
import { currentUserCan } from '@/auth/admin-auth';
import { adminApi } from '@/lib/api-client';

/// The `recipes` collection, written directly from the browser (same pattern as
/// the mobile app). Images live in Firebase Storage under `recipes/{id}/`.

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

async function uploadImage(file: Blob, recipeId: string): Promise<string | null> {
  try {
    const objectRef = ref(storage, `recipes/${recipeId}/${Date.now()}.jpg`);
    const snapshot = await uploadBytes(objectRef, file, { contentType: 'image/jpeg' });
    return await getDownloadURL(snapshot.ref);
  } catch {
    return null;
  }
}

/// Best-effort: an orphaned blob is cheaper than a failed recipe write.
/// `ref(storage, url)` accepts a full gs:// or https download URL, which is what
/// the stored `imageUrl` is.
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

  // Created first so the image has an id to live under; the URL is then patched
  // on — the same two-step the mobile app uses.
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

  if (imageFile) {
    const imageUrl = await uploadImage(imageFile, recipeRef.id);
    if (imageUrl) await updateDoc(recipeRef, { imageUrl });
  }
}

export async function updateRecipe(
  recipeId: string,
  input: RecipeInput,
  opts: { newImageFile?: Blob | null; currentImageUrl?: string | null } = {},
): Promise<void> {
  if (!currentUserCan('recipes:write')) throw new Error('Unauthorized access');

  const update: Record<string, unknown> = { ...input, updatedAt: new Date() };

  if (opts.newImageFile) {
    if (opts.currentImageUrl) await deleteImage(opts.currentImageUrl);
    const newImageUrl = await uploadImage(opts.newImageFile, recipeId);
    if (newImageUrl) update.imageUrl = newImageUrl;
  }

  await updateDoc(doc(db, 'recipes', recipeId), update);
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
