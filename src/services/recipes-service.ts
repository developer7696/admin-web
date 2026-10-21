import { adminApi, ApiException, type Json } from '@/lib/api-client';
// `currentUserCan` rather than the old `isCurrentUserAdmin`: that helper now
// means "holds ANY permission", so a reader would sail straight past it. These
// are client-side pre-checks only — the server enforces the same permissions
// again; see ARCHITECTURE.md "The gap".
import { currentUserCan } from '@/auth/admin-auth';
import { toDate } from '@/lib/format';
import { putToAzure } from './exercise-catalog-repository';

/// Recipes CRUD, through the admin API.
///
/// This used to write the `recipes` Firestore collection straight from the
/// browser. It no longer does: the server validates the payload, stamps the
/// author from the verified ID token rather than trusting the client, and writes
/// an audit entry per change. The Firestore rules currently allow any signed-in
/// user to write any document, so browser-side writes were enforced by nothing —
/// and since the backend moved to Postgres, that collection is a snapshot frozen
/// at migration time.
///
/// Recipes are the sibling of articles in the backend (one table, discriminated
/// by `kind`), so this file reads very like `articles-service.ts`.
///
/// Images still go browser → Azure: the browser asks the API for a one-blob
/// write SAS (`recipe_images/{id}.{ext}` in the public-read container), PUTs the
/// bytes straight to Azure, and the confirm endpoint — which verifies the blob
/// landed — writes `imageUrl` onto the row server-side. Pre-migration recipes
/// may still point at Firebase Storage; those blobs are left in place.

/// One recipe as the authoring view consumes it. `Json &` rather than a full
/// field list because the page renders whatever the API sends (`nutrition` is
/// free-form jsonb, and `authorName`/`views`/`imagePath` are read straight off
/// the row); only the timestamps are normalised, because a `Date` is what the
/// formatters take.
export type RecipeRow = Json & {
  id: string;
  createdAt: Date | null;
  updatedAt: Date | null;
};

/// The fields the authoring form owns. `ingredients`/`instructions`/`nutrition`/
/// `servings`/`totalTime`/`difficulty` live inside the row's `details` jsonb
/// server-side, but the API speaks them flat — the mapping is the backend's, not
/// this file's.
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

export type RecipeStats = {
  total: number;
  published: number;
  unpublished: number;
  totalViews: number;
};

const EMPTY_STATS: RecipeStats = { total: 0, published: 0, unpublished: 0, totalViews: 0 };

const count = (raw: unknown): number => (typeof raw === 'number' ? Math.trunc(raw) : 0);

/// The API calls the unpublished count `drafts`, which is the authoring view's
/// name for it; the panel has always called it `unpublished`, and the page's
/// label is "drafts" either way. The breakdowns the endpoint also returns
/// (`byDifficulty`, `byTag`) have nowhere to go on this screen yet.
export function parseRecipeStats(json: unknown): RecipeStats {
  const rec = json && typeof json === 'object' ? (json as Record<string, unknown>) : {};
  return {
    total: count(rec.total),
    published: count(rec.published),
    unpublished: count(rec.drafts),
    totalViews: count(rec.totalViews),
  };
}

export type RecipesPayload = {
  recipes: RecipeRow[];
  stats: RecipeStats;
  filters: RecipeFilterCatalog;
};

/// Every recipe newest-first, drafts included, plus the counts above the list
/// and the filter catalogue.
///
/// A fetch rather than the Firestore stream this replaces — the API cannot push,
/// so every mutation refetches. The trade is losing edits made by ANOTHER admin
/// while the page sits open; the reload action picks those up.
///
/// `stats` here describes the rows returned; the listing is unfiltered, so it
/// matches `getRecipeStatistics`. `filters` is the same document
/// `fetchRecipeFilters` fetches, embedded so the authoring form costs one
/// request rather than two.
export async function listRecipes(): Promise<RecipesPayload> {
  const json = await adminApi.listRecipes();

  const recipes = ((json.recipes as Json[]) ?? []).map((raw) => ({
    ...raw,
    id: String(raw.id ?? ''),
    createdAt: toDate(raw.createdAt),
    updatedAt: toDate(raw.updatedAt),
  })) as RecipeRow[];

  return {
    recipes,
    stats: parseRecipeStats(json.stats),
    filters: parseRecipeFilters(json.filters),
  };
}

