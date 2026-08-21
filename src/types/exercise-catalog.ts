/// Typed models for the `exercise_catalog` domain.
///
/// The field names here are the contract with the mobile app's
/// `ExerciseTemplateMapper` — additive changes only, never rename.

/// Where one exercise's media actually lives in Azure, as resolved by the
/// backend's `/api/admin/exercise-catalog`.
///
/// `imageUrl`/`videoUrl` are SAS URLs and expire (an hour by default) — treat
/// them as display-only and refetch rather than storing them anywhere.
export type ExerciseMedia = {
  imageUrl: string | null;
  videoUrl: string | null;
  imagePath: string | null;
  videoPath: string | null;
  /// `video_not_found` / `image_not_found` — a filename with no blob behind it.
  issues: string[];
};

export const mediaHasVideo = (m: ExerciseMedia) => m.videoPath != null;
export const mediaHasImage = (m: ExerciseMedia) => m.imagePath != null;
/// Whether any blob at all is linked. False means the exercise names no file,
/// or names one that matched nothing in Azure.
export const mediaIsLinked = (m: ExerciseMedia) => mediaHasVideo(m) || mediaHasImage(m);

function parseMedia(exercise: Record<string, unknown>): ExerciseMedia {
  const media = exercise.media as Record<string, unknown> | undefined;
  const side = (key: string) => media?.[key] as Record<string, unknown> | undefined;
  // `signedUrl` is absent for public blobs, which need no token — fall back to
  // the plain URL rather than showing nothing.
  const url = (key: string): string | null => {
    const m = side(key);
    const value = m?.signedUrl ?? m?.url;
    return typeof value === 'string' ? value : null;
  };
  const path = (key: string): string | null => {
    const value = side(key)?.path;
    return typeof value === 'string' ? value : null;
  };

  return {
    imageUrl: url('image'),
    videoUrl: url('video'),
    imagePath: path('image'),
    videoPath: path('video'),
    issues: ((exercise.mediaIssues as unknown[]) ?? []).map(String),
  };
}

/// Fields the panel can clear. Kept as one list so `Exercise.field` and the
/// patch builder can never drift apart.
export const CLEARABLE_FIELDS = [
  'videoFileName',
  'imageFileName',
  'targetMuscleGroup',
  'secondaryMuscleGroup',
  'equipment',
  'repsHold',
  'defaultRounds',
  'duration',
] as const;

/// One exercise, as the panel reads it.
///
/// Deliberately a READ model. Saves go through `ExercisePatch` instead, because
/// the API distinguishes three states per field (absent / value / explicit
/// null) and a plain object with nullable fields can only express two.
export type Exercise = {
  id: string;
  name: string;
  description: string;
  /// `warmup` | `exercise` | `cardio` | `cooldown`, always lower case.
  type: string;
  videoFileName: string | null;
  imageFileName: string | null;
  targetMuscleGroup: string | null;
  secondaryMuscleGroup: string | null;
  equipment: string | null;
  repsHold: string | null;
  defaultRounds: number | null;
  duration: number | null;
  /// How many alternative exercises are listed. The entries are objects
  /// (`[{id: 'E02'}]`) and nothing in the panel reads them beyond the count, so
  /// only the count is modelled — the list itself survives saves untouched.
  alternativeCount: number;
  media: ExerciseMedia;
  /// Fields stored as an empty string rather than absent.
  ///
  /// `parseExercise` normalises `""` to null everywhere else, which would
  /// otherwise make a blanked legacy field indistinguishable from one that was
  /// never set — and so leave the empty string in the document forever.
  /// Tracking them lets the patch still send the explicit null that clears them.
  blankFields: Set<string>;
  /// Everything the search box matches on, lower-cased. Built once per exercise
  /// rather than per keystroke: the list filters ~157 rows on every character.
  searchHaystack: string;
};

export function parseExercise(json: Record<string, unknown>): Exercise {
  const blanks = new Set<string>();

  const text = (key: string): string | null => {
    const value = json[key];
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      blanks.add(key);
      return null;
    }
    return trimmed;
  };

  const num = (key: string): number | null => {
    const value = json[key];
    return typeof value === 'number' ? Math.trunc(value) : null;
  };

  // Loud rather than silent: without this, a payload missing its id builds a
  // row whose id is the string "null", and editing it would PUT to
  // /exercise-catalog/null.
  const rawId = json.id == null ? '' : String(json.id).trim();
  if (rawId.length === 0) throw new Error('Exercise payload is missing its id.');

  const targetMuscleGroup = text('targetMuscleGroup');
  const secondaryMuscleGroup = text('secondaryMuscleGroup');
  const equipment = text('equipment');
  const name = text('name') ?? '';

  return {
    id: rawId,
    name,
    description: text('description') ?? '',
    type: (text('type') ?? 'exercise').toLowerCase(),
    videoFileName: text('videoFileName'),
    imageFileName: text('imageFileName'),
    targetMuscleGroup,
    secondaryMuscleGroup,
    equipment,
    repsHold: text('repsHold'),
    defaultRounds: num('defaultRounds'),
    duration: num('duration'),
    alternativeCount: ((json.alternatives as unknown[]) ?? []).length,
    media: parseMedia(json),
    blankFields: blanks,
    searchHaystack: [rawId, name, targetMuscleGroup ?? '', secondaryMuscleGroup ?? '', equipment ?? '']
      .join(' ')
      .toLowerCase(),
  };
}

