import { createContext, useContext, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/// Lets a page render controls into the top navbar without the Shell having to
/// know which page is mounted. The Shell renders one `<HeaderSlotTarget />`;
/// any page below it can portal into that target with `<HeaderSlot>`.
///
/// State stays with the page — a portal keeps the React tree intact, so the
/// search field in the navbar is still the Payments page's own controlled
/// input, and pages that don't use the slot simply leave the navbar empty.
const HeaderSlotContext = createContext<{
  node: HTMLElement | null;
  setNode: (el: HTMLElement | null) => void;
} | null>(null);

export function HeaderSlotProvider({ children }: { children: ReactNode }) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  return (
    <HeaderSlotContext.Provider value={{ node, setNode }}>{children}</HeaderSlotContext.Provider>
  );
}

/// The region of the navbar pages may fill. Rendered once, by the Shell.
export function HeaderSlotTarget({ className }: { className?: string }) {
  const ctx = useContext(HeaderSlotContext);
  return <div ref={(el) => ctx?.setNode(el)} className={className} />;
}

/// Renders `children` into the navbar. A no-op until the target has mounted,
/// and outside a Shell entirely.
export function HeaderSlot({ children }: { children: ReactNode }) {
  const ctx = useContext(HeaderSlotContext);
  if (!ctx?.node) return null;
  return createPortal(children, ctx.node);
}
