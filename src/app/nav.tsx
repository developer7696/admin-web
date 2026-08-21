import type { LucideIcon } from 'lucide-react';
import {
  CalendarDays,
  CreditCard,
  Dumbbell,
  FileText,
  Headset,
  LayoutDashboard,
  Link2,
  Tag,
  TrendingUp,
  UtensilsCrossed,
  Users,
} from 'lucide-react';

export type NavEntry = { label: string; icon: LucideIcon; path: string };
export type NavSection = { label: string; entries: NavEntry[] };

/// Grouped nav model, same three sections and same order as the Flutter shell's
/// `_sections`. Routes replace the old integer index so a pane is linkable and
/// survives a reload.
export const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Overview',
    entries: [
      { label: 'Dashboard', icon: LayoutDashboard, path: '/dashboard' },
      { label: 'Vouchers', icon: Tag, path: '/vouchers' },
    ],
  },
  {
    label: 'Growth',
    entries: [
      { label: 'Conversion', icon: TrendingUp, path: '/conversion' },
      { label: 'Users', icon: Users, path: '/users' },
      { label: 'Payments', icon: CreditCard, path: '/payments' },
      { label: 'Apple Links', icon: Link2, path: '/apple-links' },
    ],
  },
  {
    label: 'Support & content',
    entries: [
      { label: 'Complaints', icon: Headset, path: '/complaints' },
      { label: 'Recipes', icon: UtensilsCrossed, path: '/recipes' },
      { label: 'Programs', icon: CalendarDays, path: '/programs' },
      { label: 'Exercise Catalogue', icon: Dumbbell, path: '/exercises' },
      { label: 'Articles', icon: FileText, path: '/articles' },
    ],
  },
];
