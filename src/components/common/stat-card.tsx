import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'default',
  className,
  onClick,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: 'default' | 'success' | 'warning' | 'destructive' | 'primary';
  className?: string;
  onClick?: () => void;
}) {
  const toneClass = {
    default: 'text-foreground',
    primary: 'text-primary',
    success: 'text-emerald-600 dark:text-emerald-400',
    warning: 'text-amber-600 dark:text-amber-400',
    destructive: 'text-red-600 dark:text-red-400',
  }[tone];

  return (
    <Card
      onClick={onClick}
      className={cn('p-4', onClick && 'cursor-pointer transition-colors hover:bg-accent/50', className)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className={cn('tabular mt-2 text-2xl font-bold leading-none', toneClass)}>{value}</p>
          {hint && <p className="mt-1.5 truncate text-xs text-muted-foreground">{hint}</p>}
        </div>
        {icon && <div className="shrink-0 rounded-lg bg-primary/10 p-2 text-primary [&_svg]:size-4">{icon}</div>}
      </div>
    </Card>
  );
}
