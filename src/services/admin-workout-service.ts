import { collection, getDocs, Timestamp, type DocumentData } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { getExercise, getUniversalIdFromExerciseName } from '@/data/exercise-database';

/// Per-user workout history, read out of the nested
/// `users/{uid}/programs/{p}/weeks/{w}/days/{d}/{type}` tree.

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

const numOrNull = (v: unknown): number | null => (typeof v === 'number' ? v : null);

function parseSet(json: DocumentData): SetRecord {
  return {
    setNumber: typeof json.setNumber === 'number' ? json.setNumber : 1,
    reps: numOrNull(json.reps),
    weight: numOrNull(json.weight),
    duration: numOrNull(json.duration),
    caloriesBurned: numOrNull(json.caloriesBurned),
    distanceKm: numOrNull(json.distanceKm),
    completed: json.completed === true,
  };
}

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
function muscleGroupFromExerciseName(exerciseName: string): string {
  const universalId = getUniversalIdFromExerciseName(exerciseName);
  if (universalId) {
    const template = getExercise(universalId);
    if (template?.targetMuscleGroup) return standardizeMuscleGroupName(template.targetMuscleGroup);
  }
  return muscleGroupFromNameFallback(exerciseName);
}

function sessionNameFor(weekId: string, dayId: string): string {
  const week = /W(\d+)/.exec(weekId);
  const day = /S(\d+)/.exec(dayId);
  if (week && day) return `Week ${week[1]} - Day ${day[1]}`;
  return 'Workout Session';
}

const EXERCISE_TYPE_COLLECTIONS = ['warmups', 'core_exercises', 'cardio', 'cooldowns'] as const;

const typeLabel = (collectionName: string): string => {
  if (collectionName === 'core_exercises') return 'exercise';
  if (collectionName === 'cardio') return 'cardio';
  return collectionName.replaceAll('s', '');
};

async function createWorkoutSession(
  userId: string,
  programId: string,
  weekId: string,
  dayId: string,
  dayData: DocumentData,
  completedAt: Date,
): Promise<WorkoutSession | null> {
  try {
    const base = `users/${userId}/programs/${programId}/weeks/${weekId}/days/${dayId}`;
    const snapshots = await Promise.all(
      EXERCISE_TYPE_COLLECTIONS.map((type) => getDocs(collection(db, `${base}/${type}`))),
    );

    const exercises: ExerciseRecord[] = [];
    snapshots.forEach((snapshot, i) => {
      const type = EXERCISE_TYPE_COLLECTIONS[i];
      for (const d of snapshot.docs) {
        const data = d.data();
        const exerciseName = String(data.exerciseName ?? 'Unknown Exercise');
        exercises.push({
          exerciseId: d.id,
          exerciseName,
          exerciseType: typeLabel(type),
          sets: ((data.sets as DocumentData[]) ?? []).map(parseSet),
          isAlternative: data.isAlternative === true,
          originalExerciseId: data.originalExerciseId != null ? String(data.originalExerciseId) : null,
          muscleGroup: muscleGroupFromExerciseName(exerciseName),
        });
      }
    });

    return {
      id: `${programId}_${weekId}_${dayId}`,
      programId,
      sessionName: sessionNameFor(weekId, dayId),
      completedAt,
      duration: typeof dayData.totalDuration === 'number' ? dayData.totalDuration : 0,
      totalExercises: exercises.length,
      completedExercises: exercises.filter((e) => e.sets.some((s) => s.completed)).length,
      exercises,
    };
  } catch {
    return null;
  }
}

