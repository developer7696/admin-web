import { useMemo, useRef, useState } from 'react';
import { AlertCircle, CloudUpload, Film, Image as ImageIcon, Loader2, Plus, SquarePen } from 'lucide-react';
import { ApiException } from '@/lib/api-client';
import { useSaveExercise, useUploadExerciseMedia } from '@/hooks/use-exercise-catalog';
import { ExercisePatch, type Exercise } from '@/types/exercise-catalog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

/// Create/edit form for one exercise.
///
/// Field names here are the contract with the app's ExerciseTemplateMapper —
/// additive changes only, never rename. Saving bumps the content version, so
/// installed apps pick the change up on their next cold start.
///
/// The dialog owns only its own form state. The write, and the catalogue reload
/// that has to follow it, belong to the mutation hooks.

const TYPE_LABELS: Record<string, string> = {
  warmup: 'Warmup',
  exercise: 'Exercise',
  cardio: 'Cardio',
  cooldown: 'Cooldown',
};

/// Matches the catalogue list's type colours so a type reads the same in the
/// form as it does in the row it will become.
const TYPE_TINT: Record<string, { text: string; border: string; bg: string }> = {
  warmup: { text: 'text-amber-600', border: 'border-amber-500', bg: 'bg-amber-500/10' },
  exercise: { text: 'text-primary', border: 'border-primary', bg: 'bg-primary/10' },
  cardio: { text: 'text-red-500', border: 'border-red-500', bg: 'bg-red-500/10' },
  cooldown: { text: 'text-emerald-500', border: 'border-emerald-500', bg: 'bg-emerald-500/10' },
};

/// A file chosen in the dialog but not yet in Azure.
type PickedFile = { name: string; file: File; previewUrl: string | null };

const ID_RE = /^[A-Za-z0-9_-]+$/;
const extensionOf = (fileName: string) => (fileName.includes('.') ? fileName.split('.').pop()! : '');

type Fields = {
  id: string;
  name: string;
  description: string;
  videoFileName: string;
  imageFileName: string;
  targetMuscleGroup: string;
  secondaryMuscleGroup: string;
  equipment: string;
  defaultRounds: string;
  repsHold: string;
};

