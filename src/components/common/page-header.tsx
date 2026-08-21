import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/// The panel's page bar: title, a status line, and the page's controls, all on
/// ONE row.
///
/// The status is the flexible element and truncates first. That ordering is the
/// whole point: a control that has wrapped to another line is harder to find
/// than a sentence that has lost its tail, so the sentence gives way and the
/// buttons stay where the eye expects them. Pass the full text as `statusTitle`
/// and nothing is lost — only folded into a tooltip.
///
/// Every pane uses this, so the panel reads as one product rather than eleven
/// screens that each invented their own header.
export function PageBar({
  title,
  status,
  statusTitle,
  children,
  className,
}: {
  title: string;
  /// One short line — a count, a freshness stamp. Not a description.
  status?: ReactNode;
  /// Full text for the tooltip, when `status` is an abbreviation of it.
  statusTitle?: string;
  /// Filters and actions, in reading order. They keep their natural width.
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-2 gap-y-2', className)}>
      <h1 className="shrink-0 text-xl font-bold tracking-tight">{title}</h1>
      {status != null && (
        <p
          className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground"
          title={statusTitle}
        >
          {status}
        </p>
      )}
      {/* With no status there is nothing to absorb the slack, so a spacer pushes
          the controls right rather than letting them float beside the title. */}
      {status == null && <div className="min-w-0 flex-1" />}
      {children}
    </div>
  );
}

/// Older two-line header: title with a descriptive subtitle beneath it. Kept for
/// detail pages, where there is no filter bar competing for the row and the
/// extra breathing room reads better than density.
export function PageHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        <h1 className="text-xl font-bold tracking-tight">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-muted-foreground">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/// Standard page shell: the Flutter pages each set their own padding; doing it
/// once here keeps the panes visually aligned. The default is the compact
/// rhythm every list and dashboard pane uses.
export function PageShell({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-col gap-3 p-4', className)}>{children}</div>;
}
