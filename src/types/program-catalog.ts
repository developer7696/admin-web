/// Editable model of a `program_catalog` document.
///
/// Mirrors the API's shape exactly, including the one rule that matters: the
/// three exercise lists hold **codes** (`E41`), never the composed ids the app
/// builds (`P01_W03_S2_E41`). Storing composed ids would bake the week and
/// session number into the data, so reordering a week would orphan every
/// reference — including the user-progress documents keyed by them.
///
/// Everything here is mutable: the editor edits in place and sends the whole
/// program back, because the API replaces `weeks` wholesale.

export type SupersetDoc = {
  groupId: string;
  rounds: number;
  setsPerExercise: number;
  exercises: string[];
};

/** Sets / reps / duration for one exercise inside a session. */
export type PrescriptionDoc = {
  sets?: number;
  reps?: number;
  durationSeconds?: number;
  restSeconds?: number;
  note?: string;
};

/** A session list entry: a catalogue code, optionally with a prescription. */
export type SessionExerciseDoc = {
  code: string;
  prescription?: PrescriptionDoc;
};

export type SessionDoc = {
  dayNumber: number;
  name: string;
  description: string;
  imageUrl: string;
  warmups: SessionExerciseDoc[];
  exercises: SessionExerciseDoc[];
  cooldowns: SessionExerciseDoc[];
  supersets: SupersetDoc[];
};

export type WeekDoc = {
  weekNumber: number;
  name: string;
  sessions: SessionDoc[];
};

export type ProgramStyle = 'standard' | 'cycleSync';

export type ProgramDoc = {
  id: string;
  name: string;
  description: string;
  totalWeeks: number;
  imageUrl: string;
  tags: string[];
  daysPerWeek?: number;
  withTrainer?: boolean;
  style?: ProgramStyle;
  defaultSets?: number;
  defaultReps?: number;
  cardioDurationSeconds?: number;
  restWarmupSeconds?: number;
  restCoreSeconds?: number;
  restBetweenRoundsSeconds?: number;
  sectionLabels?: Record<string, string>;
  sectionColors?: Record<string, string>;
  sectionBreaks?: Record<string, Record<string, string>>;
  weeks: WeekDoc[];
};

const codes = (raw: unknown): string[] =>
  ((raw as unknown[]) ?? []).map((c) => (typeof c === 'string' ? c : String((c as { code?: unknown })?.code ?? c)));
const int = (v: unknown, fallback: number) => (typeof v === 'number' ? Math.trunc(v) : fallback);
const optInt = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : undefined;
const str = (v: unknown, fallback = '') => (v == null ? fallback : String(v));

const parseStringMap = (v: unknown): Record<string, string> | undefined => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === 'string' && val.trim()) out[k] = val.trim();
  }
  return Object.keys(out).length ? out : undefined;
};

const parseBreaks = (v: unknown): Record<string, Record<string, string>> | undefined => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out: Record<string, Record<string, string>> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    const inner = parseStringMap(val);
    if (inner) out[k] = inner;
  }
  return Object.keys(out).length ? out : undefined;
};

export const parsePrescription = (raw: unknown): PrescriptionDoc | undefined => {
  if (raw == null || typeof raw !== 'object') return undefined;
  const j = raw as Record<string, unknown>;
  const out: PrescriptionDoc = {};
  if (typeof j.sets === 'number') out.sets = Math.trunc(j.sets);
  if (typeof j.reps === 'number') out.reps = Math.trunc(j.reps);
  if (typeof j.durationSeconds === 'number') out.durationSeconds = Math.trunc(j.durationSeconds);
  if (typeof j.restSeconds === 'number') out.restSeconds = Math.trunc(j.restSeconds);
  if (typeof j.note === 'string' && j.note.trim()) out.note = j.note.trim();
  return Object.keys(out).length === 0 ? undefined : out;
};

export const parseSessionExercise = (raw: unknown): SessionExerciseDoc | null => {
  if (typeof raw === 'string') {
    const code = raw.trim();
    return code ? { code } : null;
  }
  if (raw && typeof raw === 'object' && 'code' in (raw as object)) {
    const j = raw as Record<string, unknown>;
    const code = str(j.code).trim();
    if (!code) return null;
    const prescription = parsePrescription(j.prescription);
    return prescription ? { code, prescription } : { code };
  }
  return null;
};

