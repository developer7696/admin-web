import { currentUserCan } from '@/auth/admin-auth';
import { getExercise, getUniversalIdFromExerciseName } from '@/data/exercise-database';
import { fetchUserWorkouts, type LogExercise, type LogSession } from './workout-logs-service';

/// Per-user workout history, and the analytics the tracker screen draws from it.
///
/// The browser-side tree walk this used to do is gone. It read
/// `users/{uid}/programs/{p}/weeks/{w}/days/{d}/{bucket}` with the client SDK —
/// one round trip per level, then four more per completed session — and nothing
/// writes those documents any more: the backend moved to Postgres, so every
/// number on this screen was frozen at the migration with no error to say so.
///
/// Sessions now come from `GET /api/admin/workouts/users/{uid}` via
/// `workout-logs-service`, which is the single place that parses the admin
/// workout payload. What stays here is everything the API does NOT return:
///
///  - the MUSCLE GROUP, which only this panel can resolve. History stores the
///    exercise name, and the mapping from name to muscle lives in the static
///    template database bundled with the app.
///  - the four reductions the screen displays. They are the same arithmetic as
///    before, deliberately: an admin comparing this screen against last week
///    must not see a number move because its source moved.

/// The window the stats cards, the muscle chart and the history list describe.
const STATS_DAYS = 30;

/// The window the strength trend needs — an exercise has to appear more than
/// once before there is a trend to draw at all.
const PROGRESS_DAYS = 120;

export type SetRecord = {
  setNumber: number;
  reps: number | null;
  weight: number | null;
  duration: number | null;
  caloriesBurned: number | null;
  distanceKm: number | null;
  completed: boolean;
};

export type ExerciseRecord = {
  exerciseId: string;
  exerciseName: string;
  /// warmup | exercise | cardio | cooldown
  exerciseType: string;
  sets: SetRecord[];
  isAlternative: boolean;
  originalExerciseId: string | null;
  muscleGroup: string | null;
};

export type WorkoutSession = {
  id: string;
  programId: string;
  sessionName: string;
  completedAt: Date;
  /// Seconds.
  duration: number;
  totalExercises: number;
  completedExercises: number;
  exercises: ExerciseRecord[];
};

export type WorkoutStats = {
  totalWorkouts: number;
  currentStreak: number;
  longestStreak: number;
  /// Hours.
  totalDuration: number;
  totalSets: number;
  /// weight × reps.
  totalVolume: number;
  lastWorkout: Date | null;
  /// Minutes.
  avgWorkoutDuration: number;
  workoutsThisWeek: number;
  workoutsThisMonth: number;
};

export type ProgressDataPoint = {
  date: Date;
  value: number;
  /// 'weight' | 'reps' | 'volume' | 'duration'
  metric: string;
};

export type ExerciseProgress = {
  exerciseId: string;
  exerciseName: string;
  muscleGroup: string;
  dataPoints: ProgressDataPoint[];
  personalRecord: number | null;
  personalRecordDate: Date | null;
  /// Percentage change between the first and last data point.
  improvement: number;
};

/// Null-safe volume: only a set with BOTH weight and reps contributes.
const setVolume = (s: SetRecord): number =>
  s.reps != null && s.weight != null ? s.reps * s.weight : 0;

export const exerciseTotalVolume = (e: ExerciseRecord): number =>
  e.sets.reduce((total, s) => total + setVolume(s), 0);

export const sessionCompletionPercentage = (w: WorkoutSession): number =>
  w.totalExercises === 0 ? 0 : (w.completedExercises / w.totalExercises) * 100;

function standardizeMuscleGroupName(target: string): string {
  const n = target.toLowerCase();
  if ((n.includes('triceps') || n.includes('tricep')) && !n.includes('chest')) return 'Arms';
  if (n.includes('chest')) return 'Chest';
  if (n.includes('back') || n.includes('lats')) return 'Back';
  if (n.includes('quads') || n.includes('legs')) return 'Legs';
  if (n.includes('shoulders') || n.includes('delts')) return 'Shoulders';
  if (n.includes('arms') || n.includes('biceps')) return 'Arms';
  if (n.includes('core') || n.includes('abs')) return 'Core';
  if (n.includes('glutes')) return 'Glutes';
  if (n.includes('cardio')) return 'Cardio';
  return 'Full Body';
}

