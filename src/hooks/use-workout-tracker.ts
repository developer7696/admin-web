import { useQuery } from '@tanstack/react-query';
import { getWorkoutTracker, type WorkoutTrackerData } from '@/services/admin-workout-service';

export type { WorkoutTrackerData };

/// The tracker screen's data, as one query keyed by uid.
///
/// It was four parallel reads — a `users/{uid}` document fetch plus three walks
/// of the workout tree — and is now a single `GET /api/admin/workouts/users/{uid}`
/// that the service reduces into all four views. The `users` document is no
/// longer read at all: the lifetime workout counter it was fetched for comes
/// back in the same response's `stats`.
///
/// Nothing here was live before and nothing is live now; the screen's Refresh
/// button invalidates this key.
export function useWorkoutTracker(uid: string) {
  return useQuery<WorkoutTrackerData>({
    queryKey: ['workout-tracker', uid],
    enabled: uid.length > 0,
    queryFn: () => getWorkoutTracker(uid),
  });
}
