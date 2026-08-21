import { cn } from '@/lib/utils';

/// The Aarambh triquetra, copied verbatim from the Flutter app's
/// `assets/Aarambh_white.png` — the same mark the app shows on its splash,
/// auth header and nav bar, so the admin panel and the product read as one
/// brand.
///
/// The source art is white-on-transparent and slightly taller than it is wide
/// (78×83), so it is sized by height with `object-contain` rather than forced
/// into a square.
export function BrandMark({ className }: { className?: string }) {
  return (
    <img
      src="/aarambh-mark.png"
      alt=""
      aria-hidden="true"
      className={cn('w-auto object-contain', className)}
    />
  );
}