function muscleGroupFromNameFallback(exerciseName: string): string {
  const name = exerciseName.toLowerCase();
  if (name.includes('chest') || name.includes('press')) return 'Chest';
  if (name.includes('row') || name.includes('lat')) return 'Back';
  if (name.includes('squat') || name.includes('leg')) return 'Legs';
  if (name.includes('shoulder')) return 'Shoulders';
  if (name.includes('arm') || name.includes('bicep')) return 'Arms';
  if (name.includes('core') || name.includes('plank')) return 'Core';
  if (name.includes('deadlift') || name.includes('glute')) return 'Glutes';
  return 'Full Body';
}

/// History stores the exercise NAME, so the muscle group is resolved by looking
/// the name up in the static template database first, then falling back to
/// keyword matching on the name itself.
///
/// This stayed client-side after the move: the template database is a bundled
/// asset of the panel and the app, not a table the API reads, so the server has
/// nothing to resolve the name against.
export function muscleGroupFromExerciseName(exerciseName: string): string {
  const universalId = getUniversalIdFromExerciseName(exerciseName);
  if (universalId) {
    const template = getExercise(universalId);
    if (template?.targetMuscleGroup) return standardizeMuscleGroupName(template.targetMuscleGroup);
  }
  return muscleGroupFromNameFallback(exerciseName);
}

const recordFrom = (e: LogExercise): ExerciseRecord => ({
  exerciseId: e.exerciseId,
  exerciseName: e.exerciseName,
  exerciseType: e.exerciseType,
  sets: e.sets,
  isAlternative: e.isAlternative,
  originalExerciseId: e.originalExerciseId,
  muscleGroup: muscleGroupFromExerciseName(e.exerciseName),
});

/// One API session in the shape this screen already renders.
///
/// `sessionName`, `id`, `duration` and the completed/total counts are the
/// server's — it derives them from the same fields the walk used to read, and
/// deriving them a second time here is how two readers of one session come to
/// disagree. Only `muscleGroup` is added.
export const sessionFrom = (s: LogSession): WorkoutSession => ({
  id: s.id,
  programId: s.programId,
  sessionName: s.sessionName,
  completedAt: s.completedAt,
  duration: s.duration,
  totalExercises: s.totalExercises,
  completedExercises: s.completedExercises,
  // `exercises` is null only when the caller asked for the summary feed; every
  // fetch here asks for the detail.
  exercises: (s.exercises ?? []).map(recordFrom),
});

const newestFirst = (a: WorkoutSession, b: WorkoutSession) =>
  b.completedAt.getTime() - a.completedAt.getTime();

/// The sessions of a wider window narrowed to a `days`-wide one.
///
/// Strictly greater than the cutoff, as the Firestore walk was, so a session
/// sitting on the boundary falls on the same side of it as before.
export const withinDays = (sessions: WorkoutSession[], days: number): WorkoutSession[] => {
  const cutoff = Date.now() - days * 86_400_000;
  return sessions.filter((s) => s.completedAt.getTime() > cutoff);
};

/// One user's window of completed training, plus the two figures that come from
/// the user row rather than from the sessions.
type WorkoutHistory = {
  sessions: WorkoutSession[];
  /// The `totalWorkouts` counter on the user row, which predates the session
  /// rollup and counts further back than any window.
  lifetimeWorkouts: number;
  /// The most recent completed session INSIDE the window. Was
  /// `users/{uid}.lastWorkout`, which no admin endpoint exposes per uid — see
  /// the note on `workoutStatsFrom`.
  lastWorkout: Date | null;
};

/// `GET /api/admin/workouts/users/{uid}`, with the exercise detail.
///
/// The permission mirrors the one the route enforces (`users:read`), the same
/// way `admin-user-service` gates the user list: the server answers 403 either
/// way, but failing here says why instead of surfacing a bare 403.
///
/// Errors are no longer swallowed. The Firestore version returned an empty list
/// on failure, which drew an empty tracker for a user who had trained — the
/// query owner shows an error state with a retry instead.
async function fetchHistory(userId: string, days: number): Promise<WorkoutHistory> {
  if (!currentUserCan('users:read')) throw new Error('Unauthorized access');

  const { stats, sessions } = await fetchUserWorkouts(userId, { days, full: true });
  return {
    sessions: sessions.map(sessionFrom).sort(newestFirst),
    lifetimeWorkouts: stats.lifetimeWorkouts,
    lastWorkout: stats.lastWorkout,
  };
}

