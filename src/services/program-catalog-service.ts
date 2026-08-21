import { adminApi, ApiException } from '@/lib/api-client';
import {
  parseProgram,
  parseProgramSummary,
  programToJson,
  type ProgramDoc,
  type ProgramSummary,
} from '@/types/program-catalog';
import { putToAzure } from './exercise-catalog-repository';

/// Reads and writes `program_catalog` through the backend.
///
/// Unlike the exercise catalogue, this never touches Firestore directly: the
/// server validates that every exercise code a session names actually exists,
/// and that check is the whole reason a program edit is safe. Writing from the
/// browser would skip it and let a typo become a missing exercise mid-workout.
export const programCatalogService = {
  list: async (): Promise<ProgramSummary[]> => {
    const json = await adminApi.listPrograms();
    return ((json.programs as unknown[]) ?? []).map((p) =>
      parseProgramSummary(p as Record<string, unknown>),
    );
  },

  get: async (id: string): Promise<ProgramDoc> => parseProgram(await adminApi.getProgram(id)),

  create: (
    program: ProgramDoc,
    template: { warmups: string[]; exercises: string[]; cooldowns: string[] },
  ) =>
    adminApi.createProgram({
      ...programToJson(program, true),
      sessionTemplate: {
        warmups: template.warmups,
        exercises: template.exercises,
        cooldowns: template.cooldowns,
      },
    }),

  update: (program: ProgramDoc) => adminApi.updateProgram(program.id, programToJson(program)),

  remove: (id: string) => adminApi.deleteProgram(id),

  /// Upload a cover image for `id` and store its Azure path on the program.
  ///
  /// Three steps, and the middle one deliberately does NOT go through our
  /// server: the bytes go browser → Azure directly. The server only issues the
  /// permit and then verifies the blob landed. Returns the stored blob path
  /// (`program_images/{id}.jpg`).
  uploadCover: async (args: { id: string; extension: string; file: Blob }): Promise<string> => {
    const ticket = await adminApi.programCoverUploadUrl(args.id, args.extension);
    const uploadUrl = String(ticket.uploadUrl ?? '');
    const path = String(ticket.path ?? '');
    const contentType = String(ticket.contentType ?? 'application/octet-stream');
    if (!uploadUrl || !path) {
      throw new ApiException(0, 'upload_ticket', 'The server did not return an upload URL.');
    }

    await putToAzure(uploadUrl, contentType, args.file);

    const confirmed = await adminApi.programCoverUploadConfirm(args.id, path);
    return String(confirmed.imageUrl ?? path);
  },

  /// Fallback path for a storage account without a blob CORS rule: the bytes go
  /// through our API instead of browser → Azure.
  uploadCoverViaApi: async (args: {
    id: string;
    extension: string;
    file: Blob;
    contentType: string;
  }): Promise<string> => {
    const res = await adminApi.programCoverUpload({
      id: args.id,
      extension: args.extension,
      bytes: args.file,
      contentType: args.contentType,
    });
    return String(res.imageUrl ?? '');
  },
};
