import { useEffect, useState } from 'react';

/// Subscribes to a CSS media query from JS.
///
/// Needed wherever a breakpoint has to decide what gets *mounted* rather than
/// what is merely visible. Hiding a Radix modal with `xl:hidden` does not work:
/// the content goes `display:none` but the dialog is still open, so its overlay
/// still covers the page and it still takes the focus trap, the scroll lock and
/// `pointer-events:none` on the body with it. The result is a blurred, frozen
/// screen with no dialog on it. Deciding here keeps the modal unmounted.
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    // Re-read on subscribe: the viewport can change between render and effect.
    onChange();
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