/// Whole-library counts, for callers with no list beside them.
///
/// A failed count returns zeros rather than throwing: the counts sit in the page
/// header, and losing them must not take the list down with it.
export async function getRecipeStatistics(): Promise<RecipeStats> {
  if (!currentUserCan('recipes:read')) return EMPTY_STATS;
  try {
    const json = await adminApi.recipeStats();
    return parseRecipeStats(json.stats);
  } catch {
    return EMPTY_STATS;
  }
}

/// The form's fields as the API takes them.
///
/// Blank optional values go as explicit `null` rather than `''`: the server
/// rejects an empty `difficulty` (it is free text with a minimum length, not an
/// enum) and treats null as "clear it", which is what an unselected dropdown
/// means. Firestore accepted the empty string, so this mapping is new.
export function toRecipePayload(input: RecipeInput): Json {
  return {
    name: input.name,
    description: input.description,
    ingredients: input.ingredients,
    instructions: input.instructions,
    nutrition: input.nutrition,
    servings: input.servings,
    totalTime: input.totalTime,
    difficulty: input.difficulty.trim() === '' ? null : input.difficulty,
    tags: input.tags,
  };
}

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/// Permit → PUT → confirm. The confirm writes `imageUrl` server-side, so this
/// deliberately does not patch the row; failures throw so the dialog can say
/// why, instead of silently saving the recipe with no image.
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

/// Creates a DRAFT: the server defaults `isPublished` to false and the list's
/// publish toggle pushes it live. The browser-written version published
/// immediately, which meant a half-finished recipe reached every app user.
///
/// The author is no longer sent — `authorId`/`authorEmail`/`authorName` come
/// from the verified token, so a recipe cannot claim an author it does not have.
export async function createRecipe(input: RecipeInput, imageFile?: Blob | null): Promise<void> {
  if (!currentUserCan('recipes:write')) throw new Error('Unauthorized access');

  // Created first so the image has an id to live under; the confirm endpoint
  // then writes `imageUrl` onto the row server-side.
  const created = await adminApi.createRecipe(toRecipePayload(input));
  const recipe = (created.recipe ?? {}) as Json;
  const recipeId = typeof recipe.id === 'string' ? recipe.id : null;

  if (imageFile && recipeId) await uploadImage(imageFile, recipeId);
}

/// Saves the whole form. The endpoint is a partial update, so the fields the
/// form does not own — `isPublished`, `category`, `imageUrl` — are omitted and
/// left exactly as they are; the publish toggle is the only thing that moves the
/// publish flag.
export async function updateRecipe(
  recipeId: string,
  input: RecipeInput,
  opts: { newImageFile?: Blob | null } = {},
): Promise<void> {
  if (!currentUserCan('recipes:write')) throw new Error('Unauthorized access');

  // A replaced image overwrites its Azure blob in place (stable name, fresh
  // `?v=` stamp) and the confirm writes `imageUrl` itself, so the patch below
  // never carries the image.
  if (opts.newImageFile) await uploadImage(opts.newImageFile, recipeId);

  await adminApi.updateRecipe(recipeId, toRecipePayload(input));
}

/// Deletes the recipe row. The image is deliberately left in place — a row is
/// cheap to recreate, an unrecoverable image is not. That was already true of
/// Azure blobs, which the browser never had permission to delete; the
/// best-effort Firebase Storage delete this used to attempt is gone with the
/// rest of the Firestore path.
export async function deleteRecipe(recipeId: string): Promise<void> {
  if (!currentUserCan('recipes:write')) throw new Error('Unauthorized access');
  await adminApi.deleteRecipe(recipeId);
}

/// Sends the state the caller intends rather than asking the server to flip,
/// because the toast says which way it went. The flip form exists for a toggle
/// that does not know the current value.
export async function togglePublishStatus(recipeId: string, currentStatus: boolean): Promise<void> {
  if (!currentUserCan('recipes:write')) throw new Error('Unauthorized access');
  await adminApi.setRecipePublished(recipeId, !currentStatus);
}
