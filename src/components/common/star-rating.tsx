import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';

/// Read-only 1–5 stars, as the user saw them in the app's workout-complete
/// dialog. The number is also the accessible label, so a screen reader hears
/// "Rated 4 of 5" rather than five unlabelled icons.
export function StarRating({
  rating,
  className,
  size = 'sm',
}: {
  rating: number;
  className?: string;
  size?: 'sm' | 'md';
}) {
  const icon = size === 'md' ? 'size-4' : 'size-3.5';
  return (
    <span
      role="img"
      aria-label={`Rated ${rating} of 5`}
      title={`Rated ${rating} of 5`}
      className={cn('inline-flex items-center gap-0.5', className)}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          aria-hidden
          className={cn(
            icon,
            n <= rating ? 'fill-amber-400 text-amber-400' : 'fill-transparent text-muted-foreground/40',
          )}
        />
      ))}
    </span>
  );
}