/// Completed sessions in the last `days`, newest first.
export async function getRecentWorkouts(userId: string, days: number): Promise<WorkoutSession[]> {
  return (await fetchHistory(userId, days)).sessions;
}

/// Consecutive days with a workout, counting back from today, capped at 30 —
/// the history window this reads is 30 days, so a longer streak cannot be
/// evidenced from it anyway.
///
/// Kept rather than taking the server's `currentStreak`: that one counts over
/// whatever window was requested and allows a run that ended yesterday, so it
/// is a different number for the same data.
function calculateCurrentStreak(workouts: WorkoutSession[]): number {
  if (workouts.length === 0) return 0;
  const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const workoutDays = new Set(workouts.map((w) => dayKey(w.completedAt)));

  const now = new Date();
  let streak = 0;
  for (let i = 0; i < 30; i++) {
    const check = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    if (workoutDays.has(dayKey(check))) streak++;
    else break;
  }
  return streak;
}

/// The stats cards, reduced from the 30-day window.
///
/// Every total here is the same arithmetic the browser did over the Firestore
/// documents, over the same window, so the cards do not move. The server's own
/// `stats` block is deliberately not used for them: it defines "this week" and
/// "this month" as rolling 7 and 30 days where this screen means the calendar
/// week and calendar month, and its streaks are computed over the requested
/// window rather than capped at 30 days.
///
/// `totalWorkouts` is the user row's lifetime counter, as before.
/// `lastWorkout` is the one figure that DID change: it was the
/// `users/{uid}.lastWorkout` field, and no admin endpoint returns that field for
/// a single uid, so it is now the newest completed session in the fetched
/// window. A user whose last session predates the window reads as "Never"
/// rather than showing an old date.
export function workoutStatsFrom(
  recentWorkouts: WorkoutSession[],
  lifetime: { lifetimeWorkouts: number; lastWorkout: Date | null },
): WorkoutStats {
  const currentStreak = calculateCurrentStreak(recentWorkouts);
  // An estimate, not a measurement — the 30-day window cannot evidence a
  // longer historical streak. Carried over from the Flutter service so the
  // number does not change under the same data.
  const longestStreak = Math.round(currentStreak * 1.5);

  let totalDuration = 0;
  let totalSets = 0;
  let totalVolume = 0;

  for (const workout of recentWorkouts) {
    totalDuration += workout.duration / 3600;
    for (const exercise of workout.exercises) {
      totalSets += exercise.sets.length;
      totalVolume += exerciseTotalVolume(exercise);
    }
  }

  const avgWorkoutDuration =
    recentWorkouts.length > 0 ? (totalDuration * 60) / recentWorkouts.length : 0;

  const now = new Date();
  // Monday-based week, matching Dart's `weekday` (Mon = 1).
  const isoWeekday = now.getDay() === 0 ? 7 : now.getDay();
  const weekStart = new Date(now.getTime() - (isoWeekday - 1) * 86_400_000);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  return {
    totalWorkouts: lifetime.lifetimeWorkouts,
    currentStreak,
    longestStreak,
    totalDuration,
    totalSets,
    totalVolume,
    lastWorkout: lifetime.lastWorkout,
    avgWorkoutDuration,
    workoutsThisWeek: recentWorkouts.filter((w) => w.completedAt > weekStart).length,
    workoutsThisMonth: recentWorkouts.filter((w) => w.completedAt > monthStart).length,
  };
}

export async function getWorkoutStats(userId: string): Promise<WorkoutStats> {
  const history = await fetchHistory(userId, STATS_DAYS);
  return workoutStatsFrom(history.sessions, history);
}

/// How many working exercises per muscle group. Warmups, cardio and cooldowns
/// are excluded — the chart is about what was trained, not what was moved
/// through.
export function muscleGroupStatsFrom(workouts: WorkoutSession[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const workout of workouts) {
    for (const exercise of workout.exercises) {
      if (exercise.exerciseType === 'exercise' && exercise.muscleGroup) {
        counts[exercise.muscleGroup] = (counts[exercise.muscleGroup] ?? 0) + 1;
      }
    }
  }
  return counts;
}

export async function getMuscleGroupStats(userId: string): Promise<Record<string, number>> {
  return muscleGroupStatsFrom((await fetchHistory(userId, STATS_DAYS)).sessions);
}

