import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ChevronDown, ChevronRight, Loader2, Plus, Save, SquarePen, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { adminApi, ApiException } from '@/lib/api-client';
import { useSaveProgram, useUploadProgramCover } from '@/hooks/use-program-catalog';
import {
  blobPath,
  programReferencedCodes,
  programSessionCount,
  sessionExerciseCodes,
  type ProgramDoc,
  type ProgramStyle,
  type SessionDoc,
  type SupersetDoc,
  type WeekDoc,
} from '@/types/program-catalog';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { ExerciseCodeList } from '@/components/common/exercise-code-list';
import { ProgramCoverField } from '@/components/common/program-cover-field';
import { SupersetEditorDialog } from '@/components/common/superset-editor-dialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

/// Edit one program: weeks down the left, the selected week's sessions on the
/// right, each session holding three ordered lists of exercise codes.
///
/// Saving sends the WHOLE program — the API replaces `weeks` wholesale rather
/// than merging, because a merge would combine arrays by index and silently keep
/// a day you deleted.

const MAX_COVER_BYTES = 8 * 1024 * 1024;
const extensionOf = (fileName: string) => (fileName.includes('.') ? fileName.split('.').pop()! : '');

/// A structural clone so edits stay local to the editor until Save — the list
/// behind it must not mutate under the admin while they are still deciding.
const cloneProgram = (p: ProgramDoc): ProgramDoc => ({
  ...p,
  tags: [...p.tags],
  weeks: p.weeks.map((w) => ({
    ...w,
    sessions: w.sessions.map((s) => ({
      ...s,
      warmups: s.warmups.map(cloneEntry),
      exercises: s.exercises.map(cloneEntry),
      cooldowns: s.cooldowns.map(cloneEntry),
      supersets: s.supersets.map((g) => ({ ...g, exercises: [...g.exercises] })),
    })),
  })),
});

