import { useQuery } from '@tanstack/react-query';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  getExerciseProgress,
  getMuscleGroupStats,
  getRecentWorkouts,
  getWorkoutStats,
  type ExerciseProgress,
  type WorkoutSession,
  type WorkoutStats,
} from '@/services/admin-workout-service';

export type WorkoutTrackerData = {
  stats: WorkoutStats;
  recentWorkouts: WorkoutSession[];
  exerciseProgress: ExerciseProgress[];
  muscleGroupStats: Record<string, number>;
};

/// Bundles the four parallel reads the workout tracker needs for one user into
/// a single query keyed by uid.
export function useWorkoutTracker(uid: string) {
  return useQuery<WorkoutTrackerData>({
    queryKey: ['workout-tracker', uid],
    enabled: uid.length > 0,
    queryFn: async () => {
      const userDoc = await getDoc(doc(db, 'users', uid));
      const userData = userDoc.data() ?? {};

      const [stats, recentWorkouts, exerciseProgress, muscleGroupStats] = await Promise.all([
        getWorkoutStats(uid, userData),
        getRecentWorkouts(uid, 30),
        getExerciseProgress(uid),
        getMuscleGroupStats(uid),
      ]);

      return { stats, recentWorkouts, exerciseProgress, muscleGroupStats };
    },
  });
}
