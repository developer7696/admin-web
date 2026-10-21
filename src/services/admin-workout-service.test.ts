import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  exerciseProgressFrom,
  exerciseTotalVolume,
  muscleGroupFromExerciseName,
  muscleGroupStatsFrom,
  sessionCompletionPercentage,
  sessionFrom,
  withinDays,
  workoutStatsFrom,
  type ExerciseRecord,
  type WorkoutSession,
} from './admin-workout-service';
import type { LogExercise, LogSession, LogSet } from './workout-logs-service';

// The service's import graph reaches `lib/firebase` (the API client signs every
// request with the current ID token, and the permission check reads the same
// claim), and initialising Firebase Auth in a bare Node process throws. Nothing
// under test makes a request, so the module is stubbed to let the graph resolve.
vi.mock('@/lib/firebase', () => ({ app: {}, auth: {}, db: {}, storage: {} }));

/// The reductions the tracker screen displays, tested without a network.
///
/// These numbers used to be computed over Firestore documents and are now
/// computed over the API's sessions. The arithmetic is what must NOT have
/// changed in the move, so it is pinned here rather than eyeballed on the
/// screen: a total that quietly shifts by one is invisible in a passing request.

// Wednesday 18 March 2026, so "this week" (Monday-based) and "this month" have
// known boundaries no matter when the suite runs.
const NOW = new Date(2026, 2, 18, 10, 0, 0);

const at = (year: number, month: number, day: number, hour = 10): Date =>
  new Date(year, month, day, hour, 0, 0);

const set = (over: Partial<LogSet> = {}): LogSet => ({
  setNumber: 1,
  reps: 10,
  weight: 40,
  duration: null,
  caloriesBurned: null,
  distanceKm: null,
  completed: true,
  ...over,
});

const logExercise = (over: Partial<LogExercise> = {}): LogExercise => ({
  exerciseId: 'P01_W01_S1_E102',
  exerciseName: 'Tricep push down',
  exerciseType: 'exercise',
  sets: [set()],
  isAlternative: false,
  originalExerciseId: null,
  ...over,
});

const logSession = (over: Partial<LogSession> = {}): LogSession => ({
  id: 'P01_W01_S1',
  uid: 'u1',
  programId: 'P01',
  weekId: 'W01',
  dayId: 'S1',
  sessionName: 'Week 1 - Day 1',
  completedAt: NOW,
  duration: 3600,
  totalExercises: 1,
  completedExercises: 1,
  totalSets: 1,
  completedSets: 1,
  volume: 400,
  exercises: [logExercise()],
  ...over,
});

const exercise = (over: Partial<ExerciseRecord> = {}): ExerciseRecord => ({
  ...sessionFrom(logSession()).exercises[0],
  ...over,
});

const session = (over: Partial<WorkoutSession> = {}): WorkoutSession => ({
  ...sessionFrom(logSession()),
  ...over,
});

describe('muscle group resolution', () => {
  it('reads the template database first', () => {
    // "Triceps" in the catalogue, standardised to the chart's own vocabulary.
    expect(muscleGroupFromExerciseName('Tricep push down')).toBe('Arms');
    expect(muscleGroupFromExerciseName('Cable lateral raises')).toBe('Shoulders');
  });

  it('falls back to keywords for a name the catalogue does not carry', () => {
    expect(muscleGroupFromExerciseName('Unlisted mystery squat')).toBe('Legs');
    expect(muscleGroupFromExerciseName('Something entirely new')).toBe('Full Body');
  });
});

describe('sessionFrom', () => {
  it('keeps the server-derived fields and adds only the muscle group', () => {
    const mapped = sessionFrom(logSession());

    expect(mapped.id).toBe('P01_W01_S1');
    expect(mapped.programId).toBe('P01');
    expect(mapped.sessionName).toBe('Week 1 - Day 1');
    expect(mapped.completedAt).toEqual(NOW);
    expect(mapped.duration).toBe(3600);
    expect(mapped.totalExercises).toBe(1);
    expect(mapped.completedExercises).toBe(1);
    expect(mapped.exercises[0].muscleGroup).toBe('Arms');
    expect(mapped.exercises[0].sets).toHaveLength(1);
  });

  it('treats a session with no exercise detail as having none', () => {
    expect(sessionFrom(logSession({ exercises: null })).exercises).toEqual([]);
  });
});

