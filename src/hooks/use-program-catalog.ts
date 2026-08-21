import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/lib/api-client';
import { programCatalogService } from '@/services/program-catalog-service';
import { blobPath, type ProgramDoc, type ProgramSummary } from '@/types/program-catalog';

export const programListKey = ['program-catalog'] as const;
export const programDetailKey = (id: string) => ['program-catalog', id] as const;
export const programMediaKey = (id: string) => ['program-catalog', id, 'media'] as const;

/// Program summaries — id, name, week and session counts. Not the full plans: a
/// listing with every week expanded would be megabytes.
export function useProgramList() {
  return useQuery<ProgramSummary[]>({
    queryKey: programListKey,
    queryFn: programCatalogService.list,
    staleTime: 60 * 1000,
  });
}

/// One program in full, fetched on selection so the pane can show its weeks.
export function useProgramDetail(id: string | null) {
  return useQuery<ProgramDoc>({
    queryKey: programDetailKey(id ?? ''),
    queryFn: () => programCatalogService.get(id as string),
    enabled: id != null && id.length > 0,
    staleTime: 30 * 1000,
  });
}

/// Signed Azure URLs for a program's own artwork.
///
/// Programs and sessions store bare asset paths ("assets/E61.jpg") left over
/// from when the images were bundled with the app. The blobs themselves DO exist
/// in Azure under `exercise_images/`, so the path is rewritten to its blob
/// location and signed — which is what lets the panel show the real artwork
/// instead of a placeholder. Newly uploaded covers are stored as
/// `program_images/{id}.jpg` and pass through unchanged.
export function useProgramMedia(program: ProgramDoc | undefined) {
  const id = program?.id ?? '';
  return useQuery<Record<string, string>>({
    queryKey: programMediaKey(id),
    enabled: program != null,
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      if (!program) return {};
      const paths = new Set<string>();
      if (program.imageUrl) paths.add(blobPath(program.imageUrl));
      for (const w of program.weeks) {
        for (const s of w.sessions) {
          if (s.imageUrl) paths.add(blobPath(s.imageUrl));
        }
      }
      paths.delete('');
      if (paths.size === 0) return {};
      return adminApi.signMedia([...paths]);
    },
  });
}

export function useSaveProgram() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, ProgramDoc>({
    mutationFn: programCatalogService.update,
    onSettled: (_data, _err, program) => {
      void qc.invalidateQueries({ queryKey: programDetailKey(program.id) });
      void qc.invalidateQueries({ queryKey: programListKey });
    },
  });
}

export function useCreateProgram() {
  const qc = useQueryClient();
  return useMutation<
    unknown,
    Error,
    { program: ProgramDoc; template: { warmups: string[]; exercises: string[]; cooldowns: string[] } }
  >({
    mutationFn: ({ program, template }) => programCatalogService.create(program, template),
    onSettled: () => qc.invalidateQueries({ queryKey: programListKey }),
  });
}

export function useDeleteProgram() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, string>({
    mutationFn: programCatalogService.remove,
    onSettled: () => qc.invalidateQueries({ queryKey: programListKey }),
  });
}

export function useUploadProgramCover() {
  const qc = useQueryClient();
  return useMutation<string, Error, { id: string; extension: string; file: Blob }>({
    mutationFn: programCatalogService.uploadCover,
    onSettled: (_data, _err, vars) => {
      void qc.invalidateQueries({ queryKey: programDetailKey(vars.id) });
      void qc.invalidateQueries({ queryKey: programMediaKey(vars.id) });
    },
  });
}