export const parseSessionExercises = (raw: unknown): SessionExerciseDoc[] =>
  ((raw as unknown[]) ?? [])
    .map(parseSessionExercise)
    .filter((e): e is SessionExerciseDoc => e != null);

export const sessionExerciseCodes = (list: SessionExerciseDoc[]): string[] => list.map((e) => e.code);

export const serializeSessionExercise = (
  e: SessionExerciseDoc,
): string | { code: string; prescription: PrescriptionDoc } =>
  e.prescription ? { code: e.code, prescription: e.prescription } : e.code;

/** Keep prescriptions for codes that remain when the picker reorders the list. */
export const preserveSessionExercises = (
  prev: SessionExerciseDoc[],
  nextCodes: string[],
): SessionExerciseDoc[] => {
  const unused = [...prev];
  return nextCodes.map((code) => {
    const i = unused.findIndex((e) => e.code === code);
    if (i >= 0) {
      const [kept] = unused.splice(i, 1);
      return kept;
    }
    return { code };
  });
};

export const prescriptionChip = (e: SessionExerciseDoc): string => {
  const rx = e.prescription;
  if (!rx) return e.code;
  if (rx.sets && rx.reps) return `${e.code} · ${rx.sets}×${rx.reps}`;
  if (rx.durationSeconds != null) {
    const secs = rx.durationSeconds;
    const label =
      secs >= 60 && secs % 60 === 0 ? `${secs / 60} min` : secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`;
    return `${e.code} · ${label}`;
  }
  if (rx.sets) return `${e.code} · ${rx.sets} sets`;
  return e.code;
};

export const parseSuperset = (j: Record<string, unknown>): SupersetDoc => ({
  groupId: str(j.groupId, 'A'),
  rounds: int(j.rounds, 2),
  setsPerExercise: int(j.setsPerExercise, 1),
  exercises: codes(j.exercises),
});

export const parseSession = (j: Record<string, unknown>): SessionDoc => ({
  dayNumber: int(j.dayNumber, 1),
  name: str(j.name),
  description: str(j.description),
  imageUrl: str(j.imageUrl),
  warmups: parseSessionExercises(j.warmups),
  exercises: parseSessionExercises(j.exercises),
  cooldowns: parseSessionExercises(j.cooldowns),
  supersets: ((j.supersets as unknown[]) ?? []).map((s) => parseSuperset(s as Record<string, unknown>)),
});

export const parseWeek = (j: Record<string, unknown>): WeekDoc => ({
  weekNumber: int(j.weekNumber, 1),
  name: str(j.name),
  sessions: ((j.sessions as unknown[]) ?? []).map((s) => parseSession(s as Record<string, unknown>)),
});

const parseStyle = (v: unknown): ProgramStyle | undefined =>
  v === 'cycleSync' || v === 'standard' ? v : undefined;

export const parseProgram = (j: Record<string, unknown>): ProgramDoc => ({
  id: str(j.id),
  name: str(j.name),
  description: str(j.description),
  totalWeeks: int(j.totalWeeks, 1),
  imageUrl: str(j.imageUrl),
  tags: ((j.tags as unknown[]) ?? []).map((t) => String(t).trim()).filter(Boolean),
  daysPerWeek: optInt(j.daysPerWeek),
  withTrainer: typeof j.withTrainer === 'boolean' ? j.withTrainer : undefined,
  style: parseStyle(j.style),
  defaultSets: optInt(j.defaultSets),
  defaultReps: optInt(j.defaultReps),
  cardioDurationSeconds: optInt(j.cardioDurationSeconds),
  restWarmupSeconds: optInt(j.restWarmupSeconds),
  restCoreSeconds: optInt(j.restCoreSeconds),
  restBetweenRoundsSeconds: optInt(j.restBetweenRoundsSeconds),
  sectionLabels: parseStringMap(j.sectionLabels),
  sectionColors: parseStringMap(j.sectionColors),
  sectionBreaks: parseBreaks(j.sectionBreaks),
  weeks: ((j.weeks as unknown[]) ?? [])
    .map((w) => parseWeek(w as Record<string, unknown>))
    .sort((a, b) => a.weekNumber - b.weekNumber),
});

/// The body the API expects. `id` is omitted on update (it is in the path).
export function programToJson(p: ProgramDoc, includeId = false): Record<string, unknown> {
  return {
    ...(includeId ? { id: p.id } : {}),
    name: p.name,
    description: p.description,
    totalWeeks: p.totalWeeks,
    imageUrl: p.imageUrl,
    tags: p.tags,
    daysPerWeek: p.daysPerWeek ?? 5,
    withTrainer: p.withTrainer ?? true,
    style: p.style ?? 'standard',
    defaultSets: p.defaultSets ?? 3,
    defaultReps: p.defaultReps ?? 10,
    cardioDurationSeconds: p.cardioDurationSeconds ?? 1200,
    restWarmupSeconds: p.restWarmupSeconds ?? 10,
    restCoreSeconds: p.restCoreSeconds ?? 30,
    restBetweenRoundsSeconds: p.restBetweenRoundsSeconds ?? 60,
    ...(p.sectionLabels ? { sectionLabels: p.sectionLabels } : {}),
    ...(p.sectionColors ? { sectionColors: p.sectionColors } : {}),
    ...(p.sectionBreaks ? { sectionBreaks: p.sectionBreaks } : {}),
    weeks: p.weeks.map((w) => ({
      weekNumber: w.weekNumber,
      name: w.name,
      sessions: w.sessions.map((s) => ({
        dayNumber: s.dayNumber,
        name: s.name,
        description: s.description,
        imageUrl: s.imageUrl,
        warmups: s.warmups.map(serializeSessionExercise),
        exercises: s.exercises.map(serializeSessionExercise),
        cooldowns: s.cooldowns.map(serializeSessionExercise),
        supersets: s.supersets.map((g) => ({
          groupId: g.groupId,
          rounds: g.rounds,
          setsPerExercise: g.setsPerExercise,
          exercises: g.exercises,
        })),
      })),
    })),
  };
}

export const sessionTotalExercises = (s: SessionDoc) =>
  s.warmups.length + s.exercises.length + s.cooldowns.length;

export const programSessionCount = (p: ProgramDoc) =>
  p.weeks.reduce((n, w) => n + w.sessions.length, 0);

/// Every exercise code the program references, de-duplicated — used to show the
/// admin what the plan actually depends on.
export function programReferencedCodes(p: ProgramDoc): Set<string> {
  const out = new Set<string>();
  for (const w of p.weeks) {
    for (const s of w.sessions) {
      for (const c of [...s.warmups, ...s.exercises, ...s.cooldowns]) out.add(c.code);
      for (const g of s.supersets) for (const c of g.exercises) out.add(c);
    }
  }
  return out;
}

/// A row in the programs list — counts only, no plans.
export type ProgramSummary = {
  id: string;
  name: string;
  totalWeeks: number;
  weekCount: number;
  sessionCount: number;
};

export const parseProgramSummary = (j: Record<string, unknown>): ProgramSummary => ({
  id: str(j.id),
  name: str(j.name),
  totalWeeks: int(j.totalWeeks, 0),
  weekCount: int(j.weekCount, 0),
  sessionCount: int(j.sessionCount, 0),
});

/// True when the program has fewer weeks than it claims — visible in the list so
/// a half-authored program is obvious before anyone opens it.
export const programIsIncomplete = (p: ProgramSummary) => p.weekCount !== p.totalWeeks;

// ── Image path resolution ───────────────────────────────────────────────────

/// `assets/E61.jpg` → `exercise_images/E61.jpg`.
///
/// Anything already looking like a blob path is left alone, so a document that
/// has been migrated to a real path keeps working.
export function blobPath(raw: string): string {
  const value = raw.trim();
  if (value.length === 0) return '';
  if (value.startsWith('http')) return '';
  if (value.includes('/') && !value.startsWith('assets/')) return value;
  const file = value.split('/').pop() ?? '';
  if (file.length === 0) return '';
  const lower = file.toLowerCase();
  const aliased =
    lower === 'cdo3.jpg' || lower === 'cdo3.jpeg' || lower === 'cdo3.png' ? 'CD03.jpg' : file;
  return `exercise_images/${aliased}`;
}

/// URL the panel can load for a program/session image.
///
/// A Firebase (or any other) https URL is used directly. Legacy asset paths and
/// Azure blob paths go through `blobPath` and the signed `media` map.
export function programImageSrc(
  imageUrl: string,
  media: Record<string, string> | undefined,
): string | null {
  const value = imageUrl.trim();
  if (value.length === 0) return null;
  if (value.startsWith('http://') || value.startsWith('https://')) return value;
  const path = blobPath(value);
  if (path.length === 0) return null;
  return media?.[path] ?? null;
}