export function ExerciseFormDialog({
  initial,
  onOpenChange,
}: {
  /// Null = create. Ids are immutable once created: schedules and workout
  /// history reference them, so renaming would orphan both.
  initial: Exercise | null;
  onOpenChange: (open: boolean) => void;
}) {
  const isNew = initial == null;

  const [fields, setFields] = useState<Fields>({
    id: initial?.id ?? '',
    name: initial?.name ?? '',
    description: initial?.description ?? '',
    videoFileName: initial?.videoFileName ?? '',
    imageFileName: initial?.imageFileName ?? '',
    targetMuscleGroup: initial?.targetMuscleGroup ?? '',
    secondaryMuscleGroup: initial?.secondaryMuscleGroup ?? '',
    equipment: initial?.equipment ?? '',
    defaultRounds: initial?.defaultRounds != null ? String(initial.defaultRounds) : '',
    repsHold: initial?.repsHold ?? '',
  });
  const [type, setType] = useState(initial?.type ?? 'exercise');

  /// Files picked before the exercise exists, uploaded straight after it is
  /// created. Without this the upload buttons had to be dead on a new exercise
  /// — the server derives the blob path from the SAVED document — which meant
  /// save, reopen, then upload for every single new entry.
  const [pending, setPending] = useState<Record<string, PickedFile>>({});

  const [saving, setSaving] = useState(false);
  const [uploadingKind, setUploadingKind] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const save = useSaveExercise();
  const upload = useUploadExerciseMedia();

  const videoInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  /// The id being worked on: the immutable one when editing, otherwise whatever
  /// has been typed so far.
  const id = initial?.id ?? fields.id.trim();

  const set = (key: keyof Fields) => (value: string) =>
    setFields((prev) => ({ ...prev, [key]: value }));

  const accent = TYPE_TINT[type] ?? TYPE_TINT.exercise;

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (isNew) {
      const t = fields.id.trim();
      if (!t) errs.id = 'Required';
      else if (!ID_RE.test(t)) errs.id = 'Letters, numbers, - and _';
    }
    if (!fields.name.trim()) errs.name = 'Required';
    if (!fields.description.trim()) errs.description = 'Required';
    const rounds = fields.defaultRounds.trim();
    if (rounds && !Number.isInteger(Number(rounds))) errs.defaultRounds = 'Whole number';
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  async function onSave() {
    if (!validate()) return;

    setSaving(true);
    setError(null);
    setProgress(Object.keys(pending).length === 0 ? null : 'Saving…');

    const text = (key: keyof Fields): string | null => {
      const v = fields[key].trim();
      return v.length === 0 ? null : v;
    };

    try {
      // The patch knows the stored exercise, so blanking a field that had a
      // value sends an explicit null (which clears it) while a field that was
      // empty all along is omitted (which leaves it alone under a merge write).
      const patch = new ExercisePatch(initial)
        .required('name', fields.name)
        .required('description', fields.description)
        .required('type', type)
        .clearable('targetMuscleGroup', text('targetMuscleGroup'))
        .clearable('secondaryMuscleGroup', text('secondaryMuscleGroup'))
        .clearable('equipment', text('equipment'))
        .clearable('repsHold', text('repsHold'))
        .clearable(
          'defaultRounds',
          text('defaultRounds') != null ? Number.parseInt(fields.defaultRounds.trim(), 10) : null,
        );

      // Filenames for anything still pending are deliberately withheld on this
      // first write: the blob does not exist yet, and naming it now makes the
      // server report a media issue for a file that is seconds away from being
      // uploaded. The upload's own confirm step links them instead.
      if (!pending.video) patch.clearable('videoFileName', text('videoFileName'));
      if (!pending.image) patch.clearable('imageFileName', text('imageFileName'));

      let result = await save.mutateAsync({ id, patch, isNew });

      // Now that the document exists, the queued files have somewhere to go.
      // Confirming an upload links the blob to the exercise server-side, so
      // there is no filename to write back afterwards — the outcome of the last
      // upload is the one that reflects the finished exercise.
      for (const [kind, picked] of Object.entries(pending)) {
        setProgress(`Uploading ${kind}…`);
        result = await upload.mutateAsync({
          id,
          kind,
          extension: extensionOf(picked.name),
          file: picked.file,
        });
      }

      if (result.mediaIssues.length > 0) {
        // Saved, but a filename matched no blob — worth saying out loud rather
        // than letting the admin discover a blank card later.
        setSaving(false);
        setProgress(null);
        setError(`Saved, but no Azure file matched: ${result.mediaIssues.join(', ')}`);
        return;
      }

      onOpenChange(false);
    } catch (e) {
      setSaving(false);
      setProgress(null);
      if (e instanceof ApiException) {
        setError(
          e.code === 'exercise_exists'
            ? 'That id is already taken. Close this and edit the existing exercise.'
            : e.message,
        );
      } else {
        setError(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  // ── Media ─────────────────────────────────────────────────────────────────

  /// Mirrors the server's naming: the exercise id plus the file's extension.
  function uploadedName(original: string): string {
    const ext = extensionOf(original).toLowerCase();
    return `${id}.${ext === 'jpeg' ? 'jpg' : ext}`;
  }

  /// An existing exercise uploads immediately; a new one queues the bytes until
  /// `onSave` has created the document.
  function onFilePicked(kind: 'video' | 'image', file: File | undefined) {
    if (!file) return;
    if (isNew) {
      setPending((prev) => {
        if (prev[kind]?.previewUrl) URL.revokeObjectURL(prev[kind].previewUrl);
        return {
          ...prev,
          // Both kinds get an object URL — a <video> renders its first frame
          // from one just as an <img> renders a picture.
          [kind]: { name: file.name, file, previewUrl: URL.createObjectURL(file) },
        };
      });
      setError(null);
    } else {
      void runUpload(kind, file);
    }
  }

  async function runUpload(kind: 'video' | 'image', file: File) {
    setUploadingKind(kind);
    setError(null);
    try {
      await upload.mutateAsync({ id, kind, extension: extensionOf(file.name), file });
      // The server names the blob after the exercise, so reflect the name it
      // actually used rather than the one the file happened to have.
      set(kind === 'video' ? 'videoFileName' : 'imageFileName')(uploadedName(file.name));
    } catch (e) {
      setError(e instanceof ApiException ? e.message : `Upload failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setUploadingKind(null);
    }
  }

  /// One media slot as a large tile whose body IS the preview.
  ///
  /// The old control was a filename text field with an icon button beside it: no
  /// way to see what was attached, and the button was simply dead on a new
  /// exercise with the reason buried in a tooltip.
  function MediaTile({ kind }: { kind: 'video' | 'image' }) {
    const isVideo = kind === 'video';
    const picked = pending[kind];
    const busy = uploadingKind === kind;
    const existing = (isVideo ? fields.videoFileName : fields.imageFileName).trim();
    const enabled = !saving && !busy && id.length > 0;
    const filled = picked != null || existing.length > 0;
    // Both kinds carry a signed URL on the stored exercise, so an edit can show
    // what is actually attached rather than just naming the file.
    const storedUrl = (isVideo ? initial?.media.videoUrl : initial?.media.imageUrl) ?? null;
    const previewUrl = picked ? picked.previewUrl : existing.length > 0 ? storedUrl : null;

    const label = picked?.name ?? (existing || null);
    const sizeLabel = picked ? `${Math.round(picked.file.size / 1024)} KB` : null;

    return (
      <button
        type="button"
        disabled={!enabled}
        onClick={() => (isVideo ? videoInputRef : imageInputRef).current?.click()}
        className={cn(
          'relative h-[148px] w-full overflow-hidden rounded-[10px] border text-left transition-colors',
          picked ? 'border-[1.4px] border-primary/40 bg-primary/[0.03]' : 'border-input bg-muted/40',
          enabled ? 'cursor-pointer hover:bg-muted' : 'cursor-not-allowed opacity-70',
        )}
      >
        {busy ? (
          <span className="flex h-full items-center justify-center">
            <Loader2 className="size-5 animate-spin text-primary" />
          </span>
        ) : previewUrl ? (
          // The tile body IS the preview — a filename cannot tell you the wrong
          // file was picked.
          isVideo ? (
            // No `controls`: this sits inside a <button>, and nesting a control
            // there both breaks the markup and steals the click-to-replace.
            // `#t=0.1` seeks off frame zero, which is what makes browsers paint
            // a real frame instead of a black rectangle.
            <video
              key={previewUrl}
              src={`${previewUrl}#t=0.1`}
              muted
              playsInline
              preload="metadata"
              className="pointer-events-none size-full object-cover"
            />
          ) : (
            <img src={previewUrl} alt="" className="size-full object-cover" />
          )
        ) : (
          <span className="flex h-full flex-col items-center justify-center gap-2 px-3 pt-5 text-center">
            {label == null ? (
              <CloudUpload className="size-[26px] text-slate-400" />
            ) : isVideo ? (
              <Film className={cn('size-[26px]', picked ? 'text-primary' : 'text-slate-400')} />
            ) : (
              <ImageIcon className={cn('size-[26px]', picked ? 'text-primary' : 'text-slate-400')} />
            )}
            <span
              className={cn(
                'line-clamp-2 text-[11.5px]',
                label == null ? 'font-medium text-muted-foreground' : 'font-semibold text-slate-700 dark:text-slate-300',
              )}
            >
              {label ?? 'Choose a file'}
            </span>
            {sizeLabel && <span className="text-[10.5px] text-muted-foreground">{sizeLabel}</span>}
            {label == null && (
              <span className="text-[10px] text-slate-400">{isVideo ? 'mp4' : 'jpg, png, webp'}</span>
            )}
          </span>
        )}

        <span className="absolute left-2.5 top-2 flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[0.4px] text-muted-foreground">
          {isVideo ? <Film className="size-3.5" /> : <ImageIcon className="size-3.5" />}
          {isVideo ? 'Video' : 'Image'}
        </span>

        {picked && (
          <span className="absolute right-2 top-1.5 rounded bg-primary px-1.5 py-0.5 text-[8.5px] font-extrabold uppercase tracking-[0.5px] text-primary-foreground">
            Queued
          </span>
        )}

        {filled && enabled && (
          <span className="absolute bottom-1.5 right-2 text-[10px] text-muted-foreground">
            Click to replace
          </span>
        )}
      </button>
    );
  }

  const pendingCount = useMemo(() => Object.keys(pending).length, [pending]);

  function Text({
    label,
    field,
    hint,
    disabled,
    rows,
  }: {
    label: string;
    field: keyof Fields;
    hint?: string;
    disabled?: boolean;
    rows?: number;
  }) {
    const err = fieldErrors[field];
    return (
      <div className="flex flex-col gap-1.5 py-1.5">
        <Label className="text-[11.5px] text-muted-foreground">{label}</Label>
        {rows ? (
          <Textarea
            rows={rows}
            value={fields[field]}
            placeholder={hint}
            disabled={disabled ?? saving}
            onChange={(e) => set(field)(e.target.value)}
            className="text-[13.5px]"
          />
        ) : (
          <Input
            value={fields[field]}
            placeholder={hint}
            disabled={disabled ?? saving}
            onChange={(e) => set(field)(e.target.value)}
            className="text-[13.5px]"
          />
        )}
        {err && <p className="text-xs text-destructive">{err}</p>}
      </div>
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !saving && onOpenChange(open)}>
      <DialogContent className="max-h-[720px] max-w-[860px]">
        <DialogHeader className="flex-row items-center gap-3">
          <div className={cn('flex size-9 items-center justify-center rounded-[9px]', accent.bg, accent.text)}>
            {isNew ? <Plus className="size-[18px]" /> : <SquarePen className="size-[18px]" />}
          </div>
          <div className="min-w-0 flex-1">
            <DialogTitle>{isNew ? 'New exercise' : `Edit ${initial.id}`}</DialogTitle>
            <DialogDescription>
              {isNew
                ? 'Added to the catalogue the app overlays at startup'
                : 'Changes reach installed apps on their next cold start'}
            </DialogDescription>
          </div>
        </DialogHeader>

        <DialogBody>
          {/* Two columns: the fields carry most of the weight, and media sits
              beside them at a size where the preview is actually legible,
              instead of being a 46px square under the form. */}
          <div className="flex flex-col gap-5 md:flex-row">
            <div className="min-w-0 flex-1">
              <p className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.7px] text-muted-foreground">
                Identity
              </p>
              <div className="flex gap-2.5">
                <div className="w-[132px] shrink-0">
                  <Text label="ID" field="id" hint="WU01" disabled={!isNew || saving} />
                </div>
                <div className="min-w-0 flex-1">
                  <Text label="Name" field="name" />
                </div>
              </div>

              {/* Type as colour-coded chips rather than a dropdown: four options
                  is fewer than a dropdown is worth, and the colour matches the
                  badge the row gets. */}
              <div className="mt-1.5">
                <Label className="mb-1.5 block text-[11.5px] text-muted-foreground">Type</Label>
                <div className="flex flex-wrap gap-[7px]">
                  {Object.entries(TYPE_LABELS).map(([value, label]) => {
                    const selected = type === value;
                    const tint = TYPE_TINT[value];
                    return (
                      <button
                        key={value}
                        type="button"
                        disabled={saving}
                        onClick={() => setType(value)}
                        className={cn(
                          'rounded-full border px-3.5 py-1.5 text-xs transition-colors',
                          selected
                            ? cn('border-[1.4px] font-bold', tint.border, tint.bg, tint.text)
                            : 'border-input bg-card font-medium text-slate-700 hover:bg-secondary dark:text-slate-300',
                        )}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <Text
                label="Description"
                field="description"
                rows={4}
                hint='Use "Step 1:" markers for steps'
              />

              <p className="mb-2 mt-3 text-[10.5px] font-bold uppercase tracking-[0.7px] text-muted-foreground">
                Details
              </p>
              <Text label="Primary muscles" field="targetMuscleGroup" hint="Comma-separated" />
              <Text label="Secondary muscles" field="secondaryMuscleGroup" />
              <div className="flex gap-2.5">
                <div className="min-w-0 flex-[2]">
                  <Text label="Equipment" field="equipment" />
                </div>
                <div className="min-w-0 flex-1">
                  <Text label="Rounds" field="defaultRounds" />
                </div>
              </div>
              <Text label="Reps / hold" field="repsHold" hint='"15 reps each", "20 seconds"' />
            </div>

            <div className="w-full shrink-0 md:w-[260px]">
              <p className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.7px] text-muted-foreground">
                Media
              </p>
              <MediaTile kind="image" />
              <div className="h-3" />
              <MediaTile kind="video" />

              {id.length === 0 ? (
                <p className="mt-2 text-[11px] text-orange-700 dark:text-orange-400">
                  Enter an ID to attach files
                </p>
              ) : pendingCount > 0 ? (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Uploads when you press {isNew ? 'Create' : 'Save'}
                </p>
              ) : null}
            </div>
          </div>

          <input
            ref={videoInputRef}
            type="file"
            accept=".mp4,video/mp4"
            className="hidden"
            onChange={(e) => {
              onFilePicked('video', e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <input
            ref={imageInputRef}
            type="file"
            accept=".jpg,.jpeg,.png,.webp,image/*"
            className="hidden"
            onChange={(e) => {
              onFilePicked('image', e.target.files?.[0]);
              e.target.value = '';
            }}
          />

          {error && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/40">
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-red-700 dark:text-red-400" />
              <p className="select-text text-[12.5px] leading-relaxed text-red-700 dark:text-red-300">
                {error}
              </p>
            </div>
          )}
        </DialogBody>

        <DialogFooter className="justify-between">
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            {progress && (
              <>
                <Loader2 className="size-3.5 animate-spin text-primary" />
                {progress}
              </>
            )}
          </span>
          <span className="flex items-center gap-1.5">
            <Button variant="ghost" disabled={saving} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button disabled={saving} onClick={() => void onSave()} className="px-6">
              {saving && <Loader2 className="animate-spin" />}
              {isNew ? 'Create exercise' : 'Save changes'}
            </Button>
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
