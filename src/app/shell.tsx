import { NavLink, Outlet } from 'react-router-dom';
import { ChevronDown, LogOut } from 'lucide-react';
import { BrandMark } from '@/components/common/brand-mark';
import { signOut } from '@/auth/admin-auth';
import { useAuth } from '@/auth/auth-context';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { HeaderSlotProvider, HeaderSlotTarget } from './header-slot';
import { NAV_SECTIONS } from './nav';

/// Traditional admin-dashboard shell, unchanged in structure from the Flutter
/// panel: a full-width top navbar (brand + per-page controls + profile), with
/// the sidebar and content sitting below it side by side — rather than a
/// sidebar spanning the full window height.
export function Shell() {
  return (
    <HeaderSlotProvider>
      <ShellChrome />
    </HeaderSlotProvider>
  );
}

function ShellChrome() {
  const { user } = useAuth();
  const email = user?.email ?? 'Unknown';
  const initial = email.charAt(0).toUpperCase() || 'A';

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex h-16 shrink-0 items-center gap-4 border-b border-border bg-card px-6">
        <div className="flex size-[34px] shrink-0 items-center justify-center rounded-[10px] bg-gradient-to-br from-primary to-[#5B21D6]">
          <BrandMark className="h-[21px]" />
        </div>
        <span className="shrink-0 truncate text-[15.5px] font-extrabold tracking-tight">
          Aarambh Admin
        </span>

        <HeaderSlotTarget className="flex min-w-0 flex-1 items-center" />

        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-2.5 rounded-full border border-border bg-background p-1.5 pr-2 outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className="flex size-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
              {initial}
            </span>
            <span className="hidden text-[12.5px] font-semibold text-slate-700 dark:text-slate-300 sm:inline">
              {email}
            </span>
            <ChevronDown className="size-4 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem destructive onSelect={() => void signOut()}>
              <LogOut /> Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav className="scrollbar-thin w-[264px] shrink-0 overflow-y-auto border-r border-border bg-sidebar px-3 pb-3 pt-5">
          {NAV_SECTIONS.map((section) => (
            <div key={section.label} className="mb-5">
              <p className="px-3 pb-2 pt-1 text-[10.5px] font-extrabold uppercase tracking-[0.8px] text-slate-400">
                {section.label}
              </p>
              {section.entries.map(({ label, icon: Icon, path }) => (
                <NavLink
                  key={path}
                  to={path}
                  className={({ isActive }) =>
                    cn(
                      'mb-1 flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-[13.5px] transition-colors',
                      isActive
                        ? 'bg-primary/[0.08] font-bold text-primary'
                        : 'font-medium text-slate-700 hover:bg-secondary dark:text-slate-300',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <Icon className={cn('size-[19px]', isActive ? 'text-primary' : 'text-muted-foreground')} />
                      <span className="flex-1 truncate">{label}</span>
                      {isActive && <span className="size-1.5 rounded-full bg-primary" />}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <main className="scrollbar-thin min-w-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
