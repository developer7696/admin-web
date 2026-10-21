import { adminApi } from '@/lib/api-client';

/// The cross-user workout feed, and the API-backed replacement for the
/// browser-side tree walk in `admin-workout-service.ts`.
///
/// That file reads `users/{uid}/programs/{p}/weeks/{w}/days/{d}` straight from
/// Firestore with the client SDK — one round trip per level, then four more per
/// completed session. This talks to `/api/admin/workouts/*`, where the same
/// walk happens beside the data.

export type LogSet = {
  setNumber: number;
  reps: number | null;
  weight: number | null;
  duration: number | null;
  caloriesBurned: number | null;
  distanceKm: number | null;
  completed: boolean;
};

export type LogExercise = {
  exerciseId: string;
  exerciseName: string;
  /// warmup | exercise | cardio | cooldown
  exerciseType: string;
  sets: LogSet[];
  isAlternative: boolean;
  originalExerciseId: string | null;
};

export type LogSession = {
  id: string;
  uid: string;
  programId: string;
  weekId: string;
  dayId: string;
  sessionName: string;
  completedAt: Date;
  /// Seconds.
  duration: number;
  totalExercises: number;
  completedExercises: number;
  totalSets: number;
  completedSets: number;
  volume: number;
  exercises: LogExercise[] | null;
};

export type LogRow = LogSession & {
  user: { uid: string; username: string | null; email: string | null };
};

export type LogsPage = { rows: LogRow[]; nextCursor: string | null };

export type UserWorkoutStats = {
  totalWorkouts: number;
  lifetimeWorkouts: number;
  currentStreak: number;
  longestStreak: number;
  totalSets: number;
  completedSets: number;
  totalVolume: number;
  totalDuration: number;
  avgDuration: number;
  lastWorkout: Date | null;
  workoutsThisWeek: number;
  workoutsThisMonth: number;
};

const num = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

const dateOrNull = (v: unknown): Date | null => {
  if (typeof v !== 'string') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

const parseSet = (raw: Record<string, unknown>, index: number): LogSet => ({
  setNumber: num(raw.setNumber, index + 1),
  reps: typeof raw.reps === 'number' ? raw.reps : null,
  weight: typeof raw.weight === 'number' ? raw.weight : null,
  duration: typeof raw.duration === 'number' ? raw.duration : null,
  caloriesBurned: typeof raw.caloriesBurned === 'number' ? raw.caloriesBurned : null,
  distanceKm: typeof raw.distanceKm === 'number' ? raw.distanceKm : null,
  completed: raw.completed === true,
});

const parseExercise = (raw: Record<string, unknown>): LogExercise => ({
  exerciseId: str(raw.exerciseId),
  exerciseName: str(raw.exerciseName) || 'Unknown exercise',
  exerciseType: str(raw.exerciseType) || 'exercise',
  sets: Array.isArray(raw.sets)
    ? (raw.sets as Record<string, unknown>[]).map((s, i) => parseSet(s, i))
    : [],
  isAlternative: raw.isAlternative === true,
  originalExerciseId: strOrNull(raw.originalExerciseId),
});

/// A session whose `completedAt` will not parse is dropped rather than shown at
/// the epoch — a row dated 1 Jan 1970 in a feed sorted by date is worse than no
/// row, because it sticks to the bottom of every page forever.
function parseSession(raw: Record<string, unknown>): LogSession | null {
  const completedAt = dateOrNull(raw.completedAt);
  if (!completedAt) return null;
  return {
    id: str(raw.id),
    uid: str(raw.uid),
    programId: str(raw.programId),
    weekId: str(raw.weekId),
    dayId: str(raw.dayId),
    sessionName: str(raw.sessionName) || 'Workout session',
    completedAt,
    duration: num(raw.duration),
    totalExercises: num(raw.totalExercises),
    completedExercises: num(raw.completedExercises),
    totalSets: num(raw.totalSets),
    completedSets: num(raw.completedSets),
    volume: num(raw.volume),
    exercises: Array.isArray(raw.exercises)
      ? (raw.exercises as Record<string, unknown>[]).map(parseExercise)
      : null,
  };
}

export async function fetchWorkoutLogs(query: {
  limit?: number;
  cursor?: string | null;
  from?: Date | null;
  to?: Date | null;
  uid?: string | null;
}): Promise<LogsPage> {
  const json = await adminApi.workoutLogs(query);
  const raw = Array.isArray(json.rows) ? (json.rows as Record<string, unknown>[]) : [];

  const rows: LogRow[] = [];
  for (const entry of raw) {
    const session = parseSession(entry);
    if (!session) continue;
    const user = (entry.user ?? {}) as Record<string, unknown>;
    rows.push({
      ...session,
      user: {
        uid: str(user.uid) || session.uid,
        username: strOrNull(user.username),
        email: strOrNull(user.email),
      },
    });
  }

  return { rows, nextCursor: strOrNull(json.nextCursor) };
}

export async function fetchUserWorkouts(
  uid: string,
  options?: { days?: number; full?: boolean },
): Promise<{ stats: UserWorkoutStats; sessions: LogSession[] }> {
  const json = await adminApi.userWorkouts(uid, options);
  const rawStats = (json.stats ?? {}) as Record<string, unknown>;
  const rawSessions = Array.isArray(json.sessions)
    ? (json.sessions as Record<string, unknown>[])
    : [];

  const sessions: LogSession[] = [];
  for (const entry of rawSessions) {
    const session = parseSession(entry);
    if (session) sessions.push(session);
  }

  return {
    sessions,
    stats: {
      totalWorkouts: num(rawStats.totalWorkouts),
      lifetimeWorkouts: num(rawStats.lifetimeWorkouts),
      currentStreak: num(rawStats.currentStreak),
      longestStreak: num(rawStats.longestStreak),
      totalSets: num(rawStats.totalSets),
      completedSets: num(rawStats.completedSets),
      totalVolume: num(rawStats.totalVolume),
      totalDuration: num(rawStats.totalDuration),
      avgDuration: num(rawStats.avgDuration),
      lastWorkout: dateOrNull(rawStats.lastWorkout),
      workoutsThisWeek: num(rawStats.workoutsThisWeek),
      workoutsThisMonth: num(rawStats.workoutsThisMonth),
    },
  };
}

export async function fetchSessionDetail(args: {
  uid: string;
  programId: string;
  weekId: string;
  dayId: string;
}): Promise<LogSession | null> {
  return parseSession(await adminApi.workoutSession(args));
}

/// Percentage of the session's exercises that had at least one completed set.
export const sessionCompletion = (s: LogSession): number =>
  s.totalExercises === 0 ? 0 : (s.completedExercises / s.totalExercises) * 100;
