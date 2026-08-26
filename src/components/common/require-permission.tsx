import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { useAuth } from '@/auth/auth-context';
import { landingPath } from '@/app/nav';
import { EmptyState } from './states';
import type { Permission } from '@/auth/permissions';

/// Route guard: renders the pane only if the grant carries `permission`.
///
/// Sends the user to a pane they CAN open rather than showing a wall, because
/// the usual way to land here is a stale bookmark or a link from a colleague
/// with wider access, not an attempt to snoop. Anyone holding nothing at all
/// falls through to `/no-access`, which does not redirect.
///
/// This hides a screen; it does not protect the data behind it. The API applies
/// the same permission server-side on every call the pane makes.
export function RequirePermission({
  permission,
  children,
}: {
  permission: Permission;
  children: ReactNode;
}) {
  const { perms } = useAuth();
  if (perms.has(permission)) return <>{children}</>;

  const fallback = landingPath(perms);
  return <Navigate to={fallback} replace />;
}

/// Terminal screen for an account whose grant resolves to nothing — revoked
/// while signed in, or granted permissions this build does not know about.
export function NoAccessPage() {
  return (
    <div className="p-6">
      <EmptyState
        icon={<Lock className="size-8" />}
        title="No sections are available to you"
        hint="Your account can sign in but has not been given access to any part of the panel. Ask a Super Admin to grant you a role."
      />
    </div>
  );
}
