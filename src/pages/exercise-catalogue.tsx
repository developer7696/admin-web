import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Dumbbell,
  Image as ImageIcon,
  ImageOff,
  Package,
  Plus,
  SearchX,
  SquarePen,
  Trash2,
  Video,
  VideoOff,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useDeleteExercise, useExerciseCatalog } from '@/hooks/use-exercise-catalog';
import { useMediaQuery } from '@/hooks/use-media-query';
import { mediaHasImage, mediaHasVideo, mediaIsLinked, type Exercise } from '@/types/exercise-catalog';
import { AzureVideo } from '@/components/common/azure-video';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { HeaderSlot } from '@/app/header-slot';
import { SearchInput } from '@/components/common/search-input';
import { EmptyState, LoadingState } from '@/components/common/states';
import { PageBar } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { ExerciseFormDialog } from './exercise-form';

/// The exercise catalogue: searchable, type-filtered list with a per-exercise
/// edit form.
///
/// This collection is what the app overlays onto its workout library at every
/// cold start, matched by id. Every save (and delete) bumps
/// `content_meta/exercise_catalog.version`, which is how installed apps know to
/// refetch. Delete is refused while a program still names the code.

/// The four exercise types, in the order a session runs.
const TYPES = ['warmup', 'exercise', 'cardio', 'cooldown'] as const;

const TYPE_STYLES: Record<string, { text: string; bg: string; ring: string; solid: string }> = {
  warmup: { text: 'text-amber-600', bg: 'bg-amber-500/[0.08]', ring: 'border-amber-500', solid: 'bg-amber-500' },
  exercise: { text: 'text-primary', bg: 'bg-primary/[0.08]', ring: 'border-primary', solid: 'bg-primary' },
  cardio: { text: 'text-red-500', bg: 'bg-red-500/[0.08]', ring: 'border-red-500', solid: 'bg-red-500' },
  cooldown: { text: 'text-emerald-500', bg: 'bg-emerald-500/[0.08]', ring: 'border-emerald-500', solid: 'bg-emerald-500' },
};

const styleFor = (type: string) => TYPE_STYLES[type] ?? TYPE_STYLES.exercise;
const titleCase = (v: string) => (v ? v[0].toUpperCase() + v.slice(1) : v);

/// The Azure image, or a typed placeholder.
///
/// Orange means the exercise has no image linked — a content gap worth seeing.
/// Plain tinted means one IS linked but has no signed URL yet, which now only
/// happens while the catalogue is still loading.
function Thumbnail({ row }: { row: Exercise }) {
  const [failed, setFailed] = useState(false);
  const url = row.media.imageUrl;
  const style = styleFor(row.type);

  if (url && !failed) {
    return (
      <img
        src={url}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className="size-10 shrink-0 rounded-[7px] object-cover"
      />
    );
  }

  const broken = failed || !mediaHasImage(row.media);
  return (
    <div
      className={cn(
        'flex size-10 shrink-0 items-center justify-center rounded-[7px]',
        broken ? 'bg-orange-500/[0.09] text-orange-600' : cn(style.bg, style.text),
      )}
    >
      {broken ? <ImageOff className="size-[17px]" /> : <Dumbbell className="size-[17px]" />}
    </div>
  );
}

/// Presence indicator for one media kind. Filled means a blob is linked; faded
/// means the exercise names no file, or names one that matched nothing in Azure.
function MediaDot({
  present,
  path,
  kind,
}: {
  present: boolean;
  path: string | null;
  kind: 'video' | 'image';
}) {
  const Icon = kind === 'video' ? Video : ImageIcon;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>
          <Icon className={cn('size-3.5', present ? 'text-slate-500' : 'text-slate-300 dark:text-slate-700')} />
        </span>
      </TooltipTrigger>
      <TooltipContent>{present ? (path ?? '') : 'No file linked'}</TooltipContent>
    </Tooltip>
  );
}

function FilterChip({
  label,
  count,
  selected,
  type,
  onClick,
}: {
  label: string;
  count: number;
  selected: boolean;
  type: string | null;
  onClick: () => void;
}) {
  const style = type == null ? TYPE_STYLES.exercise : styleFor(type);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded-full border px-3 py-1.5 transition-colors',
        selected
          ? cn(style.solid, style.ring, 'text-white')
          : 'border-input bg-card text-slate-700 hover:bg-secondary dark:text-slate-300',
      )}
    >
      <span className="text-[12.5px] font-semibold">{label}</span>
      <span className={cn('tabular text-[11.5px] font-bold', selected ? 'text-white/70' : 'text-muted-foreground')}>
        {count}
      </span>
    </button>
  );
}