describe('pure helpers', () => {
  it('counts volume only for sets carrying both weight and reps', () => {
    expect(
      exerciseTotalVolume(
        exercise({ sets: [set(), set({ weight: null }), set({ reps: null, weight: 60 })] }),
      ),
    ).toBe(400);
  });

  it('reports session completion as a percentage of exercises', () => {
    expect(sessionCompletionPercentage(session({ totalExercises: 4, completedExercises: 3 }))).toBe(75);
    expect(sessionCompletionPercentage(session({ totalExercises: 0, completedExercises: 0 }))).toBe(0);
  });
});

describe('withinDays', () => {
  beforeEach(() => vi.useFakeTimers({ now: NOW }));
  afterEach(() => vi.useRealTimers());

  it('is strictly inside the window, as the Firestore walk was', () => {
    const inside = session({ completedAt: at(2026, 2, 17) });
    const outside = session({ completedAt: at(2026, 1, 1) });
    const onTheEdge = session({ completedAt: new Date(NOW.getTime() - 30 * 86_400_000) });

    expect(withinDays([inside, outside, onTheEdge], 30)).toEqual([inside]);
  });
});

describe('workoutStatsFrom', () => {
  beforeEach(() => vi.useFakeTimers({ now: NOW }));
  afterEach(() => vi.useRealTimers());

  const recent = [
    // Today and yesterday — a two-day streak, both inside this week.
    session({ completedAt: NOW, duration: 3600 }),
    session({ completedAt: at(2026, 2, 17), duration: 1800 }),
    // Earlier this month, before Monday.
    session({ completedAt: at(2026, 2, 1), duration: 0 }),
    // Last month, still inside the 30-day window.
    session({ completedAt: at(2026, 1, 20), duration: 0 }),
  ];

  const stats = () =>
    workoutStatsFrom(recent, { lifetimeWorkouts: 137, lastWorkout: at(2026, 2, 18) });

  it('carries the lifetime counter and last session through untouched', () => {
    expect(stats().totalWorkouts).toBe(137);
    expect(stats().lastWorkout).toEqual(at(2026, 2, 18));
  });

  it('counts the streak back from today only, and estimates the longest', () => {
    expect(stats().currentStreak).toBe(2);
    // Deliberately an estimate: round(current x 1.5), as the Flutter service did.
    expect(stats().longestStreak).toBe(3);
  });

  it('breaks the streak when today has no session', () => {
    expect(
      workoutStatsFrom([session({ completedAt: at(2026, 2, 17) })], {
        lifetimeWorkouts: 1,
        lastWorkout: null,
      }).currentStreak,
    ).toBe(0);
  });

  it('totals duration in hours, sets, and weight x reps volume', () => {
    expect(stats().totalDuration).toBeCloseTo(1.5);
    expect(stats().totalSets).toBe(4);
    expect(stats().totalVolume).toBe(1600);
  });

  it('averages duration in minutes over the sessions in the window', () => {
    expect(stats().avgWorkoutDuration).toBeCloseTo(22.5);
  });

  it('uses the calendar week and calendar month, not rolling windows', () => {
    // Monday-based week: only the 18th and 17th are inside it.
    expect(stats().workoutsThisWeek).toBe(2);
    // March 1st onwards — the February session is a 30-day-window row, not a
    // this-month one.
    expect(stats().workoutsThisMonth).toBe(3);
  });

  it('reports zeroes rather than NaN for a user with no sessions', () => {
    const empty = workoutStatsFrom([], { lifetimeWorkouts: 0, lastWorkout: null });
    expect(empty.avgWorkoutDuration).toBe(0);
    expect(empty.currentStreak).toBe(0);
    expect(empty.totalVolume).toBe(0);
  });
});

