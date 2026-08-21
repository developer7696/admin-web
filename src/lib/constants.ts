// Port of lib/utils/constants.dart.

export const FIREBASE_STORAGE_BUCKET = 'aarambh-20a47.firebasestorage.app';

export const EXERCISE_VIDEOS_PATH = 'exercise_videos';
export const WARMUPS_PATH = `${EXERCISE_VIDEOS_PATH}/warmups`;
export const CORE_EXERCISES_PATH = `${EXERCISE_VIDEOS_PATH}/core_exercises`;
export const COOLDOWNS_PATH = `${EXERCISE_VIDEOS_PATH}/cooldowns`;

export const EXERCISE_TYPES = ['warmup', 'exercise', 'cardio', 'cooldown'] as const;
export type ExerciseTypeKey = (typeof EXERCISE_TYPES)[number];

export function getVideoUrl(type: string, fileName: string): string {
  const folder =
    type === 'warmup' ? WARMUPS_PATH : type === 'cooldown' ? COOLDOWNS_PATH : CORE_EXERCISES_PATH;
  return `gs://${FIREBASE_STORAGE_BUCKET}/${folder}/${fileName}`;
}

/// Subscription plan keys — must stay identical to the backend's `PLAN_KEYS`
/// (`Aarambh-2.0/src/config/plans.ts`), which are also the strings the mobile
/// app writes to `subscriptionPlan`.
export const PLAN_KEYS = [
  'basic_monthly',
  'basic_quarterly',
  'premium_monthly',
  'premium_quarterly',
  'premium_annual',
] as const;

/// Human label for a plan key. "Premium" is branded "Pro" in the app's UI.
export function planKeyLabel(key: string): string {
  switch (key) {
    case 'basic_monthly':
      return 'Basic · Monthly';
    case 'basic_quarterly':
      return 'Basic · Quarterly';
    case 'premium_monthly':
      return 'Pro · Monthly';
    case 'premium_quarterly':
      return 'Pro · Quarterly';
    case 'premium_annual':
      return 'Pro · Annual';
    default:
      return key;
  }
}
