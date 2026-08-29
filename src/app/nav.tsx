import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  CalendarDays,
  CreditCard,
  Dumbbell,
  FileText,
  Headset,
  LayoutDashboard,
  Link2,
  ShieldCheck,
  Tag,
  TrendingUp,
  UtensilsCrossed,
  Users,
} from 'lucide-react';
import type { Permission } from '@/auth/permissions';

export type NavEntry = { label: string; icon: LucideIcon; path: string; permission: Permission };
export type NavSection = { label: string; entries: NavEntry[] };

/// Grouped nav model, same sections and same order as the Flutter shell's
/// `_sections`. Routes replace the old integer index so a pane is linkable and
/// survives a reload.
///
/// `permission` is the READ permission the pane needs to be visible at all —
/// what it lets you *change* once open is gated separately, inside the pane. The
/// same value guards the route, so typing the URL is no different from clicking
/// the entry.
export const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Overview',
    entries: [
      { label: 'Dashboard', icon: LayoutDashboard, path: '/dashboard', permission: 'analytics:read' },
      { label: 'Vouchers', icon: Tag, path: '/vouchers', permission: 'vouchers:read' },
    ],
  },
  {
    label: 'Growth',
    entries: [
      { label: 'Conversion', icon: TrendingUp, path: '/conversion', permission: 'analytics:read' },
      { label: 'Users', icon: Users, path: '/users', permission: 'users:read' },
      { label: 'Workout Logs', icon: Activity, path: '/workout-logs', permission: 'users:read' },
      { label: 'Payments', icon: CreditCard, path: '/payments', permission: 'billing:read' },
      { label: 'Apple Links', icon: Link2, path: '/apple-links', permission: 'billing:read' },
    ],
  },
  {
    label: 'Support & content',
    entries: [
      { label: 'Complaints', icon: Headset, path: '/complaints', permission: 'complaints:read' },
      { label: 'Recipes', icon: UtensilsCrossed, path: '/recipes', permission: 'recipes:read' },
      { label: 'Programs', icon: CalendarDays, path: '/programs', permission: 'programs:read' },
      { label: 'Exercise Catalogue', icon: Dumbbell, path: '/exercises', permission: 'exercises:read' },
      { label: 'Articles', icon: FileText, path: '/articles', permission: 'articles:read' },
    ],
  },
  {
    label: 'Super Admin',
    entries: [
      { label: 'Access & Roles', icon: ShieldCheck, path: '/iam', permission: 'iam:read' },
    ],
  },
];

/// The nav entries this user can see, sections with nothing left dropped.
export function visibleSections(perms: ReadonlySet<Permission>): NavSection[] {
  return NAV_SECTIONS.map((section) => ({
    ...section,
    entries: section.entries.filter((entry) => perms.has(entry.permission)),
  })).filter((section) => section.entries.length > 0);
}

/// Where to send someone who has landed somewhere they cannot see.
///
/// It has to be computed, not `/dashboard`: an exercise editor with no
/// `analytics:read` would otherwise be redirected to a pane they cannot open,
/// which redirects them again — a loop on the screen they were trying to leave.
/// `/no-access` is the honest answer when they hold nothing at all.
export function landingPath(perms: ReadonlySet<Permission>): string {
  for (const section of NAV_SECTIONS) {
    for (const entry of section.entries) {
      if (perms.has(entry.permission)) return entry.path;
    }
  }
  return '/no-access';
}
