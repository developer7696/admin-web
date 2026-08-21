import { cn } from '@/lib/utils';

/// A plain `<video>` pointed at a signed Azure URL.
///
/// The Flutter panel wrapped a raw HTML `<video>` in a platform view for the
/// same reason this stays a bare element: the browser's native player already
/// handles the range requests against Blob storage that make seeking work.
export function AzureVideo({
  url,
  className,
  height = 300,
}: {
  url: string;
  className?: string;
  height?: number;
}) {
  return (
    <video
      key={url}
      src={url}
      controls
      preload="metadata"
      style={{ height }}
      className={cn('w-full rounded-lg bg-black object-contain', className)}
    />
  );
}
