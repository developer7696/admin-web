import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Dumbbell,
  Flame,
  History,
  RefreshCw,
  Timer,
  TrendingUp,
} from 'lucide-react';
import { useWorkoutTracker } from '@/hooks/use-workout-tracker';
import {
  exerciseTotalVolume,
  sessionCompletionPercentage,
  type WorkoutSession,
  type WorkoutStats,
} from '@/services/admin-workout-service';
import { fmtDuration, fmtLongDateTime, fmtMonthDay } from '@/lib/format';
import { ExerciseProgressChart, MuscleGroupChart } from '@/components/common/workout-charts';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

/// Per-user workout intelligence: aggregate stats, strength progress, and the
/// full session history. The four Firestore reads it needs are bundled behind
/// one query keyed by uid.

function formatLastWorkout(last: Date | null): string {
  if (!last) return 'Never';
  const days = Math.floor((Date.now() - last.getTime()) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return fmtMonthDay(last);
}

function lastWorkoutSubtitle(last: Date | null): string {
  if (!last) return 'Start your journey';
  const days = Math.floor((Date.now() - last.getTime()) / 86_400_000);
  if (days === 0) return 'Great job!';
  if (days === 1) return 'Keep it up!';
  if (days < 7) return 'Come back soon';
  return 'Missing you!';
}

function StatCard({
  title,
  value,
  subtitle,
  icon,
  tint,
  small = false,
}: {
  title: string;
  value: string;
  subtitle: string;
  icon: React.ReactNode;
  tint: string;
  small?: boolean;
}) {
  return (
    <Card className="p-4">
      <div className={cn('w-fit rounded-lg p-2 [&_svg]:size-5', tint)}>{icon}</div>
      <p className="mt-3 text-xs font-medium text-muted-foreground">{title}</p>
      <p className={cn('tabular mt-1 truncate font-bold', small ? 'text-sm' : 'text-2xl')}>{value}</p>
      <p className={cn('mt-0.5 text-[11px] font-semibold', tint.split(' ').at(-1))}>{subtitle}</p>
    </Card>
  );
}

function WorkoutStatsCards({ stats }: { stats: WorkoutStats }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <StatCard
        title="Current Streak"
        value={String(stats.currentStreak)}
        subtitle={stats.currentStreak === 1 ? 'day' : 'days'}
        icon={<Flame />}
        tint="bg-orange-500/10 text-orange-500"
      />
      <StatCard
        title="Total Hours"
        value={stats.totalDuration.toFixed(1)}
        subtitle="Training time"
        icon={<Timer />}
        tint="bg-blue-500/10 text-blue-500"
      />
      <StatCard
        title="This Month"
        value={String(stats.workoutsThisMonth)}
        subtitle="workouts"
        icon={<CalendarDays />}
        tint="bg-emerald-500/10 text-emerald-500"
      />
      <StatCard
        title="Avg Duration"
        value={String(Math.round(stats.avgWorkoutDuration))}
        subtitle="minutes"
        icon={<Timer />}
        tint="bg-purple-500/10 text-purple-500"
      />
      <StatCard
        title="Last Workout"
        value={formatLastWorkout(stats.lastWorkout)}
        subtitle={lastWorkoutSubtitle(stats.lastWorkout)}
        icon={<History />}
        tint="bg-teal-500/10 text-teal-500"
        small
      />
      <StatCard
        title="Total Sets"
        value={String(stats.totalSets)}
        subtitle="last 30 days"
        icon={<Dumbbell />}
        tint="bg-primary/10 text-primary"
      />
    </div>
  );
}

function completionTint(pct: number): string {
  if (pct >= 80) return 'text-emerald-600 bg-emerald-500/10';
  if (pct >= 50) return 'text-amber-600 bg-amber-500/10';
  return 'text-red-600 bg-red-500/10';
}

