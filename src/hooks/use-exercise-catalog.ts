import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { exerciseCatalogRepository } from '@/services/exercise-catalog-repository';
import type { CatalogSnapshot, ExercisePatch, SaveOutcome } from '@/types/exercise-catalog';

export const exerciseCatalogKey = ['exercise-catalog'] as const;

/// The catalogue, and the entry point for changing it.
///
/// One query rather than the two it replaced (a Firestore stream for the rows
/// and an API call for their media) — they come from the same endpoint anyway,
/// and keeping them apart meant an upload refreshed one and not the other.
///
/// `GET /api/admin/exercise-catalog` is capped at 30/min and signs ~314 SAS URLs
/// per call, so the window-focus refetch is off and the data is held stale for a
/// while: it is refetched after a mutation, not on a whim.
export function useExerciseCatalog() {
  return useQuery<CatalogSnapshot>({
    queryKey: exerciseCatalogKey,
    queryFn: exerciseCatalogRepository.fetchAll,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

/// Re-read the catalogue.
///
/// Cached data is not cleared first, so the current list stays on screen
/// throughout and the page never flashes empty. If the refetch fails, React
/// Query keeps the previous data alongside the error — a save that succeeded
/// followed by a refresh that hit a network blip must not replace the whole
/// catalogue with an error screen, which would read as "your save failed" when
/// it did not.
async function reload(qc: QueryClient): Promise<void> {
  try {
    await qc.refetchQueries({ queryKey: exerciseCatalogKey });
  } catch {
    // Never let a reload failure replace the write's own error.
  }
}

/// Create or update one exercise, then reload.
///
/// The reload happens on failure too, on purpose: a save that returns 409 or
/// times out may still have landed, and leaving a stale list on screen after an
/// ambiguous write is worse than one extra fetch.
///
/// Errors are rethrown to the caller (`mutateAsync`) rather than only parked in
/// the mutation state: a form needs to show "that id is taken" next to its own
/// save button, not in the page behind it.
export function useSaveExercise() {
  const qc = useQueryClient();
  return useMutation<SaveOutcome, Error, { id: string; patch: ExercisePatch; isNew: boolean }>({
    mutationFn: ({ id, patch, isNew }) =>
      isNew
        ? exerciseCatalogRepository.create(id, patch)
        : exerciseCatalogRepository.update(id, patch),
    onSettled: () => reload(qc),
  });
}

/// Upload one file and link it to the exercise, then reload.
///
/// This writes as soon as it succeeds, with no save step to follow — which is
/// why the reload cannot wait for the form to be submitted.
export function useUploadExerciseMedia() {
  const qc = useQueryClient();
  return useMutation<SaveOutcome, Error, { id: string; kind: string; extension: string; file: Blob }>({
    mutationFn: exerciseCatalogRepository.uploadMedia,
    onSettled: () => reload(qc),
  });
}

export function useDeleteExercise() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: exerciseCatalogRepository.remove,
    onSettled: () => reload(qc),
  });
}
