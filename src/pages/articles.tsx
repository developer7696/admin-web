import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Eye,
  EyeOff,
  FileText,
  Heart,
  ImagePlus,
  Loader2,
  RefreshCw,
  SquarePen,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { ApiException } from '@/lib/api-client';
import {
  createArticle,
  deleteArticle,
  fetchArticleCategories,
  listArticles,
  togglePublishStatus,
  updateArticle,
  type ArticleRow,
} from '@/services/articles-service';
import { fmtDateTime } from '@/lib/format';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { Button } from '@/components/ui/button';
import { PageBar } from '@/components/common/page-header';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

/// Article management, through the admin API.
///
/// The list is a fetch rather than a Firestore stream — the API cannot stream,
/// so every mutation refetches. The trade is losing updates made by ANOTHER
/// admin while this page sits open; the reload action picks those up.

const articlesKey = ['articles'] as const;

type FormState = { title: string; content: string; category: string };

function ArticleForm({
  form,
  setForm,
  categories,
  imageFile,
  setImageFile,
  currentImageUrl,
}: {
  form: FormState;
  setForm: (f: FormState) => void;
  categories: string[];
  imageFile: File | null;
  setImageFile: (f: File | null) => void;
  currentImageUrl?: string | null;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const previewUrl = useMemo(
    () => (imageFile ? URL.createObjectURL(imageFile) : null),
    [imageFile],
  );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Label>Title</Label>
        <Input
          className="mt-1.5"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
        />
      </div>

      <div>
        <Label>Category</Label>
        {categories.length === 0 ? (
          <p className="mt-1.5 text-sm text-muted-foreground">
            No categories in the catalogue.
          </p>
        ) : (
          <Select
            value={form.category || undefined}
            onValueChange={(v) => setForm({ ...form, category: v })}
          >
            <SelectTrigger className="mt-1.5">
              <SelectValue placeholder="Choose a category" />
            </SelectTrigger>
            <SelectContent>
              {categories.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div>
        <Label>Cover image</Label>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="mt-1.5 flex h-[140px] w-full items-center justify-center overflow-hidden rounded-lg border border-input bg-muted/40 transition-colors hover:bg-muted"
        >
          {previewUrl ? (
            <img src={previewUrl} alt="" className="size-full object-cover" />
          ) : currentImageUrl ? (
            <img src={currentImageUrl} alt="" className="size-full object-cover" />
          ) : (
            <span className="flex flex-col items-center gap-2 text-muted-foreground">
              <ImagePlus className="size-6" />
              <span className="text-xs">Choose an image</span>
            </span>
          )}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) setImageFile(file);
            e.target.value = '';
          }}
        />
      </div>

      <div>
        <Label>Content</Label>
        <Textarea
          rows={12}
          className="mt-1.5"
          value={form.content}
          onChange={(e) => setForm({ ...form, content: e.target.value })}
        />
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="mb-2 flex items-start gap-3">
      <span className="w-24 shrink-0 text-sm font-bold text-muted-foreground">{label}:</span>
      <span className="min-w-0 flex-1 text-sm">{value}</span>
    </div>
  );
}

