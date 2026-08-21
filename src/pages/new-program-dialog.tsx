import { useState } from 'react';
import { AlertCircle, CalendarDays, Loader2, Lock } from 'lucide-react';
import { ApiException } from '@/lib/api-client';
import { programCatalogService } from '@/services/program-catalog-service';
import type { ProgramDoc } from '@/types/program-catalog';
import { ExerciseCodeList } from '@/components/common/exercise-code-list';
import { ProgramCoverField } from '@/components/common/program-cover-field';
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
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

/// Create a program: identity, length, cover, and the starter session.
///
/// The starter session (warm-up, main, cool-down) is copied into every week so
/// the program is followable immediately. Individual days are customised in the
/// editor afterwards.

const MAX_COVER_BYTES = 8 * 1024 * 1024;
/// Common program lengths — most are one of these, and typing into the field
/// still works for anything else.
const WEEK_PRESETS = [4, 8, 12, 16];
const ID_RE = /^[A-Za-z0-9_-]+$/;
const extensionOf = (fileName: string) => (fileName.includes('.') ? fileName.split('.').pop()! : '');

export function NewProgramDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [weeks, setWeeks] = useState(4);
  const [weeksText, setWeeksText] = useState('4');

  const [warmups, setWarmups] = useState<string[]>([]);
  const [exercises, setExercises] = useState<string[]>([]);
  const [cooldowns, setCooldowns] = useState<string[]>([]);
  const [tagsText, setTagsText] = useState('');
  const [daysPerWeek, setDaysPerWeek] = useState(5);
  const [withTrainer, setWithTrainer] = useState(true);
  const [style, setStyle] = useState<'standard' | 'cycleSync'>('standard');

  /// Cover picked before the program exists. Uploaded after create, same pattern
  /// as a new exercise: the server names the blob from the saved id.
  const [cover, setCover] = useState<{ file: File; previewUrl: string } | null>(null);

  /// True once create has succeeded. A failed cover upload must not try to
  /// create again (that 409s) — only the upload is retried.
  const [created, setCreated] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function validate(): boolean {
    const errs: Record<string, string> = {};
    const t = id.trim();
    if (!t) errs.id = 'Required';
    else if (!ID_RE.test(t)) errs.id = 'Letters, numbers, - and _';
    if (!name.trim()) errs.name = 'Required';
    if (!description.trim()) errs.description = 'Required';
    const n = Number.parseInt(weeksText.trim(), 10);
    if (!Number.isInteger(n)) errs.weeks = '?';
    else if (n < 1 || n > 104) errs.weeks = '1-104';
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function create() {
    if (!validate()) return;
    if (exercises.length === 0) {
      setError('Pick at least one main exercise so the program can be followed.');
      return;
    }

    setSaving(true);
    setError(null);
    const programId = id.trim();

    try {
      if (!created) {
        // Cover is withheld until the upload's confirm step, so we never store a
        // path for a blob that is not there yet. The starter session is copied
        // into every week; the API also receives it as sessionTemplate and
        // stamps it server-side.
        const program: ProgramDoc = {
          id: programId,
          name: name.trim(),
          description: description.trim(),
          totalWeeks: weeks,
          imageUrl: '',
          tags: tagsText
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean)
            .slice(0, 8),
          daysPerWeek,
          withTrainer,
          style,
          defaultSets: 3,
          defaultReps: 10,
          cardioDurationSeconds: 1200,
          restWarmupSeconds: 10,
          restCoreSeconds: 30,
          restBetweenRoundsSeconds: 60,
          weeks: Array.from({ length: weeks }, (_, i) => ({
            weekNumber: i + 1,
            name: `Week ${i + 1}`,
            sessions: [
              {
                dayNumber: 1,
                name: 'Session 1',
                description: '',
                imageUrl: '',
                warmups: warmups.map((code) => ({ code })),
                exercises: exercises.map((code) => ({ code })),
                cooldowns: cooldowns.map((code) => ({ code })),
                supersets: [],
              },
            ],
          })),
        };
        await programCatalogService.create(program, { warmups, exercises, cooldowns });
        setCreated(true);
      }

      if (cover) {
        await programCatalogService.uploadCover({
          id: programId,
          extension: extensionOf(cover.file.name),
          file: cover.file,
        });
      }

      onCreated(programId);
    } catch (e) {
      setSaving(false);
      if (e instanceof ApiException) {
        setError(
          e.code === 'program_exists'
            ? 'That id is already taken. Open the existing program instead.'
            : e.message,
        );
      } else {
        setError(`Could not create the program: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  function pickCover(file: File) {
    if (file.size > MAX_COVER_BYTES) {
      setError('Cover images must be 8 MB or smaller.');
      return;
    }
    setCover((prev) => {
      if (prev) URL.revokeObjectURL(prev.previewUrl);
      return { file, previewUrl: URL.createObjectURL(file) };
    });
    setError(null);
  }

  function setWeekCount(value: number) {
    setWeeks(value);
    setWeeksText(String(value));
  }

  const locked = saving || created;

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="max-h-[780px] max-w-xl">
        <DialogHeader className="flex-row items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-[9px] bg-primary/10 text-primary">
            <CalendarDays className="size-[18px]" />
          </div>
          <div className="min-w-0 flex-1">
            <DialogTitle>New program</DialogTitle>
            <DialogDescription>Starter session is copied into every week</DialogDescription>
          </div>
        </DialogHeader>

        <DialogBody>
          <p className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.7px] text-muted-foreground">
            Identity
          </p>
          <div className="flex gap-2.5">
            <div className="w-[128px] shrink-0">
              <Label className="mb-1.5 block text-[11.5px] text-muted-foreground">ID</Label>
              <Input value={id} placeholder="P04" disabled={locked} onChange={(e) => setId(e.target.value)} />
              {fieldErrors.id && <p className="mt-1 text-xs text-destructive">{fieldErrors.id}</p>}
            </div>
            <div className="min-w-0 flex-1">
              <Label className="mb-1.5 block text-[11.5px] text-muted-foreground">Name</Label>
              <Input
                value={name}
                placeholder="Aarambh: On My Terms"
                disabled={saving}
                onChange={(e) => setName(e.target.value)}
              />
              {fieldErrors.name && <p className="mt-1 text-xs text-destructive">{fieldErrors.name}</p>}
            </div>
          </div>

          <p className="mb-2.5 mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Lock className="size-3" />
            The ID is permanent — user progress is keyed by it.
          </p>

          <div className="mb-2.5">
            <Label className="mb-1.5 block text-[11.5px] text-muted-foreground">Description</Label>
            <Textarea
              rows={3}
              value={description}
              placeholder="What this program is for, and who it suits"
              disabled={saving}
              onChange={(e) => setDescription(e.target.value)}
            />
            {fieldErrors.description && (
              <p className="mt-1 text-xs text-destructive">{fieldErrors.description}</p>
            )}
          </div>

          <ProgramCoverField
            enabled={!saving}
            busy={saving && cover != null}
            queued={cover != null && !saving}
            previewUrl={cover?.previewUrl}
            previewSizeBytes={cover?.file.size}
            fileName={cover?.file.name}
            onPick={pickCover}
          />
          {cover && (
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Uploads to Azure when you press Create
            </p>
          )}

          <p className="mb-2 mt-4 text-[10.5px] font-bold uppercase tracking-[0.7px] text-muted-foreground">
            Length
          </p>
          {/* Preset chips plus a free-text box, rather than a bare number field
              with no indication of what a sensible value is. */}
          <div className="flex items-center gap-[7px]">
            {WEEK_PRESETS.map((preset) => {
              const selected = weeks === preset;
              return (
                <button
                  key={preset}
                  type="button"
                  disabled={saving}
                  onClick={() => setWeekCount(preset)}
                  className={cn(
                    'rounded-full border px-3.5 py-2 text-[12.5px] transition-colors',
                    selected
                      ? 'border-[1.4px] border-primary bg-primary/10 font-bold text-primary'
                      : 'border-input bg-card font-medium text-slate-700 hover:bg-secondary dark:text-slate-300',
                  )}
                >
                  {preset}
                </button>
              );
            })}
            <div className="ml-1 w-[92px]">
              <Input
                type="number"
                value={weeksText}
                disabled={saving}
                onChange={(e) => {
                  setWeeksText(e.target.value);
                  const n = Number.parseInt(e.target.value.trim(), 10);
                  if (Number.isInteger(n) && n > 0 && n <= 104) setWeeks(n);
                }}
              />
            </div>
            {fieldErrors.weeks && <p className="text-xs text-destructive">{fieldErrors.weeks}</p>}
          </div>

          <p className="mb-2 mt-4 text-[10.5px] font-bold uppercase tracking-[0.7px] text-muted-foreground">
            Shown in the app
          </p>
          <div className="mb-2.5">
            <Label className="mb-1.5 block text-[11.5px] text-muted-foreground">
              Tags (comma-separated)
            </Label>
            <Input
              value={tagsText}
              placeholder="at Home"
              disabled={saving}
              onChange={(e) => setTagsText(e.target.value)}
            />
          </div>
          <div className="mb-2.5 flex items-end gap-2.5">
            <div className="w-[92px] shrink-0">
              <Label className="mb-1.5 block text-[11.5px] text-muted-foreground">Days/week</Label>
              <Input
                type="number"
                min={1}
                max={7}
                value={daysPerWeek}
                disabled={saving}
                onChange={(e) => {
                  const n = Number.parseInt(e.target.value.trim(), 10);
                  if (Number.isInteger(n) && n >= 1 && n <= 7) setDaysPerWeek(n);
                }}
              />
            </div>
            <div className="min-w-0 flex-1">
              <Label className="mb-1.5 block text-[11.5px] text-muted-foreground">Style</Label>
              <Select
                value={style}
                onValueChange={(v) => setStyle(v as 'standard' | 'cycleSync')}
                disabled={saving}
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
            <div className="flex h-9 items-center gap-2">
              <Switch checked={withTrainer} onCheckedChange={setWithTrainer} disabled={saving} />
              <span className="text-[12px] text-muted-foreground">with Trainer</span>
            </div>
          </div>

          <p className="mb-2 mt-4 text-[10.5px] font-bold uppercase tracking-[0.7px] text-muted-foreground">
            Starter session
          </p>
          <p className="mb-2 text-xs leading-relaxed text-muted-foreground">
            Copied into each of the {weeks} {weeks === 1 ? 'week' : 'weeks'}. Change individual days
            later in the editor.
          </p>

          <ExerciseCodeList
            label="Warm-up"
            entries={warmups.map((code) => ({ code }))}
            enabled={!locked}
            onChange={(v) => {
              setWarmups(v.map((e) => e.code));
              setError(null);
            }}
          />
          <ExerciseCodeList
            label="Main exercises"
            entries={exercises.map((code) => ({ code }))}
            enabled={!locked}
            onChange={(v) => {
              setExercises(v.map((e) => e.code));
              setError(null);
            }}
          />
          <ExerciseCodeList
            label="Cool-down"
            entries={cooldowns.map((code) => ({ code }))}
            enabled={!locked}
            onChange={(v) => {
              setCooldowns(v.map((e) => e.code));
              setError(null);
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

        <DialogFooter>
          <Button variant="ghost" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={saving} onClick={() => void create()} className="px-6">
            {saving && <Loader2 className="animate-spin" />}
            {created && cover ? 'Retry cover upload' : `Create ${weeks}-week program`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