const cloneEntry = (e: SessionDoc['warmups'][number]) => ({
  ...e,
  prescription: e.prescription ? { ...e.prescription } : undefined,
});

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="pl-3.5 pt-1 text-center">
      <p className="tabular text-[17px] font-bold text-primary">{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

function SessionCard({
  session,
  onTouch,
  onRemove,
  saving,
}: {
  session: SessionDoc;
  onTouch: (mutate: () => void) => void;
  onRemove: () => void;
  saving: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [editingSuperset, setEditingSuperset] = useState<{ existing: SupersetDoc | null } | null>(
    null,
  );

  const sessionCodes = [
    ...sessionExerciseCodes(session.warmups),
    ...sessionExerciseCodes(session.exercises),
    ...sessionExerciseCodes(session.cooldowns),
  ];

  const nextLabel = String.fromCharCode(
    'A'.charCodeAt(0) + Math.min(25, Math.max(0, session.supersets.length)),
  );

  return (
    <div className="mb-3 rounded-[10px] border border-input bg-card">
      <div className="flex items-center gap-2 p-3">
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          {open ? (
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">
              Day {session.dayNumber} · {session.name}
            </span>
            <span className="block text-[11.5px] text-muted-foreground">
              {session.warmups.length} warmup · {session.exercises.length} main ·{' '}
              {session.cooldowns.length} cooldown
              {session.supersets.length > 0 ? ` · ${session.supersets.length} superset` : ''}
            </span>
          </span>
        </button>
        <Button variant="ghost" size="icon-sm" title="Remove this session" onClick={onRemove}>
          <Trash2 className="size-[19px] text-red-400" />
        </Button>
      </div>

      {open && (
        <div className="px-4 pb-4">
          <div className="mb-2.5">
            <Label className="mb-1.5 block text-[11.5px] text-muted-foreground">Session name</Label>
            <Input
              value={session.name}
              onChange={(e) => onTouch(() => (session.name = e.target.value))}
            />
          </div>
          <div className="mb-3.5">
            <Label className="mb-1.5 block text-[11.5px] text-muted-foreground">Description</Label>
            <Input
              value={session.description}
              onChange={(e) => onTouch(() => (session.description = e.target.value))}
            />
          </div>

          <ExerciseCodeList
            label="Warm-up"
            entries={session.warmups}
            enabled={!saving}
            allowPrescription
            onChange={(v) => onTouch(() => (session.warmups = v))}
          />
          <ExerciseCodeList
            label="Main exercises"
            entries={session.exercises}
            enabled={!saving}
            allowPrescription
            onChange={(v) => onTouch(() => (session.exercises = v))}
          />
          <ExerciseCodeList
            label="Cool-down"
            entries={session.cooldowns}
            enabled={!saving}
            allowPrescription
            onChange={(v) => onTouch(() => (session.cooldowns = v))}
          />

          {/* Supersets: groups performed back to back, driving the app's workout
              state machine. Kept below the three lists because a superset refers
              to exercises those lists already contain. */}
          <div className="mt-1">
            <div className="flex items-center gap-2">
              <span className="text-[12.5px] font-bold">Supersets</span>
              <span className="text-[11.5px] text-muted-foreground">{session.supersets.length}</span>
              <Button
                variant="link"
                size="sm"
                className="ml-auto h-auto p-0"
                onClick={() => setEditingSuperset({ existing: null })}
              >
                <Plus className="size-[15px]" /> Add superset
              </Button>
            </div>

            {session.supersets.length === 0 ? (
              <p className="text-xs text-muted-foreground">None</p>
            ) : (
              session.supersets.map((group, i) => (
                <div
                  key={`${group.groupId}-${i}`}
                  className="mb-1.5 flex items-center gap-2.5 rounded-md border border-border bg-muted/40 px-2.5 py-2"
                >
                  <span className="rounded bg-primary/[0.09] px-1.5 py-0.5 text-[11px] font-bold text-primary">
                    {group.groupId}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[11.5px] text-slate-700 dark:text-slate-300">
                    {group.exercises.join(' → ')}  ·  {group.rounds} rounds  ·{' '}
                    {group.setsPerExercise} set{group.setsPerExercise === 1 ? '' : 's'} each
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title="Edit"
                    onClick={() => setEditingSuperset({ existing: group })}
                  >
                    <SquarePen className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title="Remove"
                    onClick={() =>
                      onTouch(() => {
                        session.supersets = session.supersets.filter((g) => g !== group);
                      })
                    }
                  >
                    <Trash2 className="size-4 text-red-400" />
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {editingSuperset && (
        <SupersetEditorDialog
          superset={
            editingSuperset.existing ?? {
              groupId: nextLabel,
              rounds: 2,
              setsPerExercise: 1,
              exercises: [],
            }
          }
          sessionCodes={sessionCodes}
          onCancel={() => setEditingSuperset(null)}
          onDone={(next) => {
            const existing = editingSuperset.existing;
            onTouch(() => {
              const at = existing == null ? -1 : session.supersets.indexOf(existing);
              if (at >= 0) session.supersets[at] = next;
              else session.supersets = [...session.supersets, next];
            });
            setEditingSuperset(null);
          }}
        />
      )}
    </div>
  );
}

export function ProgramEditorDialog({
  program: source,
  onClose,
}: {
  program: ProgramDoc;
  onClose: () => void;
}) {
  const [program] = useState<ProgramDoc>(() => cloneProgram(source));
  const [, forceRender] = useState(0);
  const [name, setName] = useState(program.name);
  const [description, setDescription] = useState(program.description);
  const [tagsText, setTagsText] = useState(program.tags.join(', '));

  const [weekIndex, setWeekIndex] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [coverName, setCoverName] = useState<string | null>(null);
  const [removingWeek, setRemovingWeek] = useState<number | null>(null);

  const save = useSaveProgram();
  const uploadCover = useUploadProgramCover();
  const saving = save.isPending;
  const uploadingCover = uploadCover.isPending;

  useEffect(() => {
    let cancelled = false;
    async function loadCoverPreview() {
      if (!program.imageUrl) return;
      if (program.imageUrl.startsWith('http')) {
        setCoverUrl(program.imageUrl);
        return;
      }
      const path = blobPath(program.imageUrl);
      if (!path) return;
      try {
        const urls = await adminApi.signMedia([path]);
        if (!cancelled) setCoverUrl(urls[path] ?? null);
      } catch {
        // Preview is decorative; a failed sign must not block editing.
      }
    }
    void loadCoverPreview();
    return () => {
      cancelled = true;
    };
  }, [program.imageUrl]);

  /// The program object is mutated in place (as the Flutter editor did), so a
  /// render has to be forced explicitly. Everything funnels through here so the
  /// dirty flag and the cleared error can never be forgotten at a call site.
  function touch(mutate: () => void) {
    mutate();
    setDirty(true);
    setError(null);
    forceRender((n) => n + 1);
  }

  const week: WeekDoc | null =
    program.weeks.length === 0
      ? null
      : program.weeks[Math.min(Math.max(weekIndex, 0), program.weeks.length - 1)];

  function addWeek() {
    touch(() => {
      const number =
        program.weeks.length === 0 ? 1 : Math.max(...program.weeks.map((w) => w.weekNumber)) + 1;
      program.weeks.push({ weekNumber: number, name: `Week ${number}`, sessions: [] });
      // Keep totalWeeks honest — the app shows it on the program card, and a
      // mismatch is the "12 Weeks" label lying about an 8-week plan.
      program.totalWeeks = program.weeks.length;
    });
    setWeekIndex(program.weeks.length - 1);
  }

  function removeWeek(index: number) {
    touch(() => {
      program.weeks.splice(index, 1);
      // Renumber so the remaining weeks stay 1..n — the app derives week ids
      // (`P01_W03`) from these numbers, so a gap would produce an id nothing
      // else references.
      program.weeks.forEach((w, i) => (w.weekNumber = i + 1));
      program.totalWeeks = program.weeks.length;
    });
    setWeekIndex((i) => Math.min(Math.max(i, 0), Math.max(0, program.weeks.length - 1)));
  }

  function addSession(target: WeekDoc) {
    touch(() => {
      const day =
        target.sessions.length === 0
          ? 1
          : Math.max(...target.sessions.map((s) => s.dayNumber)) + 1;
      target.sessions.push({
        dayNumber: day,
        name: `Session ${day}`,
        description: '',
        imageUrl: '',
        warmups: [],
        exercises: [],
        cooldowns: [],
        supersets: [],
      });
    });
  }

  async function pickCover(file: File) {
    if (file.size > MAX_COVER_BYTES) {
      setError('Cover images must be 8 MB or smaller.');
      return;
    }
    setCoverPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
    setCoverName(file.name);
    setError(null);

    try {
      const path = await uploadCover.mutateAsync({
        id: program.id,
        extension: extensionOf(file.name),
        file,
      });
      program.imageUrl = path;
      setCoverUrl(path.startsWith('http') ? path : null);
    } catch (e) {
      setError(
        e instanceof ApiException
          ? e.message
          : `Cover upload failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  async function onSave() {
    setError(null);
    program.name = name.trim();
    program.description = description.trim();
    program.tags = tagsText
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 8);
    try {
      await save.mutateAsync(program);
      setDirty(false);
      toast.success(`Saved ${program.id} · every app refetches on next open`);
    } catch (e) {
      // The server names the offending codes; surfacing its message verbatim is
      // more useful than a generic failure.
      setError(
        e instanceof ApiException
          ? e.message
          : `Save failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  const referencedCount = useMemo(() => programReferencedCodes(program).size, [program, dirty]);

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent hideClose className="h-[92vh] max-w-[1400px]">
        <div className="flex h-16 shrink-0 items-center gap-3 border-b border-border px-4">
          <DialogTitle className="text-[17px] font-bold">
            {program.id} · {name}
          </DialogTitle>
          <div className="flex-1" />
          {dirty && (
            <span className="text-[12.5px] text-orange-700 dark:text-orange-400">
              Unsaved changes
            </span>
          )}
          <Button disabled={saving || !dirty || uploadingCover} onClick={() => void onSave()}>
            {saving ? <Loader2 className="animate-spin" /> : <Save />} Save program
          </Button>
          <Button variant="ghost" size="icon-sm" disabled={saving} onClick={onClose}>
            <X />
          </Button>
        </div>

        {error && (
          <div className="flex shrink-0 items-start gap-2 bg-red-50 px-4 py-2.5 dark:bg-red-950/40">
            <AlertCircle className="mt-0.5 size-[18px] shrink-0 text-red-700 dark:text-red-400" />
            <p className="select-text text-[13px] text-red-900 dark:text-red-300">{error}</p>
          </div>
        )}

        <div className="flex shrink-0 items-start gap-3 border-b border-border p-4">
          <div className="flex-[2]">
            <Label className="mb-1.5 block text-[11.5px] text-muted-foreground">Program name</Label>
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setDirty(true);
                setError(null);
              }}
            />
          </div>
          <div className="flex-[3]">
            <Label className="mb-1.5 block text-[11.5px] text-muted-foreground">
              Description (shown on the program card)
            </Label>
            <Textarea
              rows={2}
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                setDirty(true);
                setError(null);
              }}
            />
          </div>
          <div className="w-[168px] shrink-0">
            <ProgramCoverField
              enabled={!saving && !uploadingCover}
              busy={uploadingCover}
              height={88}
              previewUrl={coverPreview}
              networkUrl={coverUrl}
              fileName={coverName}
              onPick={(file) => void pickCover(file)}
            />
          </div>
          <Stat value={program.weeks.length} label="weeks" />
          <Stat value={programSessionCount(program)} label="sessions" />
          <Stat value={referencedCount} label="exercises" />
        </div>

        <div className="flex shrink-0 flex-wrap items-end gap-3 border-b border-border px-4 py-3">
          <div className="min-w-[200px] flex-[2]">
            <Label className="mb-1.5 block text-[11.5px] text-muted-foreground">
              Tags (comma-separated, shown on the program card)
            </Label>
            <Input
              value={tagsText}
              placeholder="at Home"
              onChange={(e) => {
                setTagsText(e.target.value);
                setDirty(true);
                setError(null);
              }}
            />
          </div>
          <div className="w-[92px] shrink-0">
            <Label className="mb-1.5 block text-[11.5px] text-muted-foreground">Days/week</Label>
            <Input
              inputMode="numeric"
              value={program.daysPerWeek ?? 5}
              onChange={(e) =>
                touch(() => {
                  const n = Number.parseInt(e.target.value.trim(), 10);
                  program.daysPerWeek = Number.isInteger(n) && n >= 1 && n <= 7 ? n : program.daysPerWeek;
                })
              }
            />
          </div>
          <div className="w-[140px] shrink-0">
            <Label className="mb-1.5 block text-[11.5px] text-muted-foreground">Style</Label>
            <Select
              value={program.style ?? 'standard'}
              onValueChange={(v) => touch(() => (program.style = v as ProgramStyle))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="standard">Standard</SelectItem>
                <SelectItem value="cycleSync">Cycle sync</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex h-9 items-center gap-2 pb-0.5">
            <Switch
              checked={program.withTrainer !== false}
              onCheckedChange={(checked) => touch(() => (program.withTrainer = checked))}
            />
            <span className="text-[12px] text-muted-foreground">with Trainer</span>
          </div>
          <div className="w-[80px] shrink-0">
            <Label className="mb-1.5 block text-[11.5px] text-muted-foreground">Sets</Label>
            <Input
              inputMode="numeric"
              value={program.defaultSets ?? ''}
              placeholder="3"
              onChange={(e) =>
                touch(() => {
                  const t = e.target.value.trim();
                  if (!t) {
                    program.defaultSets = undefined;
                    return;
                  }
                  const n = Number.parseInt(t, 10);
                  if (Number.isInteger(n) && n > 0) program.defaultSets = n;
                })
              }
            />
          </div>
          <div className="w-[80px] shrink-0">
            <Label className="mb-1.5 block text-[11.5px] text-muted-foreground">Reps</Label>
            <Input
              inputMode="numeric"
              value={program.defaultReps ?? ''}
              placeholder="10"
              onChange={(e) =>
                touch(() => {
                  const t = e.target.value.trim();
                  if (!t) {
                    program.defaultReps = undefined;
                    return;
                  }
                  const n = Number.parseInt(t, 10);
                  if (Number.isInteger(n) && n > 0) program.defaultReps = n;
                })
              }
            />
          </div>
          <div className="w-[110px] shrink-0">
            <Label className="mb-1.5 block text-[11.5px] text-muted-foreground">Cardio (sec)</Label>
            <Input
              inputMode="numeric"
              value={program.cardioDurationSeconds ?? ''}
              placeholder="1200"
              onChange={(e) =>
                touch(() => {
                  const t = e.target.value.trim();
                  if (!t) {
                    program.cardioDurationSeconds = undefined;
                    return;
                  }
                  const n = Number.parseInt(t, 10);
                  if (Number.isInteger(n) && n > 0) program.cardioDurationSeconds = n;
                })
              }
            />
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          <div className="flex w-[220px] shrink-0 flex-col border-r border-border">
            <div className="scrollbar-thin flex-1 overflow-y-auto py-1">
              {program.weeks.map((w, i) => {
                const selected = i === weekIndex;
                return (
                  <div
                    key={`${w.weekNumber}-${i}`}
                    className={cn(
                      'group flex items-center gap-1 px-2',
                      selected && 'bg-primary/[0.06]',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setWeekIndex(i)}
                      className="min-w-0 flex-1 py-2 text-left"
                    >
                      <span
                        className={cn(
                          'block text-[13.5px]',
                          selected ? 'font-bold text-primary' : 'font-medium',
                        )}
                      >
                        Week {w.weekNumber}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {w.sessions.length} sessions · {w.name}
                      </span>
                    </button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title={`Remove week ${w.weekNumber}`}
                      onClick={() => setRemovingWeek(i)}
                    >
                      <X className="size-[15px] text-muted-foreground" />
                    </Button>
                  </div>
                );
              })}
            </div>
            <div className="border-t border-border p-1.5">
              <Button variant="ghost" size="sm" className="w-full" onClick={addWeek}>
                <Plus /> Add week
              </Button>
            </div>
          </div>

          <div className="scrollbar-thin min-w-0 flex-1 overflow-y-auto p-4">
            {week == null ? (
              <p className="py-16 text-center text-[13px] text-muted-foreground">
                No weeks yet. Add one to start.
              </p>
            ) : (
              <>
                <div className="mb-3.5 flex items-end gap-3">
                  <div className="min-w-0 flex-1">
                    <Label className="mb-1.5 block text-[11.5px] text-muted-foreground">
                      Week name
                    </Label>
                    <Input
                      value={week.name}
                      onChange={(e) => touch(() => (week.name = e.target.value))}
                    />
                  </div>
                  <Button variant="outline" onClick={() => addSession(week)}>
                    <Plus /> Add session
                  </Button>
                </div>

                {week.sessions.map((s, i) => (
                  <SessionCard
                    key={`${s.dayNumber}-${i}`}
                    session={s}
                    saving={saving}
                    onTouch={touch}
                    onRemove={() =>
                      touch(() => {
                        week.sessions = week.sessions.filter((x) => x !== s);
                      })
                    }
                  />
                ))}

                {week.sessions.length === 0 && (
                  <p className="pt-10 text-center text-[13px] leading-relaxed text-muted-foreground">
                    This week has no sessions.
                    <br />A week with no sessions will be rejected on save.
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </DialogContent>

      {removingWeek != null && program.weeks[removingWeek] && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setRemovingWeek(null)}
          title={`Remove week ${program.weeks[removingWeek].weekNumber}?`}
          description={`This deletes ${program.weeks[removingWeek].sessions.length} session${
            program.weeks[removingWeek].sessions.length === 1 ? '' : 's'
          } from the plan. Users partway through this program keep their progress rows, but this week will no longer exist for them.`}
          confirmLabel="Remove"
          destructive
          onConfirm={() => removeWeek(removingWeek)}
        />
      )}
    </Dialog>
  );
}