/// The stored value of one clearable field, by its wire name.
export function exerciseField(e: Exercise, key: string): string | number | null {
  switch (key) {
    case 'videoFileName': return e.videoFileName;
    case 'imageFileName': return e.imageFileName;
    case 'targetMuscleGroup': return e.targetMuscleGroup;
    case 'secondaryMuscleGroup': return e.secondaryMuscleGroup;
    case 'equipment': return e.equipment;
    case 'repsHold': return e.repsHold;
    case 'defaultRounds': return e.defaultRounds;
    case 'duration': return e.duration;
    default: return null;
  }
}

/// Whether the document holds anything at all under `key` — a real value, or an
/// empty string left by an older write.
///
/// This is the question the patch actually needs answered: "is there something
/// here to erase?" Either way the answer means the same thing, so blanking the
/// field must send an explicit null.
export const exerciseHasStored = (e: Exercise, key: string) =>
  exerciseField(e, key) != null || e.blankFields.has(key);

/// The body of one exercise save.
///
/// Exists to preserve the API's three-state field rule, which a plain object
/// cannot express:
///
///   absent from the body  -> leave the stored value alone
///   a value               -> write it
///   explicit null         -> DELETE the stored field
///
/// Only the third state lets an admin actually blank a field, and omitting it
/// is why blanking used to appear to succeed and change nothing.
export class ExercisePatch {
  /// Null for a create — there is no stored value to clear.
  private readonly previous: Exercise | null;
  private readonly body: Record<string, unknown> = {};

  constructor(previous?: Exercise | null) {
    this.previous = previous ?? null;
  }

  /// A field the API requires on every save, so it is always sent, trimmed.
  ///
  /// Throws on an empty value rather than posting one. The backend rejects it
  /// anyway (`name`/`description` are `min(1)`), so sending it costs a round
  /// trip to be told something the caller could have known — and a 400 surfaces
  /// to the admin as a server error rather than as the "Required" the form
  /// should have shown.
  required(key: string, value: string): this {
    const trimmed = value.trim();
    if (trimmed.length === 0) throw new Error(`${key} is required and cannot be empty`);
    this.body[key] = trimmed;
    return this;
  }

  /// A clearable field. Sends the value when there is one, an explicit null when
  /// the admin emptied something that had a value, and nothing at all when it
  /// was empty already.
  clearable(key: string, value: string | number | null | undefined): this {
    if (value != null && value !== '') {
      this.body[key] = value;
    } else if (this.previous && exerciseHasStored(this.previous, key)) {
      this.body[key] = null;
    }
    return this;
  }

  toJSON(): Record<string, unknown> {
    return { ...this.body };
  }
}

/// What the server did with a single-exercise save.
export type SaveOutcome = {
  id: string;
  /// `video_not_found` / `image_not_found` — the exercise saved, but that
  /// filename matched no blob in Azure.
  mediaIssues: string[];
  version: number | null;
};

export const parseSaveOutcome = (json: Record<string, unknown>): SaveOutcome => ({
  id: json.id == null ? '' : String(json.id),
  mediaIssues: ((json.mediaIssues as unknown[]) ?? []).map(String),
  version: typeof json.version === 'number' ? Math.trunc(json.version) : null,
});

/// A short-lived permit to write ONE blob, issued by the backend.
export type UploadTicket = {
  uploadUrl: string;
  /// Where the server decided the file goes. Echoed back on confirm — the
  /// client never chooses this.
  path: string;
  fileName: string;
  contentType: string;
};

export const parseUploadTicket = (json: Record<string, unknown>): UploadTicket => ({
  uploadUrl: String(json.uploadUrl ?? ''),
  path: String(json.path ?? ''),
  fileName: String(json.fileName ?? ''),
  contentType: String(json.contentType ?? 'application/octet-stream'),
});

/// One whole-catalogue read: the exercises and the content version they were
/// read at.
///
/// Exercises carry their own media because both come from the same response.
/// Fetching them separately (a Firestore stream for the rows, an API call for
/// the media) let the two drift — after an upload the rows refreshed and the
/// signed URLs did not, so a new video showed nothing until a page reload.
export type CatalogSnapshot = {
  /// Ordered by id — the server sorts by document name.
  exercises: Exercise[];
  /// Exercises whose filename matched no blob. Non-zero means the catalogue and
  /// the storage account have drifted, or `media_assets` was never seeded.
  unresolved: number;
  /// `content_meta/exercise_catalog.version`, the counter installed apps use to
  /// decide whether to refetch. Bumped by every save.
  version: number | null;
  fetchedAt: Date;
  /// Built once. The programs pane looks up an exercise per session chip, which
  /// a linear scan turns into (chips × 157) comparisons on every render.
  byId: Map<string, Exercise>;
};

export function parseCatalogSnapshot(json: Record<string, unknown>): CatalogSnapshot {
  const exercises = ((json.exercises as unknown[]) ?? []).map((e) =>
    parseExercise(e as Record<string, unknown>),
  );
  return {
    exercises,
    unresolved: typeof json.unresolved === 'number' ? Math.trunc(json.unresolved) : 0,
    version: typeof json.version === 'number' ? Math.trunc(json.version) : null,
    fetchedAt: new Date(),
    byId: new Map(exercises.map((e) => [e.id, e])),
  };
}
