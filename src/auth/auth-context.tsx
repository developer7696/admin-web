import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { refreshAdminClaim, currentUserPermissions } from './admin-auth';
import type { Permission } from './permissions';

type AuthState = {
  user: User | null;
  isAdmin: boolean;
  perms: ReadonlySet<Permission>;
  loading: boolean;
  error: string | null;
};

const EMPTY_PERMS: ReadonlySet<Permission> = new Set();

const AuthContext = createContext<AuthState>({
  user: null,
  isAdmin: false,
  perms: EMPTY_PERMS,
  loading: true,
  error: null,
});

/// Replaces Riverpod's `authStateProvider`.
///
/// The admin role is resolved from the user's ID token claims *before* the user
/// is published, so the synchronous `isCurrentUserAdmin()` used across the
/// services is always populated by the time anything reads it. This also covers
/// a page reload, where the session restores through this listener without
/// `signInWithEmail`/`signInWithGoogle` ever running.
///
/// The permission grant rides the same path for the same reason: the shell
/// decides which nav entries exist on first paint, so it cannot wait on a second
/// async hop to find out.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    isAdmin: false,
    perms: EMPTY_PERMS,
    loading: true,
    error: null,
  });

  useEffect(() => {
    return onAuthStateChanged(
      auth,
      (user) => {
        void (async () => {
          const isAdmin = await refreshAdminClaim(user);
          setState({
            user,
            isAdmin,
            perms: currentUserPermissions(),
            loading: false,
            error: null,
          });
        })();
      },
      (error) =>
        setState({
          user: null,
          isAdmin: false,
          perms: EMPTY_PERMS,
          loading: false,
          error: error.message,
        }),
    );
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

/// Permission helpers for components.
///
/// `can` is what gates a control; it is a hint for the UI only — the backend
/// re-checks the same grant and answers 403 either way.
export function usePermissions() {
  const { perms } = useAuth();
  return useMemo(
    () => ({
      perms,
      can: (permission: Permission) => perms.has(permission),
      canAny: (...permissions: Permission[]) => permissions.some((p) => perms.has(p)),
      isSuperAdmin: perms.has('iam:write'),
    }),
    [perms],
  );
}

/// Shorthand for the common "does this user hold X" check.
export const useCan = (permission: Permission): boolean => useAuth().perms.has(permission);
