import { adminApi, ApiException, type Json } from '@/lib/api-client';
import { currentUserCan } from '@/auth/admin-auth';
import { toDate } from '@/lib/format';
import { putToAzure } from './exercise-catalog-repository';

/// Articles CRUD, through the admin API.
///
/// This used to talk to Firestore directly from the browser. It no longer does:
/// the server validates the payload, stamps the author from the verified ID
/// token rather than trusting the client, and writes an audit entry per change.
/// The Firestore rules currently allow any signed-in user to write any document,
/// so browser-side writes were enforced by nothing.
///
/// Images go to Azure the same way recipe images do: the browser asks the API
/// for a one-blob write SAS (`article_images/{id}.{ext}`), PUTs the bytes
/// straight to Azure, and the confirm endpoint — which verifies the blob
/// landed — writes `imageUrl` onto the document server-side. Pre-migration
/// articles may still point at Firebase Storage; those blobs are left in place.

export type ArticleRow = Json & {
  id: string;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export type ArticleCategories = {
  categories: string[];
};

const strings = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string' && v.trim() !== '') : [];

export function parseArticleCategories(json: unknown): ArticleCategories {
  const rec = json && typeof json === 'object' ? (json as Record<string, unknown>) : {};
  return { categories: strings(rec.categories) };
}

export async function fetchArticleCategories(): Promise<ArticleCategories> {
  return parseArticleCategories(await adminApi.articleCategories());
}

export type ArticlesPayload = {
  articles: ArticleRow[];
  categories: string[];
  stats: Record<string, number>;
};

/// Articles plus aggregate stats. Category chips come from
/// `GET /api/content/article-categories`, not this payload.
export async function listArticles(): Promise<ArticlesPayload> {
  const json = await adminApi.listArticles();

  const articles = ((json.articles as Json[]) ?? []).map((raw) => ({
    ...raw,
    id: String(raw.id ?? ''),
    createdAt: toDate(raw.createdAt),
    updatedAt: toDate(raw.updatedAt),
  })) as ArticleRow[];

  const categories = strings(json.categories);

  const rawStats = (json.stats ?? {}) as Record<string, unknown>;
  const stats: Record<string, number> = {};
  for (const [k, v] of Object.entries(rawStats)) {
    stats[k] = typeof v === 'number' ? Math.trunc(v) : 0;
  }

  return {
    articles,
    categories,
    stats,
  };
}

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/// Permit → PUT → confirm. The confirm writes `imageUrl` server-side, so this
/// deliberately does not patch the document; failures throw so the dialog can
/// say why, instead of silently saving the article with no image.
async function uploadImage(file: Blob, articleId: string): Promise<void> {
  const extension = EXT_BY_TYPE[file.type];
  if (!extension) {
    throw new ApiException(0, 'unsupported_media_type', 'Images must be JPEG, PNG or WebP.');
  }

  const ticket = await adminApi.articleImageUploadUrl(articleId, extension);
  const uploadUrl = String(ticket.uploadUrl ?? '');
  const path = String(ticket.path ?? '');
  if (!uploadUrl || !path) {
    throw new ApiException(0, 'upload_ticket', 'The server did not return an upload URL.');
  }

  await putToAzure(uploadUrl, String(ticket.contentType ?? file.type), file);
  await adminApi.articleImageUploadConfirm(articleId, path);
}

export async function createArticle(args: {
  title: string;
  content: string;
  category: string;
  imageFile?: Blob | null;
}): Promise<void> {
  if (!currentUserCan('articles:write')) throw new Error('Unauthorized access');

  // Created first so the image has an id to live under; the confirm endpoint
  // then writes `imageUrl` onto the document server-side.
  const created = await adminApi.createArticle({
    title: args.title,
    content: args.content,
    category: args.category,
  });
  const article = (created.article ?? {}) as Json;
  const articleId = typeof article.id === 'string' ? article.id : null;

  if (args.imageFile && articleId) await uploadImage(args.imageFile, articleId);
}

export async function updateArticle(args: {
  articleId: string;
  title: string;
  content: string;
  category: string;
  newImageFile?: Blob | null;
}): Promise<void> {
  if (!currentUserCan('articles:write')) throw new Error('Unauthorized access');

  // A replaced image overwrites its Azure blob in place (stable name, fresh
  // `?v=` stamp) and the confirm writes `imageUrl` itself, so the patch below
  // never carries the image.
  if (args.newImageFile) await uploadImage(args.newImageFile, args.articleId);

  await adminApi.updateArticle(args.articleId, {
    title: args.title,
    content: args.content,
    category: args.category,
  });
}

/// Deletes the article document. The Storage image is deliberately left in
/// place — a row is cheap to recreate, an unrecoverable image is not.
export async function deleteArticle(articleId: string): Promise<void> {
  if (!currentUserCan('articles:write')) throw new Error('Unauthorized access');
  await adminApi.deleteArticle(articleId);
}

export async function togglePublishStatus(
  articleId: string,
  currentStatus: boolean,
): Promise<void> {
  if (!currentUserCan('articles:write')) throw new Error('Unauthorized access');
  await adminApi.updateArticle(articleId, { isPublished: !currentStatus });
}
