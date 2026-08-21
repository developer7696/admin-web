import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { refreshAdminClaim } from './admin-auth';

type AuthState = {
  user: User | null;
  isAdmin: boolean;
  loading: boolean;
  error: string | null;
};

const AuthContext = createContext<AuthState>({
  user: null,
  isAdmin: false,
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
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    isAdmin: false,
    loading: true,
    error: null,
  });

  useEffect(() => {
    return onAuthStateChanged(
      auth,
      (user) => {
        void (async () => {
          const isAdmin = await refreshAdminClaim(user);
          setState({ user, isAdmin, loading: false, error: null });
        })();
      },
      (error) => setState({ user: null, isAdmin: false, loading: false, error: error.message }),
    );
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