/// The ten most-improved exercises over the last 120 days.
///
/// An exercise needs at least two data points to have a trend at all, so
/// single-session entries are dropped rather than reported as 0% improvement.
///
/// Grouping is by `exerciseId`, which is the composite the sessions have always
/// carried (`P01_W01_S1_E102`) — the API rebuilds the same id from the tree
/// position, so the grouping is unchanged by the move. It is also why this
/// screen shows so little: an id that names the week and the day cannot group
/// one exercise ACROSS sessions. That is a pre-existing defect, left alone here
/// rather than fixed silently, because fixing it changes every percentage on
/// the screen.
export function exerciseProgressFrom(workouts: WorkoutSession[]): ExerciseProgress[] {
  const points = new Map<string, ProgressDataPoint[]>();
  const names = new Map<string, string>();
  const muscles = new Map<string, string>();

  for (const workout of workouts) {
    for (const exercise of workout.exercises) {
      if (exercise.exerciseType !== 'exercise') continue;

      const id = exercise.exerciseId;
      names.set(id, exercise.exerciseName);
      muscles.set(id, exercise.muscleGroup ?? 'Unknown');
      if (!points.has(id)) points.set(id, []);

      let maxWeight = 0;
      let maxReps = 0;
      let totalVolume = 0;

      for (const set of exercise.sets) {
        if (!set.completed) continue;
        if (set.weight != null && set.reps != null) {
          maxWeight = Math.max(maxWeight, set.weight);
          maxReps = Math.max(maxReps, set.reps);
          totalVolume += set.weight * set.reps;
        } else if (set.reps != null) {
          maxReps = Math.max(maxReps, set.reps);
          totalVolume += set.reps;
        }
      }

      const list = points.get(id)!;
      if (maxWeight > 0) {
        list.push({ date: workout.completedAt, value: maxWeight, metric: 'weight' });
      }
      if (totalVolume > 0) {
        list.push({ date: workout.completedAt, value: totalVolume, metric: 'volume' });
      }
      if (maxWeight === 0 && maxReps > 0) {
        list.push({ date: workout.completedAt, value: maxReps, metric: 'reps' });
      }
    }
  }

  const progress: ExerciseProgress[] = [];
  for (const [id, dataPoints] of points) {
    if (dataPoints.length < 2) continue;
    dataPoints.sort((a, b) => a.date.getTime() - b.date.getTime());

    const firstValue = dataPoints[0].value;
    const lastValue = dataPoints[dataPoints.length - 1].value;
    const improvement = firstValue > 0 ? ((lastValue - firstValue) / firstValue) * 100 : 0;
    const best = dataPoints.reduce((a, b) => (a.value > b.value ? a : b));

    progress.push({
      exerciseId: id,
      exerciseName: names.get(id) ?? 'Unknown',
      muscleGroup: muscles.get(id) ?? 'Unknown',
      dataPoints,
      personalRecord: best.value,
      personalRecordDate: best.date,
      improvement,
    });
  }

  progress.sort((a, b) => b.improvement - a.improvement);
  return progress.slice(0, 10);
}

export async function getExerciseProgress(userId: string): Promise<ExerciseProgress[]> {
  return exerciseProgressFrom((await fetchHistory(userId, PROGRESS_DAYS)).sessions);
}

export type WorkoutTrackerData = {
  stats: WorkoutStats;
  recentWorkouts: WorkoutSession[];
  exerciseProgress: ExerciseProgress[];
  muscleGroupStats: Record<string, number>;
};

/// Everything the tracker screen shows, from ONE request.
///
/// These four views used to be four independent tree walks, three of them over
/// the same 30 days — a hundred-plus round trips from the browser for one active
/// user. `GET /api/admin/workouts/users/{uid}` returns a whole window in one
/// response, so the widest window the screen needs is fetched once and the
/// 30-day views are taken from it in memory.
export async function getWorkoutTracker(userId: string): Promise<WorkoutTrackerData> {
  const history = await fetchHistory(userId, PROGRESS_DAYS);
  const recentWorkouts = withinDays(history.sessions, STATS_DAYS);

  return {
    stats: workoutStatsFrom(recentWorkouts, history),
    recentWorkouts,
    exerciseProgress: exerciseProgressFrom(history.sessions),
    muscleGroupStats: muscleGroupStatsFrom(recentWorkouts),
  };
}