export function ArticlesPage() {
  const [tab, setTab] = useState('list');
  const [createForm, setCreateForm] = useState<FormState>({
    title: '',
    content: '',
    category: '',
  });
  const [createImage, setCreateImage] = useState<File | null>(null);
  const [creating, setCreating] = useState(false);

  const [editing, setEditing] = useState<ArticleRow | null>(null);
  const [details, setDetails] = useState<ArticleRow | null>(null);
  const [deleting, setDeleting] = useState<ArticleRow | null>(null);

  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: articlesKey,
    queryFn: listArticles,
  });
  const { data: catalog } = useQuery({
    queryKey: ['article-categories'],
    queryFn: fetchArticleCategories,
  });

  const reload = () => qc.invalidateQueries({ queryKey: articlesKey });

  const articles = data?.articles ?? [];
  const categories = catalog?.categories ?? [];
  const stats = data?.stats ?? {};

  async function submitCreate() {
    if (!createForm.title.trim() || !createForm.content.trim() || !createForm.category) {
      toast.error('Title, category and content are all required.');
      return;
    }
    setCreating(true);
    try {
      await createArticle({
        title: createForm.title.trim(),
        content: createForm.content.trim(),
        category: createForm.category,
        imageFile: createImage,
      });
      toast.success('Article created successfully!');
      setCreateForm({ title: '', content: '', category: '' });
      setCreateImage(null);
      void reload();
      setTab('list');
    } catch (e) {
      toast.error(
        e instanceof ApiException ? e.message : 'Failed to create article. Please try again.',
      );
    } finally {
      setCreating(false);
    }
  }

  const n = (key: string) => stats[key] ?? 0;

  return (
    <div className="flex h-full flex-col">
      <PageBar
        title="Articles"
        status={`${n('total')} total · ${n('published')} published · ${n('unpublished') || n('drafts')} drafts · ${n('totalViews') || n('views')} views`}
        className="shrink-0 px-4 pb-2.5 pt-4"
      >
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          <RefreshCw /> Reload
        </Button>
      </PageBar>

      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-border bg-card px-4 pb-2.5">
          <TabsList>
            <TabsTrigger value="list">All Articles</TabsTrigger>
            <TabsTrigger value="create">Create New</TabsTrigger>
          </TabsList>
        </div>

        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-4">
          <TabsContent value="list" className="mt-0">
            {isLoading && <LoadingState />}
            {error && <ErrorState error={error} onRetry={() => void refetch()} />}
            {data && articles.length === 0 && (
              <EmptyState icon={<FileText className="size-10" />} title="No articles found" />
            )}

            {articles.map((article) => {
              const isPublished = article.isPublished === true;
              const imageUrl = article.imageUrl as string | undefined;
              const category = article.category as string | undefined;

              return (
                <Card key={article.id} className="mb-3">
                  <button
                    type="button"
                    onClick={() => setDetails(article)}
                    className="block w-full p-4 text-left"
                  >
                    <div className="flex gap-4">
                      <span className="flex size-[60px] shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
                        {imageUrl ? (
                          <img src={imageUrl} alt="" className="size-full object-cover" />
                        ) : (
                          <FileText className="size-5 text-muted-foreground" />
                        )}
                      </span>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={cn(
                              'rounded-lg px-2 py-1 text-[10px] font-bold',
                              category
                                ? 'bg-blue-500/10 text-blue-600'
                                : 'bg-slate-500/10 text-slate-500',
                            )}
                          >
                            {category ?? 'No Category'}
                          </span>
                          <span
                            className={cn(
                              'rounded-lg border px-2 py-1 text-[10px] font-bold',
                              isPublished
                                ? 'border-emerald-600 bg-emerald-500/10 text-emerald-600'
                                : 'border-orange-600 bg-orange-500/10 text-orange-600',
                            )}
                          >
                            {isPublished ? 'PUBLISHED' : 'DRAFT'}
                          </span>
                        </div>
                        <p className="mt-2 line-clamp-2 text-base font-bold">
                          {String(article.title ?? '')}
                        </p>
                        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                          {String(article.content ?? '')}
                        </p>
                      </div>
                    </div>
                  </button>

                  <div className="flex items-end justify-between px-4 pb-3">
                    <div>
                      <p className="text-xs text-muted-foreground">
                        {article.createdAt ? fmtDateTime(article.createdAt) : '-'}
                      </p>
                      <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Eye className="size-3.5" /> {String(article.views ?? 0)} views
                        </span>
                        <span className="flex items-center gap-1">
                          <Heart className="size-3.5" /> {String(article.likes ?? 0)} likes
                        </span>
                      </div>
                    </div>

                    <div className="flex">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title={isPublished ? 'Unpublish' : 'Publish'}
                        onClick={() => {
                          void togglePublishStatus(article.id, isPublished).then(
                            () => {
                              void reload();
                              toast.success(
                                isPublished ? 'Article unpublished!' : 'Article published!',
                              );
                            },
                            (e: unknown) =>
                              toast.error(
                                e instanceof ApiException
                                  ? e.message
                                  : 'Failed to update article status',
                              ),
                          );
                        }}
                      >
                        {isPublished ? (
                          <EyeOff className="size-5 text-orange-600" />
                        ) : (
                          <Eye className="size-5 text-emerald-600" />
                        )}
                      </Button>
                      <Button variant="ghost" size="icon-sm" onClick={() => setEditing(article)}>
                        <SquarePen className="size-5 text-blue-600" />
                      </Button>
                      <Button variant="ghost" size="icon-sm" onClick={() => setDeleting(article)}>
                        <Trash2 className="size-5 text-red-600" />
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </TabsContent>

          <TabsContent value="create" className="mt-0">
            <Card className="p-5">
              <ArticleForm
                form={createForm}
                setForm={setCreateForm}
                categories={categories}
                imageFile={createImage}
                setImageFile={setCreateImage}
              />
              <Button
                className="mt-6 h-12 w-full"
                disabled={creating}
                onClick={() => void submitCreate()}
              >
                {creating ? <Loader2 className="animate-spin" /> : null} Create Article
              </Button>
            </Card>
          </TabsContent>
        </div>
      </Tabs>

      {details && (
        <Dialog open onOpenChange={(open) => !open && setDetails(null)}>
          <DialogContent className="max-h-[85vh] max-w-2xl">
            <DialogHeader>
              <DialogTitle className="text-xl">{String(details.title ?? 'Article')}</DialogTitle>
            </DialogHeader>
            <DialogBody>
              {details.imageUrl ? (
                <img
                  src={String(details.imageUrl)}
                  alt=""
                  className="mb-4 h-[220px] w-full rounded-lg object-cover"
                />
              ) : null}

              <DetailRow label="Category" value={String(details.category ?? '-')} />
              <DetailRow
                label="Status"
                value={details.isPublished === true ? 'Published' : 'Draft'}
              />
              <DetailRow
                label="Created"
                value={details.createdAt ? fmtDateTime(details.createdAt) : '-'}
              />
              <DetailRow label="Author" value={String(details.authorName ?? '-')} />
              <DetailRow label="Views" value={String(details.views ?? 0)} />
              <DetailRow label="Likes" value={String(details.likes ?? 0)} />

              <div className="mt-4 whitespace-pre-wrap text-sm leading-relaxed">
                {String(details.content ?? '')}
              </div>
            </DialogBody>
            <DialogFooter className="justify-stretch">
              <Button
                className="flex-1"
                onClick={() => {
                  setEditing(details);
                  setDetails(null);
                }}
              >
                Edit
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                onClick={() => {
                  setDeleting(details);
                  setDetails(null);
                }}
              >
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {editing && (
        <EditArticleDialog
          article={editing}
          categories={categories}
          onClose={() => setEditing(null)}
          onSaved={() => void reload()}
        />
      )}

      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setDeleting(null)}
          title="Delete Article"
          description="Are you sure you want to delete this article? This action cannot be undone."
          confirmLabel="Delete"
          destructive
          onConfirm={async () => {
            try {
              await deleteArticle(deleting.id);
              void reload();
              toast.success('Article deleted successfully!');
            } catch (e) {
              toast.error(e instanceof ApiException ? e.message : 'Failed to delete article');
            }
          }}
        />
      )}
    </div>
  );
}

function EditArticleDialog({
  article,
  categories,
  onClose,
  onSaved,
}: {
  article: ArticleRow;
  categories: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<FormState>({
    title: String(article.title ?? ''),
    content: String(article.content ?? ''),
    category: String(article.category ?? ''),
  });
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await updateArticle({
        articleId: article.id,
        title: form.title.trim(),
        content: form.content.trim(),
        category: form.category,
        newImageFile: imageFile,
      });
      toast.success('Article updated successfully!');
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof ApiException ? e.message : 'Failed to update article');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[88vh] max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit Article</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <ArticleForm
            form={form}
            setForm={setForm}
            categories={categories}
            imageFile={imageFile}
            setImageFile={setImageFile}
            currentImageUrl={article.imageUrl as string | undefined}
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={() => void save()}>
            {busy && <Loader2 className="animate-spin" />} Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
