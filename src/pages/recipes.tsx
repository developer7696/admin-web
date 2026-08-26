import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Clock,
  Eye,
  EyeOff,
  ImagePlus,
  Loader2,
  Plus,
  SquarePen,
  Trash2,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  createRecipe,
  deleteRecipe,
  fetchRecipeFilters,
  getRecipeStatistics,
  subscribeRecipes,
  togglePublishStatus,
  updateRecipe,
  type RecipeInput,
  type RecipeRow,
} from '@/services/recipes-service';
import { fmtDateTime, toDate } from '@/lib/format';
import { useCan } from '@/auth/auth-context';
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

/// Recipe management: the live `recipes` collection, a per-recipe editor, and a
/// create form. Publishing is a per-row toggle rather than a form field so a
/// draft can be pushed live without reopening the editor.

function difficultyTint(difficulty: string): string {
  switch (difficulty.toLowerCase()) {
    case 'easy':
      return 'text-emerald-600 bg-emerald-500/10';
    case 'medium':
      return 'text-orange-600 bg-orange-500/10';
    case 'hard':
      return 'text-red-600 bg-red-500/10';
    default:
      return 'text-slate-500 bg-slate-500/10';
  }
}

/// A dynamic list of single-line fields (ingredients / instructions). The rows
/// are ordered, so the numbering is part of the data, not decoration.
function LineList({
  label,
  values,
  onChange,
  numbered,
  placeholder,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  numbered?: boolean;
  placeholder: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <Label>{label}</Label>
        <Button
          variant="link"
          size="sm"
          className="ml-auto h-auto p-0"
          onClick={() => onChange([...values, ''])}
        >
          <Plus className="size-[15px]" /> Add
        </Button>
      </div>
      <div className="mt-1.5 flex flex-col gap-2">
        {values.map((value, i) => (
          <div key={i} className="flex items-center gap-2">
            {numbered && (
              <span className="tabular w-5 shrink-0 text-xs font-bold text-muted-foreground">
                {i + 1}.
              </span>
            )}
            <Input
              value={value}
              placeholder={placeholder}
              onChange={(e) => {
                const next = [...values];
                next[i] = e.target.value;
                onChange(next);
              }}
            />
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={values.length === 1}
              onClick={() => onChange(values.filter((_, idx) => idx !== i))}
            >
              <X className="size-4 text-muted-foreground" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

type FormState = {
  name: string;
  description: string;
  ingredients: string[];
  instructions: string[];
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
  servings: string;
  totalTime: string;
  difficulty: string;
  tags: string[];
};

function emptyForm(): FormState {
  return {
    name: '',
    description: '',
    ingredients: [''],
    instructions: [''],
    calories: '',
    protein: '',
    carbs: '',
    fat: '',
    servings: '',
    totalTime: '',
    difficulty: '',
    tags: [],
  };
}

function formFrom(data: RecipeRow): FormState {
  const nutrition = (data.nutrition ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (v == null ? '' : String(v));
  const list = (v: unknown) => {
    const arr = ((v as unknown[]) ?? []).map(String);
    return arr.length > 0 ? arr : [''];
  };
  return {
    name: str(data.name),
    description: str(data.description),
    ingredients: list(data.ingredients),
    instructions: list(data.instructions),
    calories: str(nutrition.calories),
    protein: str(nutrition.protein),
    carbs: str(nutrition.carbs),
    fat: str(nutrition.fat),
    servings: str(data.servings),
    totalTime: str(data.totalTime),
    difficulty: str(data.difficulty),
    tags: ((data.tags as unknown[]) ?? []).map(String),
  };
}

function toInput(form: FormState): RecipeInput {
  const num = (v: string) => {
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : 0;
  };
  return {
    name: form.name.trim(),
    description: form.description.trim(),
    ingredients: form.ingredients.map((s) => s.trim()).filter(Boolean),
    instructions: form.instructions.map((s) => s.trim()).filter(Boolean),
    nutrition: {
      calories: num(form.calories),
      protein: num(form.protein),
      carbs: num(form.carbs),
      fat: num(form.fat),
    },
    servings: Number.parseInt(form.servings.trim(), 10) || 1,
    totalTime: Number.parseInt(form.totalTime.trim(), 10) || 0,
    difficulty: form.difficulty,
    tags: form.tags,
  };
}

/// Shared by the create tab and the edit dialog — the fields, validation and
/// image handling are identical, so they live in one place.
function RecipeForm({
  form,
  setForm,
  imageFile,
  setImageFile,
  currentImageUrl,
  tags,
  difficulties,
}: {
  form: FormState;
  setForm: (f: FormState) => void;
  imageFile: File | null;
  setImageFile: (f: File | null) => void;
  currentImageUrl?: string | null;
  tags: string[];
  difficulties: string[];
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const previewUrl = useMemo(
    () => (imageFile ? URL.createObjectURL(imageFile) : null),
    [imageFile],
  );

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm({ ...form, [key]: value });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Label>Recipe Name</Label>
        <Input
          className="mt-1.5"
          value={form.name}
          placeholder="Grilled chicken salad"
          onChange={(e) => set('name', e.target.value)}
        />
      </div>

      <div>
        <Label>Description</Label>
        <Textarea
          rows={2}
          className="mt-1.5"
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
        />
      </div>

      <div>
        <Label>Image</Label>
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

      <LineList
        label="Ingredients"
        values={form.ingredients}
        onChange={(v) => set('ingredients', v)}
        placeholder="200g chicken breast"
      />

      <LineList
        label="Instructions"
        numbered
        values={form.instructions}
        onChange={(v) => set('instructions', v)}
        placeholder="Season and grill for 6 minutes a side"
      />

      <div>
        <Label>Nutrition (per serving)</Label>
        <div className="mt-1.5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(
            [
              ['calories', 'Calories'],
              ['protein', 'Protein (g)'],
              ['carbs', 'Carbs (g)'],
              ['fat', 'Fat (g)'],
            ] as const
          ).map(([key, label]) => (
            <div key={key}>
              <Input
                type="number"
                value={form[key]}
                placeholder={label}
                onChange={(e) => set(key, e.target.value)}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">{label}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <Label>Servings</Label>
          <Input
            type="number"
            className="mt-1.5"
            value={form.servings}
            onChange={(e) => set('servings', e.target.value)}
          />
        </div>
        <div>
          <Label>Total time (min)</Label>
          <Input
            type="number"
            className="mt-1.5"
            value={form.totalTime}
            onChange={(e) => set('totalTime', e.target.value)}
          />
        </div>
        <div>
          <Label>Difficulty</Label>
          {difficulties.length === 0 ? (
            <p className="mt-1.5 text-sm text-muted-foreground">
              No difficulties in the catalogue.
            </p>
          ) : (
            <Select value={form.difficulty || undefined} onValueChange={(v) => set('difficulty', v)}>
              <SelectTrigger className="mt-1.5">
                <SelectValue placeholder="Select difficulty" />
              </SelectTrigger>
              <SelectContent>
                {difficulties.map((d) => (
                  <SelectItem key={d} value={d}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      <div>
        <Label>Tags</Label>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {tags.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tags in the catalogue.</p>
          ) : (
            tags.map((tag) => {
            const selected = form.tags.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                onClick={() =>
                  set('tags', selected ? form.tags.filter((t) => t !== tag) : [...form.tags, tag])
                }
                className={cn(
                  'rounded-full border px-2.5 py-1 text-xs transition-colors',
                  selected
                    ? 'border-primary bg-primary/10 font-semibold text-primary'
                    : 'border-input bg-card text-muted-foreground hover:bg-secondary',
                )}
              >
                {tag}
              </button>
            );
          })
          )}
        </div>
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

export function RecipesPage() {
  const [tab, setTab] = useState('list');
  const [rows, setRows] = useState<RecipeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const [createForm, setCreateForm] = useState<FormState>(emptyForm);
  const [createImage, setCreateImage] = useState<File | null>(null);
  const [creating, setCreating] = useState(false);

  const [editing, setEditing] = useState<RecipeRow | null>(null);
  const canWrite = useCan('recipes:write');
  const [details, setDetails] = useState<RecipeRow | null>(null);
  const [deleting, setDeleting] = useState<RecipeRow | null>(null);

  const qc = useQueryClient();
  const { data: stats } = useQuery({ queryKey: ['recipe-stats'], queryFn: getRecipeStatistics });
  const { data: filters } = useQuery({ queryKey: ['recipe-filters'], queryFn: fetchRecipeFilters });
  const tags = filters?.tags ?? [];
  const difficulties = filters?.difficulties ?? [];
  const refreshStats = () => qc.invalidateQueries({ queryKey: ['recipe-stats'] });

  useEffect(() => {
    return subscribeRecipes(
      (next) => {
        setRows(next);
        setLoading(false);
        setError(null);
      },
      (e) => {
        setError(e);
        setLoading(false);
      },
    );
  }, []);

  async function submitCreate() {
    if (!createForm.name.trim()) {
      toast.error('Give the recipe a name.');
      return;
    }
    setCreating(true);
    try {
      await createRecipe(toInput(createForm), createImage);
      toast.success('Recipe created successfully!');
      setCreateForm(emptyForm());
      setCreateImage(null);
      refreshStats();
      setTab('list');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create recipe. Please try again.');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Same trade as Complaints: the four counts were a full-width card with
          its own heading, a band of chrome for four numbers. Inline they cost a
          line. */}
      <PageBar
        title="Recipes"
        status={
          stats
            ? `${stats.total} total · ${stats.published} published · ${stats.unpublished} drafts · ${stats.totalViews} views`
            : 'Loading…'
        }
        className="shrink-0 px-4 pb-2.5 pt-4"
      />

      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-border bg-card px-4 pb-2.5">
          <TabsList>
            <TabsTrigger value="list">All Recipes</TabsTrigger>
            {/* The authoring tab is the only route into the create form, so
                without `recipes:write` it goes rather than being disabled. */}
            {canWrite && <TabsTrigger value="create">Create Recipe</TabsTrigger>}
          </TabsList>
        </div>

        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-4">
          <TabsContent value="list" className="mt-0">
            {loading && <LoadingState />}
            {error && <ErrorState error={error} />}
            {!loading && !error && rows.length === 0 && (
              <EmptyState icon={<UtensilsCrossed className="size-10" />} title="No recipes found" />
            )}

            {rows.map((recipe) => {
              const isPublished = recipe.isPublished === true;
              const createdAt = toDate(recipe.createdAt) ?? new Date();
              const imageUrl = recipe.imageUrl as string | undefined;
              const difficulty = String(recipe.difficulty ?? 'Easy');

              return (
                <Card key={recipe.id} className="mb-3">
                  <button
                    type="button"
                    onClick={() => setDetails(recipe)}
                    className="block w-full p-4 text-left"
                  >
                    <div className="flex gap-4">
                      <span className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
                        {imageUrl ? (
                          <img src={imageUrl} alt="" className="size-full object-cover" />
                        ) : (
                          <UtensilsCrossed className="size-6 text-muted-foreground" />
                        )}
                      </span>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={cn(
                              'rounded-lg px-2 py-1 text-[10px] font-bold',
                              difficultyTint(difficulty),
                            )}
                          >
                            {difficulty}
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
                        <p className="mt-2 truncate text-base font-bold">
                          {String(recipe.name ?? '')}
                        </p>
                        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                          {String(recipe.description ?? '')}
                        </p>
                      </div>
                    </div>
                  </button>

                  <div className="flex items-end justify-between px-4 pb-3">
                    <div>
                      <p className="text-xs text-muted-foreground">{fmtDateTime(createdAt)}</p>
                      <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="size-3.5" /> {String(recipe.totalTime ?? 0)} min
                        </span>
                        <span className="flex items-center gap-1">
                          <Eye className="size-3.5" /> {String(recipe.views ?? 0)} views
                        </span>
                      </div>
                    </div>

                    <div className="flex">
                      {canWrite && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title={isPublished ? 'Unpublish' : 'Publish'}
                        onClick={() => {
                          void togglePublishStatus(recipe.id, isPublished).then(
                            () => {
                              refreshStats();
                              toast.success(isPublished ? 'Recipe unpublished!' : 'Recipe published!');
                            },
                            (e: unknown) =>
                              toast.error(
                                e instanceof Error ? e.message : 'Failed to update recipe status',
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
                      )}
                      {canWrite && (
                        <>
                          <Button variant="ghost" size="icon-sm" onClick={() => setEditing(recipe)}>
                            <SquarePen className="size-5 text-blue-600" />
                          </Button>
                          <Button variant="ghost" size="icon-sm" onClick={() => setDeleting(recipe)}>
                            <Trash2 className="size-5 text-red-600" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </TabsContent>

          {canWrite && (
          <TabsContent value="create" className="mt-0">
            <Card className="p-5">
              <RecipeForm
                form={createForm}
                setForm={setCreateForm}
                imageFile={createImage}
                setImageFile={setCreateImage}
                tags={tags}
                difficulties={difficulties}
              />
              <Button
                className="mt-6 h-12 w-full bg-emerald-600 hover:bg-emerald-700"
                disabled={creating}
                onClick={() => void submitCreate()}
              >
                {creating ? <Loader2 className="animate-spin" /> : null} Create Recipe
              </Button>
            </Card>
          </TabsContent>
          )}
        </div>
      </Tabs>

      {details && (
        <Dialog open onOpenChange={(open) => !open && setDetails(null)}>
          <DialogContent className="max-h-[85vh] max-w-2xl">
            <DialogHeader>
              <DialogTitle className="text-xl">{String(details.name ?? 'Recipe')}</DialogTitle>
            </DialogHeader>
            <DialogBody>
              {details.imageUrl ? (
                <img
                  src={String(details.imageUrl)}
                  alt=""
                  className="mb-4 h-[220px] w-full rounded-lg object-cover"
                />
              ) : null}

              <p className="text-sm text-muted-foreground">{String(details.description ?? '')}</p>

              <div className="mt-4">
                <DetailRow label="Difficulty" value={String(details.difficulty ?? 'Easy')} />
                <DetailRow label="Servings" value={String(details.servings ?? '-')} />
                <DetailRow label="Total time" value={`${String(details.totalTime ?? 0)} min`} />
                <DetailRow
                  label="Status"
                  value={details.isPublished === true ? 'Published' : 'Draft'}
                />
                <DetailRow label="Views" value={String(details.views ?? 0)} />
                <DetailRow label="Author" value={String(details.authorName ?? '-')} />
              </div>

              {(() => {
                const nutrition = (details.nutrition ?? {}) as Record<string, unknown>;
                const entries = Object.entries(nutrition);
                if (entries.length === 0) return null;
                return (
                  <div className="mt-4">
                    <p className="text-base font-bold">Nutrition</p>
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {entries.map(([k, v]) => (
                        <div key={k} className="rounded-lg border border-border p-2 text-center">
                          <p className="tabular text-base font-bold">{String(v)}</p>
                          <p className="text-[11px] capitalize text-muted-foreground">{k}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {((details.ingredients as unknown[]) ?? []).length > 0 && (
                <div className="mt-4">
                  <p className="text-base font-bold">Ingredients</p>
                  <ul className="mt-2 list-inside list-disc text-sm">
                    {((details.ingredients as unknown[]) ?? []).map((it, i) => (
                      <li key={i}>{String(it)}</li>
                    ))}
                  </ul>
                </div>
              )}

              {((details.instructions as unknown[]) ?? []).length > 0 && (
                <div className="mt-4">
                  <p className="text-base font-bold">Instructions</p>
                  <ol className="mt-2 list-inside list-decimal text-sm">
                    {((details.instructions as unknown[]) ?? []).map((it, i) => (
                      <li key={i} className="mb-1">
                        {String(it)}
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {((details.tags as unknown[]) ?? []).length > 0 && (
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {((details.tags as unknown[]) ?? []).map((t, i) => (
                    <span
                      key={i}
                      className="rounded-full bg-secondary px-2.5 py-1 text-xs text-muted-foreground"
                    >
                      {String(t)}
                    </span>
                  ))}
                </div>
              )}
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
        <EditRecipeDialog
          recipe={editing}
          tags={tags}
          difficulties={difficulties}
          onClose={() => setEditing(null)}
          onSaved={refreshStats}
        />
      )}

      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setDeleting(null)}
          title="Delete Recipe"
          description="Are you sure you want to delete this recipe? This action cannot be undone."
          confirmLabel="Delete"
          destructive
          onConfirm={async () => {
            try {
              await deleteRecipe(deleting.id, deleting.imageUrl as string | undefined);
              refreshStats();
              toast.success('Recipe deleted successfully!');
            } catch (e) {
              toast.error(e instanceof Error ? e.message : 'Failed to delete recipe');
            }
          }}
        />
      )}
    </div>
  );
}

function EditRecipeDialog({
  recipe,
  tags,
  difficulties,
  onClose,
  onSaved,
}: {
  recipe: RecipeRow;
  tags: string[];
  difficulties: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<FormState>(() => formFrom(recipe));
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await updateRecipe(recipe.id, toInput(form), {
        newImageFile: imageFile,
        currentImageUrl: recipe.imageUrl as string | undefined,
      });
      toast.success('Recipe updated successfully!');
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update recipe');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[88vh] max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit Recipe</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <RecipeForm
            form={form}
            setForm={setForm}
            imageFile={imageFile}
            setImageFile={setImageFile}
            currentImageUrl={recipe.imageUrl as string | undefined}
            tags={tags}
            difficulties={difficulties}
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
