import { useMemo, useState } from 'react';
import { GripVertical, X } from 'lucide-react';
import { useExerciseCatalog } from '@/hooks/use-exercise-catalog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SearchInput } from '@/components/common/search-input';
import { ErrorState, LoadingState } from '@/components/common/states';
import { cn } from '@/lib/utils';

/// Pick exercises for a session, from the live catalogue.
///
/// Deliberately a picker rather than a text field: the API rejects a program
/// that names an exercise which does not exist, so letting an admin type "E4l"
/// only to have the save fail later is worse than never offering it. What you
/// can pick is exactly what the catalogue holds.
export function ExercisePickerDialog({
  title,
  initiallySelected,
  onCancel,
  onConfirm,
}: {
  title: string;
  /// Codes already in the list being edited. Shown ticked; unticking removes.
  initiallySelected: string[];
  onCancel: () => void;
  onConfirm: (codes: string[]) => void;
}) {
  /// Ordered, because a session's exercise order is the order it is performed.
  const [selected, setSelected] = useState<string[]>([...initiallySelected]);
  const [query, setQuery] = useState('');
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const { data, isLoading, error } = useExerciseCatalog();

  const filtered = useMemo(() => {
    const rows = data?.exercises ?? [];
    const q = query.trim().toLowerCase();
    return q ? rows.filter((r) => r.searchHaystack.includes(q)) : rows;
  }, [data, query]);

  function toggle(code: string) {
    setSelected((prev) =>
      // Re-selecting appends rather than restoring the old position: order is
      // meaningful, and the admin is choosing where it goes by picking it now.
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );
  }

  function reorder(from: number, to: number) {
    setSelected((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="h-[640px] max-w-3xl">
        <DialogHeader className="flex-row items-center justify-between">
          <DialogTitle>{title}</DialogTitle>
          <span className="text-[13px] text-muted-foreground">{selected.length} selected</span>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-2.5 p-4">
          {/* The chosen codes, in performance order, reorderable by drag. */}
          {selected.length > 0 && (
            <div className="scrollbar-thin flex shrink-0 gap-1.5 overflow-x-auto pb-1">
              {selected.map((code, i) => (
                <span
                  key={`${code}-${i}`}
                  draggable
                  onDragStart={() => setDragIndex(i)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragIndex != null && dragIndex !== i) reorder(dragIndex, i);
                    setDragIndex(null);
                  }}
                  className="flex shrink-0 cursor-grab items-center gap-1 rounded-full bg-primary/[0.07] py-1 pl-1.5 pr-1 text-xs active:cursor-grabbing"
                >
                  <GripVertical className="size-3 text-muted-foreground" />
                  {i + 1}. {code}
                  <button
                    type="button"
                    onClick={() => setSelected((prev) => prev.filter((_, idx) => idx !== i))}
                    className="rounded-full p-0.5 hover:bg-primary/20"
                    aria-label={`Remove ${code}`}
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search id, name, muscle…"
            className="shrink-0"
          />

          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
            {isLoading && <LoadingState />}
            {error && <ErrorState error={error} />}
            {data && filtered.length === 0 && (
              <p className="py-12 text-center text-[13px] text-muted-foreground">
                Nothing matches &quot;{query}&quot;.
              </p>
            )}
            {filtered.map((row) => {
              const picked = selected.includes(row.id);
              return (
                <label
                  key={row.id}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted/60',
                    picked && 'bg-primary/[0.04]',
                  )}
                >
                  <Checkbox checked={picked} onCheckedChange={() => toggle(row.id)} />
                  <span className="min-w-0">
                    <span className="block truncate text-[13.5px]">
                      {row.id} · {row.name || '—'}
                    </span>
                    <span className="block truncate text-[11.5px] text-muted-foreground">
                      {row.type} · {row.targetMuscleGroup ?? 'no muscles set'}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm(selected)}>Use {selected.length}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