function WorkoutCard({ workout }: { workout: WorkoutSession }) {
  const [open, setOpen] = useState(false);
  const pct = sessionCompletionPercentage(workout);
  const totalVolume = workout.exercises.reduce((n, e) => n + exerciseTotalVolume(e), 0);

  return (
    <Card className="mb-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-4 p-4 text-left"
      >
        <span className="flex size-[50px] shrink-0 items-center justify-center rounded-xl bg-primary/20">
          <Dumbbell className="size-6 text-primary" />
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-bold">{workout.sessionName}</span>
          <span className="mt-1 block text-xs text-muted-foreground">
            {fmtLongDateTime(workout.completedAt)}
          </span>
          <span className="mt-1.5 flex flex-wrap items-center gap-4 text-xs">
            <span className="flex items-center gap-1.5 text-primary">
              <Timer className="size-3.5" /> {fmtDuration(workout.duration)}
            </span>
            <span className="flex items-center gap-1.5 text-emerald-600">
              <CheckCircle2 className="size-3.5" /> {workout.completedExercises}/
              {workout.totalExercises}
            </span>
            {totalVolume > 0 && (
              <span className="flex items-center gap-1.5 text-orange-600">
                <Dumbbell className="size-3.5" /> {Math.round(totalVolume)}kg
              </span>
            )}
          </span>
        </span>

        <span
          className={cn(
            'tabular shrink-0 rounded-md px-2 py-1 text-xs font-bold',
            completionTint(pct),
          )}
        >
          {Math.round(pct)}%
        </span>
        {open ? (
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        )}
      </button>

      {open && (
        <div className="px-4 pb-4">
          {workout.exercises.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">No exercises recorded.</p>
          ) : (
            workout.exercises.map((exercise) => (
              <div key={exercise.exerciseId} className="mb-3 rounded-lg border border-border p-3">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                    {exercise.exerciseName}
                  </span>
                  <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">
                    {exercise.exerciseType}
                  </span>
                  {exercise.muscleGroup && (
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {exercise.muscleGroup}
                    </span>
                  )}
                </div>

                {exercise.sets.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {exercise.sets.map((set, i) => (
                      <span
                        key={i}
                        className={cn(
                          'tabular rounded px-2 py-1 text-[11px] font-medium',
                          set.completed
                            ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                            : 'bg-muted text-muted-foreground',
                        )}
                      >
                        {set.setNumber}.{' '}
                        {set.weight != null && set.reps != null
                          ? `${set.weight}kg × ${set.reps}`
                          : set.reps != null
                            ? `${set.reps} reps`
                            : set.duration != null
                              ? `${set.duration}s`
                              : '—'}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </Card>
  );
}

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="mb-4 flex items-center gap-2 [&_svg]:size-5 [&_svg]:text-primary">
      {icon}
      <h2 className="text-xl font-bold">{title}</h2>
    </div>
  );
}

export function UserWorkoutTrackerPage() {
  const { uid = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data, isLoading, error } = useWorkoutTracker(uid);

  const refresh = () => qc.invalidateQueries({ queryKey: ['workout-tracker', uid] });

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border bg-card px-4">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ChevronLeft />
        </Button>
        <div className="min-w-0">
          <p className="truncate text-base font-extrabold">Workout Tracker</p>
          <p className="truncate text-xs font-medium text-muted-foreground">
            Admin View • Member Intelligence
          </p>
        </div>
        <div className="flex-1" />
        <Button variant="ghost" size="icon" onClick={() => void refresh()}>
          <RefreshCw className="text-primary" />
        </Button>
      </header>

      {isLoading && <LoadingState />}
      {error && <ErrorState error={error} onRetry={() => void refresh()} />}

      {data && (
        <Tabs defaultValue="stats" className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 border-b border-border bg-card px-4 pb-3">
            <TabsList>
              <TabsTrigger value="stats">
                <BarChart3 className="size-4" /> Stats
              </TabsTrigger>
              <TabsTrigger value="progress">
                <TrendingUp className="size-4" /> Progress
              </TabsTrigger>
              <TabsTrigger value="history">
                <History className="size-4" /> History
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-4">
            <TabsContent value="stats" className="mt-0">
              <WorkoutStatsCards stats={data.stats} />
              {Object.keys(data.muscleGroupStats).length > 0 && (
                <div className="mt-6">
                  <SectionHeader icon={<Dumbbell />} title="Muscle Groups Trained" />
                  <MuscleGroupChart data={data.muscleGroupStats} />
                </div>
              )}
            </TabsContent>

            <TabsContent value="progress" className="mt-0">
              {data.exerciseProgress.length > 0 ? (
                <>
                  <SectionHeader icon={<TrendingUp />} title="Strength Progress" />
                  <ExerciseProgressChart exercises={data.exerciseProgress} />

                  <h3 className="mb-3 mt-6 text-lg font-bold">Top Improving Exercises</h3>
                  {data.exerciseProgress.slice(0, 5).map((progress) => (
                    <Card key={progress.exerciseId} className="mb-2 flex items-center gap-4 p-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">{progress.exerciseName}</p>
                        <p className="text-xs text-muted-foreground">{progress.muscleGroup}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p
                          className={cn(
                            'tabular text-base font-bold',
                            progress.improvement > 0 ? 'text-emerald-600' : 'text-red-600',
                          )}
                        >
                          {progress.improvement.toFixed(1)}%
                        </p>
                        <p className="tabular text-xs text-muted-foreground">
                          PR: {(progress.personalRecord ?? 0).toFixed(1)}
                        </p>
                      </div>
                    </Card>
                  ))}
                </>
              ) : (
                <>
                  <EmptyState
                    icon={<TrendingUp className="size-16" />}
                    title="No progress data yet"
                    hint="An exercise needs at least two logged sessions before a trend can be drawn."
                  />
                  <Card className="mt-4 border-orange-500/30 bg-orange-500/10 p-3">
                    <p className="text-sm font-bold text-orange-600">Debug Info:</p>
                    <p className="mt-2 text-xs">Recent workouts: {data.recentWorkouts.length}</p>
                    <p className="text-xs">
                      Workout stats: {data.stats.totalWorkouts} total workouts
                    </p>
                    {data.recentWorkouts.length > 0 && (
                      <>
                        <p className="mt-2 text-xs">
                          Sample workout exercises: {data.recentWorkouts[0].exercises.length}
                        </p>
                        {data.recentWorkouts[0].exercises.slice(0, 3).map((e) => (
                          <p key={e.exerciseId} className="text-[11px] text-muted-foreground">
                            - {e.exerciseName} ({e.exerciseType}) - {e.sets.length} sets
                          </p>
                        ))}
                      </>
                    )}
                  </Card>
                </>
              )}
            </TabsContent>

            <TabsContent value="history" className="mt-0">
              {data.recentWorkouts.length === 0 ? (
                <EmptyState icon={<History className="size-16" />} title="No workout history yet" />
              ) : (
                data.recentWorkouts.map((w) => <WorkoutCard key={w.id} workout={w} />)
              )}
            </TabsContent>
          </div>
        </Tabs>
      )}
    </div>
  );
}
