import { useRef } from 'react';
import { ImagePlus, Image as ImageIcon, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/// Click-to-upload tile for a program cover. Shows a local preview when a file
/// has just been picked, otherwise a signed network image, otherwise an empty
/// drop zone.
export function ProgramCoverField({
  enabled,
  busy,
  queued = false,
  showLabel = true,
  previewUrl,
  previewSizeBytes,
  networkUrl,
  fileName,
  height = 148,
  onPick,
}: {
  enabled: boolean;
  busy: boolean;
  queued?: boolean;
  showLabel?: boolean;
  previewUrl?: string | null;
  previewSizeBytes?: number | null;
  networkUrl?: string | null;
  fileName?: string | null;
  height?: number;
  onPick: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const filled = previewUrl != null || (networkUrl != null && networkUrl.length > 0);
  const sizeLabel = previewSizeBytes != null ? `${Math.round(previewSizeBytes / 1024)} KB` : null;

  return (
    <div>
      {showLabel && (
        <p className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.7px] text-muted-foreground">
          Cover image
        </p>
      )}
      <button
        type="button"
        disabled={!enabled || busy}
        onClick={() => inputRef.current?.click()}
        style={{ height }}
        className={cn(
          'relative w-full overflow-hidden rounded-[10px] border transition-colors',
          queued ? 'border-[1.4px] border-primary/40 bg-primary/[0.03]' : 'border-input bg-muted/40',
          enabled && !busy ? 'cursor-pointer hover:bg-muted' : 'cursor-not-allowed opacity-70',
        )}
      >
        {busy ? (
          <span className="flex h-full items-center justify-center">
            <Loader2 className="size-5 animate-spin text-primary" />
          </span>
        ) : previewUrl ? (
          <img src={previewUrl} alt="" className="size-full object-cover" />
        ) : networkUrl ? (
          <img src={networkUrl} alt="" className="size-full object-cover" />
        ) : (
          <span className="flex h-full flex-col items-center justify-center gap-2 px-3 text-center">
            {fileName ? (
              <ImageIcon className="size-[26px] text-slate-400" />
            ) : (
              <ImagePlus className="size-[26px] text-slate-400" />
            )}
            <span
              className={cn(
                'line-clamp-2 text-xs',
                fileName ? 'font-semibold text-slate-700 dark:text-slate-300' : 'font-medium text-muted-foreground',
              )}
            >
              {fileName ?? 'Upload a cover image'}
            </span>
            {sizeLabel && <span className="text-[10.5px] text-muted-foreground">{sizeLabel}</span>}
            {!fileName && <span className="text-[10px] text-slate-400">jpg, png or webp</span>}
          </span>
        )}

        {queued && !busy && (
          <span className="absolute right-2 top-2 rounded bg-primary px-1.5 py-0.5 text-[8.5px] font-extrabold uppercase tracking-[0.5px] text-primary-foreground">
            Queued
          </span>
        )}

        {filled && enabled && !busy && (
          <span className="absolute bottom-2 right-2.5 text-[10px] text-muted-foreground">
            Click to replace
          </span>
        )}
      </button>

      <input
        ref={inputRef}
        type="file"
        accept=".jpg,.jpeg,.png,.webp,image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onPick(file);
          e.target.value = '';
        }}
      />
    </div>
  );
}