/// Completed sessions in the last `days`, newest first.
///
/// The tree is four collections deep, so each level is fetched in parallel
/// rather than sequentially — a serial walk over a year of history is dozens of
/// round trips.
export async function getRecentWorkouts(userId: string, days: number): Promise<WorkoutSession[]> {
  const cutoff = Date.now() - days * 86_400_000;

  try {
    const programsSnapshot = await getDocs(collection(db, `users/${userId}/programs`));
    if (programsSnapshot.empty) return [];

    const weekSnapshots = await Promise.all(
      programsSnapshot.docs.map((p) =>
        getDocs(collection(db, `users/${userId}/programs/${p.id}/weeks`)),
      ),
    );

    const dayRequests: Promise<DocumentData>[] = [];
    const dayMeta: { programId: string; weekId: string }[] = [];

    weekSnapshots.forEach((weeks, i) => {
      const programId = programsSnapshot.docs[i].id;
      for (const weekDoc of weeks.docs) {
        dayRequests.push(
          getDocs(collection(db, `users/${userId}/programs/${programId}/weeks/${weekDoc.id}/days`)),
        );
        dayMeta.push({ programId, weekId: weekDoc.id });
      }
    });

    const daySnapshots = await Promise.all(dayRequests);
    const sessionRequests: Promise<WorkoutSession | null>[] = [];

    daySnapshots.forEach((daysSnapshot, i) => {
      const meta = dayMeta[i];
      for (const dayDoc of (daysSnapshot as { docs: { id: string; data: () => DocumentData }[] }).docs) {
        const data = dayDoc.data();
        if (data.isCompleted !== true || data.completedAt == null) continue;
        const completedAt = (data.completedAt as Timestamp).toDate();
        if (completedAt.getTime() <= cutoff) continue;
        sessionRequests.push(
          createWorkoutSession(userId, meta.programId, meta.weekId, dayDoc.id, data, completedAt),
        );
      }
    });

    const results = await Promise.all(sessionRequests);
    const workouts = results.filter((w): w is WorkoutSession => w != null);
    workouts.sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime());
    return workouts;
  } catch {
    return [];
  }
}

/// Consecutive days with a workout, counting back from today, capped at 30 —
/// the history window this reads is 30 days, so a longer streak cannot be
/// evidenced from it anyway.
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

const EMPTY_STATS: WorkoutStats = {
  totalWorkouts: 0,
  currentStreak: 0,
  longestStreak: 0,
  totalDuration: 0,
  totalSets: 0,
  totalVolume: 0,
  lastWorkout: null,
  avgWorkoutDuration: 0,
  workoutsThisWeek: 0,
  workoutsThisMonth: 0,
};

export async function getWorkoutStats(
  userId: string,
  userData: DocumentData,
): Promise<WorkoutStats> {
  try {
    const totalWorkouts = typeof userData.totalWorkouts === 'number' ? userData.totalWorkouts : 0;
    const lastWorkout =
      userData.lastWorkout != null ? (userData.lastWorkout as Timestamp).toDate() : null;

    const recentWorkouts = await getRecentWorkouts(userId, 30);

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
      totalWorkouts,
      currentStreak,
      longestStreak,
      totalDuration,
      totalSets,
      totalVolume,
      lastWorkout,
      avgWorkoutDuration,
      workoutsThisWeek: recentWorkouts.filter((w) => w.completedAt > weekStart).length,
      workoutsThisMonth: recentWorkouts.filter((w) => w.completedAt > monthStart).length,
    };
  } catch {
    return EMPTY_STATS;
  }
}

export async function getMuscleGroupStats(userId: string): Promise<Record<string, number>> {
  try {
    const workouts = await getRecentWorkouts(userId, 30);
    const counts: Record<string, number> = {};
    for (const workout of workouts) {
      for (const exercise of workout.exercises) {
        if (exercise.exerciseType === 'exercise' && exercise.muscleGroup) {
          counts[exercise.muscleGroup] = (counts[exercise.muscleGroup] ?? 0) + 1;
        }
      }
    }
    return counts;
  } catch {
    return {};
  }
}

/// The ten most-improved exercises over the last 120 days.
///
/// An exercise needs at least two data points to have a trend at all, so
/// single-session entries are dropped rather than reported as 0% improvement.
function processExerciseProgress(workouts: WorkoutSession[]): ExerciseProgress[] {
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
  try {
    return processExerciseProgress(await getRecentWorkouts(userId, 120));
  } catch {
    return [];
  }
}
