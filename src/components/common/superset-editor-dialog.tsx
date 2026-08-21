import { useState } from 'react';
import { SquarePen } from 'lucide-react';
import type { SupersetDoc } from '@/types/program-catalog';
import { Button } from '@/components/ui/button';
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
import { cn } from '@/lib/utils';
import { ExercisePickerDialog } from './exercise-picker-dialog';

/// Edit one superset within a session.
///
/// A superset is a group performed back to back for `rounds` rounds. It drives
/// the app's workout state machine, so two rules are enforced here rather than
/// discovered at runtime:
///
///  - **At least two exercises.** A one-exercise superset is just an exercise,
///    and the API rejects it.
///  - **Its exercises should also appear in the session's own lists.** The app
///    builds the superset from ids composed against this session, so a code that
///    is in no list is a group referring to something the day never performs.
///    Warned about rather than blocked, since the ordering rules live in the app
///    and this panel should not pretend to know them all.
export function SupersetEditorDialog({
  superset,
  sessionCodes,
  onCancel,
  onDone,
}: {
  superset: SupersetDoc;
  /// Every code the session performs, for the "not in this session" warning.
  sessionCodes: string[];
  onCancel: () => void;
  onDone: (next: SupersetDoc) => void;
}) {
  const [groupId, setGroupId] = useState(superset.groupId);
  const [rounds, setRounds] = useState(superset.rounds);
  const [sets, setSets] = useState(superset.setsPerExercise);
  const [exercises, setExercises] = useState<string[]>([...superset.exercises]);
  const [picking, setPicking] = useState(false);

  const tooFew = exercises.length < 2;
  const orphans = exercises.filter((c) => !sessionCodes.includes(c));

  function Note({ tone, children }: { tone: 'red' | 'orange'; children: React.ReactNode }) {
    return (
      <div
        className={cn(
          'mt-3 rounded-lg border p-2.5 text-xs leading-relaxed',
          tone === 'red'
            ? 'border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300'
            : 'border-orange-200 bg-orange-50 text-orange-900 dark:border-orange-900 dark:bg-orange-950/40 dark:text-orange-300',
        )}
      >
        {children}
      </div>
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Superset</DialogTitle>
        </DialogHeader>

        <DialogBody>
          <div className="flex gap-2.5">
            <div className="w-[110px] shrink-0">
              <Label className="mb-1.5 block text-[11.5px] text-muted-foreground">Label</Label>
              <Input value={groupId} onChange={(e) => setGroupId(e.target.value.trim())} />
              <p className="mt-1 text-[10.5px] text-muted-foreground">A, B…</p>
            </div>
            <div className="min-w-0 flex-1">
              <Label className="mb-1.5 block text-[11.5px] text-muted-foreground">Rounds</Label>
              <Input
                type="number"
                value={rounds}
                onChange={(e) => {
                  const n = Number.parseInt(e.target.value, 10);
                  if (Number.isInteger(n) && n > 0) setRounds(n);
                }}
              />
            </div>
            <div className="min-w-0 flex-1">
              <Label className="mb-1.5 block text-[11.5px] text-muted-foreground">
                Sets per exercise
              </Label>
              <Input
                type="number"
                value={sets}
                onChange={(e) => {
                  const n = Number.parseInt(e.target.value, 10);
                  if (Number.isInteger(n) && n > 0) setSets(n);
                }}
              />
            </div>
          </div>

          <div className="mt-5 flex items-center gap-2">
            <span className="text-[12.5px] font-bold">Exercises in this superset</span>
            <Button
              variant="link"
              size="sm"
              className="ml-auto h-auto p-0"
              onClick={() => setPicking(true)}
            >
              <SquarePen className="size-[15px]" /> Edit
            </Button>
          </div>

          {exercises.length === 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">None picked yet.</p>
          ) : (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {exercises.map((code, i) => (
                <span
                  key={`${code}-${i}`}
                  className="rounded-[5px] bg-primary/[0.06] px-2 py-1 text-[11.5px] font-semibold text-primary"
                >
                  {i + 1}. {code}
                </span>
              ))}
            </div>
          )}

          {tooFew && <Note tone="red">A superset needs at least two exercises.</Note>}

          {orphans.length > 0 && (
            <Note tone="orange">
              {orphans.join(', ')} {orphans.length === 1 ? 'is' : 'are'} not in this session&apos;s
              warm-up, main or cool-down lists, so the day never performs them. Add them to a list,
              or remove them here.
            </Note>
          )}
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            disabled={tooFew}
            onClick={() =>
              onDone({
                groupId: groupId || 'A',
                rounds,
                setsPerExercise: sets,
                exercises,
              })
            }
          >
            Done
          </Button>
        </DialogFooter>
      </DialogContent>

      {picking && (
        <ExercisePickerDialog
          title={`Superset ${groupId} — pick exercises`}
          initiallySelected={exercises}
          onCancel={() => setPicking(false)}
          onConfirm={(picked) => {
            setExercises(picked);
            setPicking(false);
          }}
        />
      )}
    </Dialog>
  );
}
