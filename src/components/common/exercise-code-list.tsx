import { useState } from 'react';
import { SquarePen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ExercisePickerDialog } from './exercise-picker-dialog';
import {
  prescriptionChip,
  preserveSessionExercises,
  type PrescriptionDoc,
  type SessionExerciseDoc,
} from '@/types/program-catalog';

/// One ordered list of session exercises, edited through the catalogue picker.
///
/// Order is performance order, so the chips are numbered. Clicking a chip
/// (when [allowPrescription] is on) authors sets/reps for that one slot.
export function ExerciseCodeList({
  label,
  entries,
  onChange,
  enabled = true,
  allowPrescription = false,
}: {
  label: string;
  entries: SessionExerciseDoc[];
  onChange: (entries: SessionExerciseDoc[]) => void;
  enabled?: boolean;
  allowPrescription?: boolean;
}) {
  const [picking, setPicking] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const editing = editingIndex != null ? entries[editingIndex] : null;

  return (
    <div className="mb-3">
      <div className="flex items-center gap-2">
        <span className="text-[12.5px] font-bold">{label}</span>
        <span className="text-[11.5px] text-muted-foreground">{entries.length}</span>
        <Button
          variant="link"
          size="sm"
          className="ml-auto h-auto p-0"
          disabled={!enabled}
          onClick={() => setPicking(true)}
        >
          <SquarePen className="size-[15px]" /> Edit
        </Button>
      </div>

      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">None</p>
      ) : (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {entries.map((entry, i) => (
            <button
              key={`${entry.code}-${i}`}
              type="button"
              disabled={!allowPrescription || !enabled}
              onClick={() => allowPrescription && setEditingIndex(i)}
              className="rounded-[5px] bg-primary/[0.06] px-2 py-1 text-[11.5px] font-semibold text-primary disabled:cursor-default"
              title={allowPrescription ? 'Edit sets / reps' : undefined}
            >
              {i + 1}. {prescriptionChip(entry)}
            </button>
          ))}
        </div>
      )}

      {picking && (
        <ExercisePickerDialog
          title={`${label} — pick exercises`}
          initiallySelected={entries.map((e) => e.code)}
          onCancel={() => setPicking(false)}
          onConfirm={(picked) => {
            onChange(preserveSessionExercises(entries, picked));
            setPicking(false);
          }}
        />
      )}

      {editing && editingIndex != null && (
        <PrescriptionDialog
          code={editing.code}
          value={editing.prescription}
          onCancel={() => setEditingIndex(null)}
          onDone={(prescription) => {
            const next = entries.map((e, i) => (i === editingIndex ? { ...e, prescription } : e));
            onChange(next);
            setEditingIndex(null);
          }}
        />
      )}
    </div>
  );
}

function PrescriptionDialog({
  code,
  value,
  onCancel,
  onDone,
}: {
  code: string;
  value: PrescriptionDoc | undefined;
  onCancel: () => void;
  onDone: (prescription: PrescriptionDoc | undefined) => void;
}) {
  const [sets, setSets] = useState(value?.sets != null ? String(value.sets) : '');
  const [reps, setReps] = useState(value?.reps != null ? String(value.reps) : '');
  const [duration, setDuration] = useState(
    value?.durationSeconds != null ? String(value.durationSeconds) : '',
  );
  const [rest, setRest] = useState(value?.restSeconds != null ? String(value.restSeconds) : '');
  const [note, setNote] = useState(value?.note ?? '');
  const [error, setError] = useState<string | null>(null);

  function parsePositive(raw: string): number | undefined {
    const t = raw.trim();
    if (!t) return undefined;
    const n = Number.parseInt(t, 10);
    return Number.isInteger(n) && n > 0 ? n : Number.NaN;
  }

  function save() {
    const nextSets = parsePositive(sets);
    const nextReps = parsePositive(reps);
    const nextDuration = parsePositive(duration);
    const restTrim = rest.trim();
    const nextRest = restTrim
      ? (() => {
          const n = Number.parseInt(restTrim, 10);
          return Number.isInteger(n) && n >= 0 ? n : Number.NaN;
        })()
      : undefined;

    if ([nextSets, nextReps, nextDuration, nextRest].some((n) => Number.isNaN(n))) {
      setError('Sets, reps and duration must be positive whole numbers.');
      return;
    }
    if (nextReps != null && nextDuration != null) {
      setError('Use reps or duration, not both.');
      return;
    }

    const prescription: PrescriptionDoc = {};
    if (nextSets != null) prescription.sets = nextSets;
    if (nextReps != null) prescription.reps = nextReps;
    if (nextDuration != null) prescription.durationSeconds = nextDuration;
    if (nextRest != null) prescription.restSeconds = nextRest;
    const trimmedNote = note.trim();
    if (trimmedNote) prescription.note = trimmedNote;

    onDone(Object.keys(prescription).length === 0 ? undefined : prescription);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{code}</DialogTitle>
          <DialogDescription>Sets, reps, or a duration for this slot. Leave blank to use the program default.</DialogDescription>
        </DialogHeader>
        <DialogBody className="grid grid-cols-2 gap-3">
          <div>
            <Label className="mb-1.5 block text-[11.5px] text-muted-foreground">Sets</Label>
            <Input value={sets} inputMode="numeric" placeholder="3" onChange={(e) => setSets(e.target.value)} />
          </div>
          <div>
            <Label className="mb-1.5 block text-[11.5px] text-muted-foreground">Reps</Label>
            <Input value={reps} inputMode="numeric" placeholder="10" onChange={(e) => setReps(e.target.value)} />
          </div>
          <div>
            <Label className="mb-1.5 block text-[11.5px] text-muted-foreground">Duration (sec)</Label>
            <Input
              value={duration}
              inputMode="numeric"
              placeholder="1200"
              onChange={(e) => setDuration(e.target.value)}
            />
          </div>
          <div>
            <Label className="mb-1.5 block text-[11.5px] text-muted-foreground">Rest (sec)</Label>
            <Input value={rest} inputMode="numeric" placeholder="60" onChange={(e) => setRest(e.target.value)} />
          </div>
          <div className="col-span-2">
            <Label className="mb-1.5 block text-[11.5px] text-muted-foreground">Note</Label>
            <Input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
          </div>
          {error && <p className="col-span-2 text-xs text-destructive">{error}</p>}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onDone(undefined)}>
            Clear
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