describe('muscleGroupStatsFrom', () => {
  it('counts working exercises only', () => {
    const counts = muscleGroupStatsFrom([
      session({
        exercises: [
          exercise({ muscleGroup: 'Chest' }),
          exercise({ muscleGroup: 'Chest' }),
          exercise({ muscleGroup: 'Back' }),
          // Warmups, cardio and cooldowns are movement, not training volume.
          exercise({ muscleGroup: 'Legs', exerciseType: 'warmup' }),
          exercise({ muscleGroup: 'Cardio', exerciseType: 'cardio' }),
          exercise({ muscleGroup: null }),
        ],
      }),
    ]);

    expect(counts).toEqual({ Chest: 2, Back: 1 });
  });
});

describe('exerciseProgressFrom', () => {
  /// PINNED, NOT ENDORSED.
  ///
  /// One completed exercise emits TWO points — its best weight and its volume —
  /// so the "needs two data points" guard never drops a single-session exercise,
  /// and `improvement` for one ends up comparing a weight against a volume. With
  /// `exerciseId` being the per-session composite (`P01_W01_S1_E102`), which
  /// cannot group one exercise across sessions, that is the normal case rather
  /// than the exception.
  ///
  /// Both are pre-existing defects that predate the move off Firestore. They are
  /// asserted here as they are so the migration is provably behaviour-preserving;
  /// fixing them changes every percentage on the screen and wants its own change.
  it('emits two points for a single session, so a trend is claimed from one', () => {
    const oneSet = [
      session({
        exercises: [exercise({ exerciseId: 'A', sets: [set({ weight: 50, reps: 10 })] })],
      }),
    ];

    const [progress] = exerciseProgressFrom(oneSet);
    expect(progress.dataPoints.map((p) => p.metric)).toEqual(['weight', 'volume']);
    expect(progress.improvement).toBeCloseTo(((500 - 50) / 50) * 100);
  });

  it('measures improvement between the first and last point, and the PR', () => {
    const first = session({
      completedAt: at(2026, 2, 1),
      exercises: [exercise({ exerciseId: 'A', sets: [set({ weight: 50, reps: 10 })] })],
    });
    const later = session({
      completedAt: at(2026, 2, 10),
      exercises: [exercise({ exerciseId: 'A', sets: [set({ weight: 60, reps: 10 })] })],
    });

    const [progress] = exerciseProgressFrom([later, first]);

    expect(progress.exerciseId).toBe('A');
    expect(progress.muscleGroup).toBe('Arms');
    // Points are ordered oldest-first regardless of the order sessions arrive
    // in: weight 50, volume 500, weight 60, volume 600.
    expect(progress.dataPoints.map((p) => p.value)).toEqual([50, 500, 60, 600]);
    expect(progress.improvement).toBeCloseTo(((600 - 50) / 50) * 100);
    expect(progress.personalRecord).toBe(600);
    expect(progress.personalRecordDate).toEqual(at(2026, 2, 10));
  });

  it('ignores sets that were never completed', () => {
    const sessions = [
      session({
        completedAt: at(2026, 2, 1),
        exercises: [exercise({ exerciseId: 'A', sets: [set({ completed: false })] })],
      }),
      session({
        completedAt: at(2026, 2, 2),
        exercises: [exercise({ exerciseId: 'A', sets: [set({ completed: false })] })],
      }),
    ];
    expect(exerciseProgressFrom(sessions)).toEqual([]);
  });

  it('ranks by improvement and keeps ten at most', () => {
    const sessions = Array.from({ length: 12 }, (_, i) => [
      session({
        completedAt: at(2026, 2, 1),
        exercises: [exercise({ exerciseId: `E${i}`, sets: [set({ weight: 10, reps: 1 })] })],
      }),
      session({
        completedAt: at(2026, 2, 2),
        // Each exercise improves a little more than the one before it.
        exercises: [exercise({ exerciseId: `E${i}`, sets: [set({ weight: 10 + i, reps: 1 })] })],
      }),
    ]).flat();

    const ranked = exerciseProgressFrom(sessions);

    expect(ranked).toHaveLength(10);
    expect(ranked[0].exerciseId).toBe('E11');
    expect(ranked.map((r) => r.improvement)).toEqual(
      [...ranked.map((r) => r.improvement)].sort((a, b) => b - a),
    );
  });
});