function SectionLabel({ text, path }: { text: string; path?: string | null }) {
  return (
    <div>
      <p className="text-[10.5px] font-bold uppercase tracking-[0.6px] text-muted-foreground">{text}</p>
      {path && <p className="mt-0.5 select-text break-all text-[10.5px] text-slate-400">{path}</p>}
    </div>
  );
}

function MediaFallback({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex h-[120px] flex-col items-center justify-center gap-1.5 rounded-[9px] bg-muted text-muted-foreground [&_svg]:size-[22px]">
      {icon}
      <p className="text-[11.5px]">{label}</p>
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="mb-2.5">
      <p className="text-[10.5px] font-semibold text-muted-foreground">{label}</p>
      <p className="mt-0.5 select-text text-[12.5px] leading-relaxed text-slate-700 dark:text-slate-300">
        {value}
      </p>
    </div>
  );
}

/// Side pane showing one exercise's PHOTO and VIDEO together, plus the fields
/// most useful when auditing content.
///
/// The list alone could only ever show one 40px thumbnail and a play button, so
/// checking that an exercise's photo and clip actually match meant opening a
/// dialog per exercise. Here both render at once and the list stays in place,
/// which is what makes reviewing 157 entries in a row practical.
function DetailPane({
  row,
  onClose,
  onEdit,
  onDelete,
  embedded = false,
}: {
  row: Exercise;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  embedded?: boolean;
}) {
  const style = styleFor(row.type);
  const [imageFailed, setImageFailed] = useState(false);

  const body = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-start gap-1 border-b border-border py-3.5 pl-[18px] pr-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={cn('text-[11.5px] font-bold', style.text)}>{row.id}</span>
            <span className={cn('rounded-[5px] px-1.5 py-0.5 text-[10px] font-semibold', style.bg, style.text)}>
              {titleCase(row.type)}
            </span>
          </div>
          {embedded ? (
            <DialogTitle className="mt-1 text-[15px] font-bold">{row.name || '—'}</DialogTitle>
          ) : (
            <p className="mt-1 text-[15px] font-bold">{row.name || '—'}</p>
          )}
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onEdit} title="Edit">
          <SquarePen className="size-[17px] text-muted-foreground" />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={onDelete} title="Delete exercise">
          <Trash2 className="size-[18px] text-red-400" />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={onClose} title="Close">
          <X className="size-[18px] text-muted-foreground" />
        </Button>
      </div>

      <div className="scrollbar-thin flex-1 overflow-y-auto px-[18px] pb-6 pt-4">
        <SectionLabel text="Photo" path={row.media.imagePath} />
        <div className="mt-2">
          {row.media.imageUrl && !imageFailed ? (
            <img
              src={row.media.imageUrl}
              alt={row.name}
              onError={() => setImageFailed(true)}
              className="h-[210px] w-full rounded-[9px] object-cover"
            />
          ) : (
            <MediaFallback
              icon={<ImageOff />}
              label={imageFailed ? 'Image failed to load' : 'No image preview'}
            />
          )}
        </div>

        <div className="mt-[22px]">
          <SectionLabel text="Video" path={row.media.videoPath} />
          <div className="mt-2">
            {row.media.videoUrl ? (
              <AzureVideo url={row.media.videoUrl} height={240} className="rounded-[9px]" />
            ) : (
              <MediaFallback icon={<VideoOff />} label="No video preview" />
            )}
          </div>
        </div>

        <div className="mt-[22px]">
          <SectionLabel text="Details" />
          <div className="mt-2">
            <DetailField label="Target" value={row.targetMuscleGroup} />
            <DetailField label="Secondary" value={row.secondaryMuscleGroup} />
            <DetailField label="Equipment" value={row.equipment} />
            <DetailField label="Reps / hold" value={row.repsHold} />
            <DetailField label="Description" value={row.description} />
          </div>
        </div>
      </div>
    </div>
  );

  if (embedded) return body;

  return (
    <aside className="mb-6 flex w-[380px] shrink-0 flex-col border-l border-border bg-card">{body}</aside>
  );
}

