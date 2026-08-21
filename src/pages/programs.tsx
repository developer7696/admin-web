import { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Plus, RefreshCw, SquarePen, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import {
  programDetailKey,
  programListKey,
  useDeleteProgram,
  useProgramDetail,
  useProgramList,
  useProgramMedia,
} from '@/hooks/use-program-catalog';
import { useExerciseCatalog } from '@/hooks/use-exercise-catalog';
import { useMediaQuery } from '@/hooks/use-media-query';
import {
  programImageSrc,
  programIsIncomplete,
  programSessionCount,
  sessionExerciseCodes,
  sessionTotalExercises,
  type ProgramDoc,
  type SessionDoc,
  type WeekDoc,
} from '@/types/program-catalog';
import type { ExerciseMedia } from '@/types/exercise-catalog';
import { AzureVideo } from '@/components/common/azure-video';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { ErrorState, LoadingState } from '@/components/common/states';
import { PageBar } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { NewProgramDialog } from './new-program-dialog';
import { ProgramEditorDialog } from './program-editor';

/// The programs screen: which programs exist, what each one contains, and a way
/// into the editor.
///
/// Editing a program changes what every user's workout plan contains, so the
/// list stays plain and the pane is read-only — reviewing a program never puts
/// you one stray click away from changing it.

/// One exercise as a thumbnail, clicked to see its photo and video.
///
/// A code with no matching exercise renders as a visibly broken tile rather than
/// being skipped — a session naming an exercise that does not exist is exactly
/// the thing worth catching here.
function ExerciseThumb({ code }: { code: string }) {
  const [showing, setShowing] = useState(false);

  // The snapshot is read rather than just the exercise, because "the catalogue
  // has not loaded" and "loaded, and this code is not in it" must stay
  // distinguishable — otherwise every chip reads as missing while the fetch is
  // in flight.
  const { data: snapshot } = useExerciseCatalog();
  const row = snapshot?.byId.get(code);
  const missing = snapshot != null && row == null;
  const url = row?.media.imageUrl;

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            disabled={row == null}
            onClick={() => setShowing(true)}
            className={cn(
              'size-[54px] shrink-0 overflow-hidden rounded-[7px]',
              row != null && 'cursor-pointer',
            )}
          >
            {url ? (
              <img src={url} alt={code} loading="lazy" className="size-full object-cover" />
            ) : (
              <span
                className={cn(
                  'flex size-full items-center justify-center text-[9.5px] font-bold',
                  missing
                    ? 'border border-orange-500/50 bg-orange-500/10 text-orange-800 dark:text-orange-400'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {code}
              </span>
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent>
          {missing ? `${code} — not in the catalogue` : `${code}  ${row?.name ?? ''}`}
        </TooltipContent>
      </Tooltip>

      {showing && row && (
        <ExerciseMediaDialog
          code={code}
          name={row.name}
          media={row.media}
          onClose={() => setShowing(false)}
        />
      )}
    </>
  );
}

function ExerciseMediaDialog({
  code,
  name,
  media,
  onClose,
}: {
  code: string;
  name: string;
  media: ExerciseMedia;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-[15px]">
            {code} · {name}
          </DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          {media.imageUrl && (
            <img src={media.imageUrl} alt={name} className="h-[190px] w-full rounded-lg object-cover" />
          )}
          {media.videoUrl && <AzureVideo url={media.videoUrl} height={230} className="rounded-lg" />}
          {!media.imageUrl && !media.videoUrl && (
            <p className="py-8 text-center text-sm text-muted-foreground">No media linked.</p>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

/// One session: the phases it is built from, then a strip of thumbnails.
///
/// The phase counts matter more than the total — a session with no warmup, or
/// one that is all cooldown, is a content mistake the old single number hid.
function SessionBlock({ session }: { session: SessionDoc }) {
  const codes = sessionExerciseCodes([...session.warmups, ...session.exercises, ...session.cooldowns]);
  const phases = [
    { label: 'warmup', n: session.warmups.length, tint: 'text-amber-600' },
    { label: 'main', n: session.exercises.length, tint: 'text-primary' },
    { label: 'cooldown', n: session.cooldowns.length, tint: 'text-emerald-600' },
  ].filter((p) => p.n > 0);

  return (
    <div className="mb-4 rounded-[9px] border border-border/70 bg-background/60 p-2.5">
      <div className="flex items-center gap-2">
        <span className="shrink-0 rounded bg-primary/[0.08] px-1.5 py-0.5 text-[10px] font-bold text-primary">
          Day {session.dayNumber}
        </span>
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">
          {session.name || '—'}
        </span>
        <span className="tabular shrink-0 text-[11px] font-semibold text-muted-foreground">
          {sessionTotalExercises(session)}
        </span>
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[10.5px]">
        {phases.length === 0 ? (
          <span className="text-orange-600 dark:text-orange-400">No exercises</span>
        ) : (
          phases.map((p) => (
            <span key={p.label} className={p.tint}>
              <span className="tabular font-bold">{p.n}</span> {p.label}
            </span>
          ))
        )}
        {session.supersets.length > 0 && (
          <span className="text-muted-foreground">{session.supersets.length} superset</span>
        )}
      </div>

      {codes.length > 0 && (
        <div className="scrollbar-thin mt-2 flex gap-1.5 overflow-x-auto pb-1">
          {codes.map((code, i) => (
            <ExerciseThumb key={`${code}-${i}`} code={code} />
          ))}
        </div>
      )}
    </div>
  );
}

/// One week, collapsed by default — 12 weeks expanded at once is unreadable.
/// Open state is owned by the pane so "expand all" can drive every tile.
function WeekTile({
  week,
  open,
  onToggle,
}: {
  week: WeekDoc;
  open: boolean;
  onToggle: () => void;
}) {
  const sessionCount = week.sessions.length;
  return (
    <div className="mb-1.5 overflow-hidden rounded-[10px] border border-border bg-card">
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          'flex w-full items-center gap-2.5 px-2.5 py-2.5 text-left transition-colors hover:bg-muted/50',
          open && 'border-b border-border bg-muted/40',
        )}
      >
        <span className="tabular flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/[0.08] text-[12px] font-extrabold text-primary">
          {week.weekNumber}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-bold">
            {week.name || `Week ${week.weekNumber}`}
          </span>
          <span
            className={cn(
              'block text-[11px]',
              sessionCount === 0 ? 'text-orange-600 dark:text-orange-400' : 'text-muted-foreground',
            )}
          >
            {sessionCount === 0 ? 'No sessions' : `${sessionCount} sessions`}
          </span>
        </span>
        {open ? (
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        )}
      </button>
      {open && sessionCount > 0 && (
        <div className="p-2.5 pb-0.5">
          {week.sessions.map((s, i) => (
            <SessionBlock key={`${s.dayNumber}-${i}`} session={s} />
          ))}
        </div>
      )}
    </div>
  );
}

/// A headline number and what it counts.
function StatCell({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="flex-1 px-1 text-center">
      <p className="tabular text-[17px] font-extrabold leading-none">{value}</p>
      <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.5px] text-muted-foreground">
        {label}
      </p>
    </div>
  );
}

/// Read-only pane: a program's artwork, then its weeks and sessions with each
/// session's exercises shown as photo thumbnails.
///
/// The list can only say "12 weeks · 60 sessions". The point of the pane is to
/// see what a session actually contains without opening the editor — the
/// thumbnails come from the exercise catalogue's Azure media, so a session
/// referencing a broken or wrong exercise is visible at a glance.
function ProgramDetailPane({
  programId,
  onClose,
  onOpenEditor,
  onDelete,
  embedded = false,
}: {
  programId: string;
  onClose: () => void;
  onOpenEditor: (program: ProgramDoc) => void;
  onDelete: () => void;
  embedded?: boolean;
}) {
  const { data: program, isLoading, error } = useProgramDetail(programId);
  const { data: media } = useProgramMedia(program);
  const hero = program ? programImageSrc(program.imageUrl, media) : null;

  const [openWeeks, setOpenWeeks] = useState<Set<number>>(new Set());
  const allOpen = program != null && program.weeks.length > 0 && openWeeks.size === program.weeks.length;

  const exerciseTotal = program
    ? program.weeks.reduce(
        (sum, w) => sum + w.sessions.reduce((s, sess) => s + sessionTotalExercises(sess), 0),
        0,
      )
    : 0;

  // The app's program card shows `totalWeeks`, so a mismatch means that label is
  // promising weeks the plan does not actually contain.
  const shortBy = program ? program.totalWeeks - program.weeks.length : 0;

  const body = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b border-border py-2.5 pl-[18px] pr-2">
        <span className="text-xs font-bold text-primary">{programId}</span>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          disabled={!program}
          onClick={() => program && onOpenEditor(program)}
        >
          <SquarePen className="size-[15px]" /> Edit
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={onDelete} title="Delete program">
          <Trash2 className="size-[18px] text-red-400" />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={onClose} title="Close">
          <X className="size-[18px] text-muted-foreground" />
        </Button>
      </div>

      <div className="scrollbar-thin flex-1 overflow-y-auto pb-6">
        {isLoading && <LoadingState />}
        {error && <ErrorState error={error} />}

        {program && (
          <>
            {/* Artwork carries the title rather than sitting above it — this is
                roughly how the program reads on the app's own card. */}
            <div className="relative h-[168px] w-full overflow-hidden bg-gradient-to-br from-primary to-[#5B21D6]">
              {hero && <img src={hero} alt="" className="size-full object-cover" />}
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-3.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  {program.style === 'cycleSync' && (
                    <span className="rounded bg-white/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.4px] text-white backdrop-blur-sm">
                      Cycle sync
                    </span>
                  )}
                  {program.withTrainer && (
                    <span className="rounded bg-white/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.4px] text-white backdrop-blur-sm">
                      With trainer
                    </span>
                  )}
                  {program.daysPerWeek != null && program.daysPerWeek > 0 && (
                    <span className="rounded bg-white/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.4px] text-white backdrop-blur-sm">
                      {program.daysPerWeek}×/week
                    </span>
                  )}
                </div>
                <h2 className="mt-1.5 text-[17px] font-extrabold leading-tight text-white drop-shadow">
                  {program.name || '—'}
                </h2>
              </div>
            </div>

            <div className="flex items-center border-b border-border py-3">
              <StatCell value={program.weeks.length} label="Weeks" />
              <div className="h-7 w-px bg-border" />
              <StatCell value={programSessionCount(program)} label="Sessions" />
              <div className="h-7 w-px bg-border" />
              <StatCell value={exerciseTotal} label="Exercises" />
            </div>

            <div className="px-[18px] pt-3.5">
              {shortBy !== 0 && (
                <div className="mb-3 flex items-start gap-2 rounded-lg bg-orange-100 px-3 py-2 dark:bg-orange-950/40">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-orange-700 dark:text-orange-400" />
                  <p className="text-[11.5px] text-orange-900 dark:text-orange-300">
                    Card claims <b>{program.totalWeeks} weeks</b> but the plan holds{' '}
                    <b>{program.weeks.length}</b>.
                  </p>
                </div>
              )}

              {program.description && (
                <p className="text-[12.5px] leading-relaxed text-slate-700 dark:text-slate-300">
                  {program.description}
                </p>
              )}

              {program.tags.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {program.tags.map((t) => (
                    <span
                      key={t}
                      className="rounded-full border border-input bg-background px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}

              <div className="mb-2 mt-5 flex items-center gap-2">
                <span className="text-[10px] font-extrabold uppercase tracking-[1px] text-muted-foreground">
                  Weeks
                </span>
                <div className="h-px flex-1 bg-border" />
                {program.weeks.length > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      setOpenWeeks(
                        allOpen ? new Set() : new Set(program.weeks.map((w) => w.weekNumber)),
                      )
                    }
                    className="text-[11px] font-semibold text-primary hover:underline"
                  >
                    {allOpen ? 'Collapse all' : 'Expand all'}
                  </button>
                )}
              </div>

              {program.weeks.length === 0 ? (
                <p className="py-6 text-center text-[12.5px] text-muted-foreground">
                  This program has no weeks yet.
                </p>
              ) : (
                program.weeks.map((w) => (
                  <WeekTile
                    key={w.weekNumber}
                    week={w}
                    open={openWeeks.has(w.weekNumber)}
                    onToggle={() =>
                      setOpenWeeks((prev) => {
                        const next = new Set(prev);
                        if (next.has(w.weekNumber)) next.delete(w.weekNumber);
                        else next.add(w.weekNumber);
                        return next;
                      })
                    }
                  />
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );

  if (embedded) return body;

  return (
    <aside className="mb-6 flex w-[420px] shrink-0 flex-col border-l border-border bg-card">
      {body}
    </aside>
  );
}

export function ProgramsPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ProgramDoc | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const qc = useQueryClient();
  const { data: rows, isLoading, error } = useProgramList();
  const remove = useDeleteProgram();

  // Tailwind's `xl` — the width at which the side pane fits beside the list.
  const wideEnoughForPane = useMediaQuery('(min-width: 1280px)');

  async function runDelete(id: string) {
    try {
      await remove.mutateAsync(id);
      if (selectedId === id) setSelectedId(null);
      toast.success(`${id} deleted`);
    } catch (e) {
      toast.error(`Could not delete ${id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const deletingName = rows?.find((p) => p.id === deleting)?.name ?? deleting;

  return (
    <div className="mx-auto flex h-full max-w-[1560px] flex-col">
      <PageBar
        title="Programs"
        status={`${rows?.length ?? 0} programs · editing one changes the plan every user follows`}
        className="px-4 pb-3 pt-4"
      >
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus /> New program
        </Button>
        <Button
          variant="outline"
          size="sm"
          title="Reload"
          onClick={() => {
            void qc.invalidateQueries({ queryKey: programListKey });
            if (selectedId) void qc.invalidateQueries({ queryKey: programDetailKey(selectedId) });
          }}
        >
          <RefreshCw />
        </Button>
      </PageBar>

      <div className="flex min-h-0 flex-1">
        <div className="scrollbar-thin min-w-0 flex-1 overflow-y-auto px-6 pb-6">
          {isLoading && <LoadingState />}
          {error && <ErrorState error={error} />}
          {rows?.length === 0 && (
            <p className="py-16 text-center text-[13px] text-muted-foreground">No programs yet.</p>
          )}

          {rows?.map((p) => {
            const isSelected = selectedId === p.id;
            return (
              <button
                key={p.id}
                type="button"
                // Selecting shows the program; the editor stays behind its own
                // button so reviewing never opens an editable form by accident.
                onClick={() => setSelectedId(p.id)}
                className={cn(
                  'mb-2 flex w-full items-center gap-3 rounded-[10px] border px-3 py-3 text-left transition-colors',
                  isSelected
                    ? 'border-primary/45 bg-primary/[0.05]'
                    : 'border-slate-200 bg-card hover:bg-muted/50 dark:border-slate-800',
                )}
              >
                <span className="w-[46px] shrink-0 rounded-md bg-primary/[0.07] py-1.5 text-center text-xs font-bold text-primary">
                  {p.id}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{p.name}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {p.weekCount} weeks · {p.sessionCount} sessions
                  </span>
                </span>

                {programIsIncomplete(p) && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="flex items-center gap-1 rounded-full bg-orange-50 px-2 py-1 text-[11px] font-semibold text-orange-700 dark:bg-orange-950/40 dark:text-orange-400">
                        <AlertTriangle className="size-3.5" />
                        {p.totalWeeks} vs {p.weekCount}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {/* The card in the app shows totalWeeks, so a mismatch is
                          that label promising weeks the plan does not contain. */}
                      Claims {p.totalWeeks} weeks but holds {p.weekCount}
                    </TooltipContent>
                  </Tooltip>
                )}

                <ChevronRight className="size-5 shrink-0 text-slate-400" />
              </button>
            );
          })}
        </div>

        {/* Narrow viewports have no room for the side pane, so the same content
            opens as a dialog. Chosen in JS, not with `xl:hidden`: a hidden but
            open dialog still renders its overlay over the page — and hiding the
            pane with no fallback meant clicking a program below 1280px did
            nothing at all. */}
        {selectedId &&
          (wideEnoughForPane ? (
            <ProgramDetailPane
              key={selectedId}
              programId={selectedId}
              onClose={() => setSelectedId(null)}
              onOpenEditor={setEditing}
              onDelete={() => setDeleting(selectedId)}
            />
          ) : (
            <Dialog open onOpenChange={(open) => !open && setSelectedId(null)}>
              <DialogContent hideClose className="max-h-[760px] max-w-[560px] p-0">
                <DialogTitle className="sr-only">Program {selectedId}</DialogTitle>
                <ProgramDetailPane
                  embedded
                  programId={selectedId}
                  onClose={() => setSelectedId(null)}
                  onOpenEditor={setEditing}
                  onDelete={() => setDeleting(selectedId)}
                />
              </DialogContent>
            </Dialog>
          ))}
      </div>

      {creating && (
        <NewProgramDialog
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            void qc.invalidateQueries({ queryKey: programListKey });
            setSelectedId(id);
          }}
        />
      )}

      {editing && <ProgramEditorDialog program={editing} onClose={() => setEditing(null)} />}

      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setDeleting(null)}
          title={`Delete ${deleting}?`}
          description={`“${deletingName}” will disappear for every user on the next content refresh. This cannot be undone.`}
          confirmLabel="Delete"
          destructive
          onConfirm={() => runDelete(deleting)}
        />
      )}
    </div>
  );
}
