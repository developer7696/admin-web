import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/// `default` is the bordered field used inside a page, where it sits on the
/// page background and needs an edge to read as a control.
///
/// `header` is for the top navbar, which is itself `bg-card` — a white bordered
/// field there reads as a seam rather than an input. So it inverts: recessed
/// fill, no border at rest, and it *lifts* to the card colour on focus. The
/// pill shape is what makes it legible as search at a glance, with no label
/// beside it.
type SearchVariant = 'default' | 'header';

const INPUT_STYLES: Record<SearchVariant, string> = {
  default: 'pl-9 pr-8',
  header: [
    'rounded-full border-transparent bg-muted pl-10 pr-9 shadow-none',
    'hover:border-input',
    'focus-visible:border-input focus-visible:bg-card focus-visible:ring-ring/35',
  ].join(' '),
};

const ICON_STYLES: Record<SearchVariant, string> = {
  default: 'left-3',
  header: 'left-3.5',
};

const CLEAR_STYLES: Record<SearchVariant, string> = {
  default: 'right-2 rounded',
  header: 'right-2.5 rounded-full',
};

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  className,
  variant = 'default',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  variant?: SearchVariant;
}) {
  return (
    <div className={cn('relative', className)}>
      <Search
        className={cn(
          'pointer-events-none absolute top-1/2 size-4 -translate-y-1/2 text-muted-foreground',
          ICON_STYLES[variant],
        )}
      />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={INPUT_STYLES[variant]}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className={cn(
            'absolute top-1/2 -translate-y-1/2 p-1 text-muted-foreground transition-colors',
            'hover:bg-secondary hover:text-foreground',
            CLEAR_STYLES[variant],
          )}
          aria-label="Clear search"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}