export function ExerciseCataloguePage() {
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Exercise | null>(null);
  const [deleting, setDeleting] = useState<Exercise | null>(null);

  // Tailwind's `xl` — the width at which the side pane fits beside the list.
  const wideEnoughForPane = useMediaQuery('(min-width: 1280px)');

  const { data, isLoading, isError, error } = useExerciseCatalog();
  const remove = useDeleteExercise();

  const rows = data?.exercises ?? [];

  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of rows) map[r.type] = (map[r.type] ?? 0) + 1;
    return map;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (typeFilter != null && r.type !== typeFilter) return false;
      if (!q) return true;
      return r.searchHaystack.includes(q);
    });
  }, [rows, query, typeFilter]);

  /// The selected row, or null when nothing is selected or the selection no
  /// longer matches the current filters (e.g. the admin searched it away).
  const selected = selectedId != null ? (rows.find((r) => r.id === selectedId) ?? null) : null;

  const unlinked = rows.length - rows.filter((r) => mediaIsLinked(r.media)).length;

  async function runDelete(row: Exercise) {
    try {
      await remove.mutateAsync(row.id);
      if (selectedId === row.id) setSelectedId(null);
      toast.success(`${row.id} deleted`);
    } catch (e) {
      toast.error(`Could not delete ${row.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function openForm(initial: Exercise | null) {
    setEditing(initial);
    setFormOpen(true);
  }

  return (
    <div className="mx-auto flex h-full max-w-[1560px] flex-col">
      <div className="px-4 pt-4">
        <PageBar title="Exercises" status={`${rows.length} exercises`}>

          {/* How complete the catalogue's media links are. The rows and their
              signed URLs come back in the same response, so a backend that
              cannot sign produces no list at all and the error state owns that
              case. What is left is the one fact worth a chip. */}
          {rows.length > 0 &&
            (unlinked > 0 ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex items-center gap-1.5 rounded-full bg-orange-50 px-2.5 py-1 text-[11px] font-semibold text-orange-700 dark:bg-orange-950/40 dark:text-orange-400">
                    <AlertTriangle className="size-3.5" /> {unlinked} unlinked
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {unlinked} exercises have no Azure media linked. Check the filename on each, or
                  re-run the catalogue seeder.
                </TooltipContent>
              </Tooltip>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                    <CheckCircle2 className="size-3.5" /> Previews live
                  </span>
                </TooltipTrigger>
                <TooltipContent>All {rows.length} exercises linked, previews signed.</TooltipContent>
              </Tooltip>
            ))}

          <HeaderSlot>
            <SearchInput
              value={query}
              onChange={setQuery}
              variant="header"
              placeholder="Search id, name, muscle…"
              className="w-full max-w-md"
            />
          </HeaderSlot>

          <Button size="sm" onClick={() => openForm(null)}>
            <Plus /> New exercise
          </Button>
        </PageBar>

        {/* One chip per type, each carrying its own count — the counts double as
            a content audit (a type sitting at zero is usually an import that
            missed). */}
        <div className="mt-2.5 flex flex-wrap gap-1.5 pb-2.5">
          <FilterChip
            label="All"
            count={rows.length}
            selected={typeFilter == null}
            type={null}
            onClick={() => setTypeFilter(null)}
          />
          {TYPES.filter((t) => (counts[t] ?? 0) > 0).map((t) => (
            <FilterChip
              key={t}
              label={titleCase(t)}
              count={counts[t] ?? 0}
              selected={typeFilter === t}
              type={t}
              onClick={() => setTypeFilter(typeFilter === t ? null : t)}
            />
          ))}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="scrollbar-thin min-w-0 flex-1 overflow-y-auto px-6 pb-6">
          {isLoading && <LoadingState />}

          {/* A refresh that fails after a successful save keeps the previous
              list (React Query holds it alongside the error), and showing an
              error screen over data we still hold would read as "your save
              failed". Only a first load with nothing behind it reaches here. */}
          {isError && rows.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
              <AlertTriangle className="size-9 text-red-300" />
              <p className="text-sm font-semibold">Could not load the catalogue</p>
              <p className="select-text text-xs text-muted-foreground">
                {error instanceof Error ? error.message : String(error)}
              </p>
            </div>
          )}

          {!isLoading && filtered.length === 0 && rows.length === 0 && (
            <EmptyState
              icon={<Package className="size-9" />}
              title="No exercises yet."
              hint='Use "New exercise" to add one.'
            />
          )}

          {!isLoading && filtered.length === 0 && rows.length > 0 && (
            <EmptyState
              icon={<SearchX className="size-9" />}
              title="Nothing matches your filters."
              action={
                query || typeFilter ? (
                  <Button
                    variant="link"
                    onClick={() => {
                      setQuery('');
                      setTypeFilter(null);
                    }}
                  >
                    Clear filters
                  </Button>
                ) : undefined
              }
            />
          )}

          {filtered.map((row) => {
            const style = styleFor(row.type);
            const isSelected = selectedId === row.id;
            const subtitle = [row.targetMuscleGroup, row.equipment].filter(Boolean).join('  ·  ');

            return (
              <div
                key={row.id}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedId(row.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSelectedId(row.id);
                  }
                }}
                className={cn(
                  'mb-1.5 flex cursor-pointer items-center gap-3 rounded-[10px] border px-3 py-2.5 transition-colors',
                  isSelected
                    ? 'border-primary/45 bg-primary/[0.05]'
                    : 'border-slate-200 bg-card hover:bg-muted/50 dark:border-slate-800',
                )}
              >
                <Thumbnail row={row} />

                <span className={cn('w-[58px] shrink-0 text-[11.5px] font-bold', style.text)}>
                  {row.id}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-semibold">{row.name || '—'}</p>
                  {subtitle && (
                    <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">{subtitle}</p>
                  )}
                </div>

                <span
                  className={cn(
                    'shrink-0 rounded-[5px] px-2 py-0.5 text-[10.5px] font-bold',
                    style.bg,
                    style.text,
                  )}
                >
                  {titleCase(row.type)}
                </span>

                <div className="flex w-[62px] shrink-0 items-center gap-1">
                  <MediaDot kind="video" present={mediaHasVideo(row.media)} path={row.media.videoPath} />
                  <MediaDot kind="image" present={mediaHasImage(row.media)} path={row.media.imagePath} />
                  {row.alternativeCount > 0 && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="ml-1 text-[10.5px] font-semibold text-muted-foreground">
                          +{row.alternativeCount}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>{row.alternativeCount} alternative exercises</TooltipContent>
                    </Tooltip>
                  )}
                </div>

                <Button
                  variant="ghost"
                  size="icon-sm"
                  title="Edit"
                  onClick={(e) => {
                    e.stopPropagation();
                    openForm(row);
                  }}
                >
                  <SquarePen className="size-[17px] text-muted-foreground" />
                </Button>
              </div>
            );
          })}
        </div>

        {/* Narrow viewports would have the side pane squeezing the list too
            hard, so the same content opens as a dialog instead. The choice is
            made in JS, not with `xl:hidden`: a hidden-but-open dialog still
            renders its overlay and still locks the page behind it. */}
        {selected &&
          (wideEnoughForPane ? (
            <DetailPane
              key={selected.id}
              row={selected}
              onClose={() => setSelectedId(null)}
              onEdit={() => openForm(selected)}
              onDelete={() => setDeleting(selected)}
            />
          ) : (
            <Dialog open onOpenChange={(open) => !open && setSelectedId(null)}>
              <DialogContent hideClose className="max-h-[720px] max-w-[520px]">
                <DetailPane
                  embedded
                  row={selected}
                  onClose={() => setSelectedId(null)}
                  onEdit={() => openForm(selected)}
                  onDelete={() => setDeleting(selected)}
                />
              </DialogContent>
            </Dialog>
          ))}
      </div>

      {formOpen && (
        <ExerciseFormDialog
          initial={editing}
          onOpenChange={(open) => {
            setFormOpen(open);
            if (!open) setEditing(null);
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setDeleting(null)}
          title={`Delete ${deleting.id}?`}
          description={`“${deleting.name}” will disappear for every user on the next content refresh. This cannot be undone.`}
          confirmLabel="Delete"
          destructive
          onConfirm={() => runDelete(deleting)}
        />
      )}
    </div>
  );
}
