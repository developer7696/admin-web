import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { storage } from '@/lib/firebase';
import { adminApi, type Json } from '@/lib/api-client';
import { isCurrentUserAdmin } from '@/auth/admin-auth';
import { toDate } from '@/lib/format';

/// Articles CRUD, through the admin API.
///
/// This used to talk to Firestore directly from the browser. It no longer does:
/// the server validates the payload, stamps the author from the verified ID
/// token rather than trusting the client, and writes an audit entry per change.
/// The Firestore rules currently allow any signed-in user to write any document,
/// so browser-side writes were enforced by nothing.
///
/// Images still go to Firebase Storage from here — that path is unchanged and is
/// a separate migration.

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

async function uploadImage(file: Blob, articleId: string): Promise<string | null> {
  try {
    const objectRef = ref(storage, `articles/${articleId}/${Date.now()}.jpg`);
    const snapshot = await uploadBytes(objectRef, file, { contentType: 'image/jpeg' });
    return await getDownloadURL(snapshot.ref);
  } catch {
    return null;
  }
}

export async function createArticle(args: {
  title: string;
  content: string;
  category: string;
  imageFile?: Blob | null;
}): Promise<void> {
  if (!isCurrentUserAdmin()) throw new Error('Unauthorized access');

  // Created first so the image has an id to live under; the URL is then patched
  // on. Same two-step the Firestore version used.
  const created = await adminApi.createArticle({
    title: args.title,
    content: args.content,
    category: args.category,
  });
  const article = (created.article ?? {}) as Json;
  const articleId = typeof article.id === 'string' ? article.id : null;

  if (args.imageFile && articleId) {
    const imageUrl = await uploadImage(args.imageFile, articleId);
    if (imageUrl) await adminApi.updateArticle(articleId, { imageUrl });
  }
}

export async function updateArticle(args: {
  articleId: string;
  title: string;
  content: string;
  category: string;
  newImageFile?: Blob | null;
}): Promise<void> {
  if (!isCurrentUserAdmin()) throw new Error('Unauthorized access');

  const patch: Json = {
    title: args.title,
    content: args.content,
    category: args.category,
  };

  if (args.newImageFile) {
    const newImageUrl = await uploadImage(args.newImageFile, args.articleId);
    if (newImageUrl) patch.imageUrl = newImageUrl;
  }

  await adminApi.updateArticle(args.articleId, patch);
}

/// Deletes the article document. The Storage image is deliberately left in
/// place — a row is cheap to recreate, an unrecoverable image is not.
export async function deleteArticle(articleId: string): Promise<void> {
  if (!isCurrentUserAdmin()) throw new Error('Unauthorized access');
  await adminApi.deleteArticle(articleId);
}

export async function togglePublishStatus(
  articleId: string,
  currentStatus: boolean,
): Promise<void> {
  if (!isCurrentUserAdmin()) throw new Error('Unauthorized access');
  await adminApi.updateArticle(articleId, { isPublished: !currentStatus });
}
