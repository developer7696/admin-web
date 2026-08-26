import {
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as fbSignOut,
  type User,
} from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { permissionsOfClaims, type Permission } from './permissions';

export const ADMIN_ROLE = 'admin';

/// Admin authorization — role based, no email allowlist.
///
/// The source of truth is the **custom claim** on the Firebase Auth ID token:
/// `role: 'admin'` for "may reach the panel at all", and `adm` for the grant
/// that says what they may do there (see `permissions.ts`). Claims are settable
/// only via the Admin SDK, so a user cannot widen their own access.
///
/// A user's role is also mirrored onto `users/{uid}.role` in Firestore. That
/// mirror exists only so the panel can recognise *other* admins when listing
/// users — claims of other accounts are not readable client-side. Never use the
/// mirror to authorize the current user.
///
/// Everything cached here is a UI input, never an authorization decision: every
/// mutating call goes to the backend, which re-checks the same claim.
let currentUserPerms: ReadonlySet<Permission> = new Set();

/// Resolve `user`'s permissions from its ID token and cache them. Pass null on
/// sign-out. Returns whether they may use the panel at all.
///
/// `forceRefresh` re-fetches the token from the server — needed right after
/// sign-in, and after a role change, since a cached token still carries the old
/// claims until it expires.
export async function refreshAdminClaim(user: User | null, forceRefresh = false): Promise<boolean> {
  if (!user) {
    currentUserPerms = new Set();
    return false;
  }
  try {
    const token = await user.getIdTokenResult(forceRefresh);
    currentUserPerms = permissionsOfClaims(token.claims as Record<string, unknown>);
  } catch {
    // Network/token failure must not silently grant access.
    currentUserPerms = new Set();
  }
  return currentUserPerms.size > 0;
}

/// The signed-in user's permissions. Reflects the last `refreshAdminClaim`.
export const currentUserPermissions = (): ReadonlySet<Permission> => currentUserPerms;

/// Whether the signed-in user holds `permission`.
export const currentUserCan = (permission: Permission): boolean =>
  currentUserPerms.has(permission);

/// Whether the signed-in user may use the panel at all — i.e. holds anything.
///
/// Was "has the `role: 'admin'` claim". That claim is now set on every member
/// including read-only ones, so it no longer distinguishes anybody; what matters
/// is whether the grant resolves to something.
export const isCurrentUserAdmin = () => currentUserPerms.size > 0;

/// Whether a Firestore user document belongs to an admin. Use only to
/// recognise/protect other admin rows in lists — never to authorize the
/// current user.
export const isAdminUserData = (data: { role?: unknown } | null | undefined) =>
  data != null && data.role === ADMIN_ROLE;

function authErrorMessage(code: string, fallback: string): string {
  switch (code) {
    case 'auth/user-not-found':
      return 'User not found';
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Incorrect password';
    case 'auth/invalid-email':
      return 'Invalid email address';
    case 'auth/user-disabled':
      return 'User account has been disabled';
    case 'auth/too-many-requests':
      return 'Too many login attempts. Try again later';
    case 'auth/popup-closed-by-user':
      return 'Sign-in was cancelled';
    case 'auth/operation-not-allowed':
      return 'Google sign-in is not enabled for this project';
    case 'auth/unauthorized-domain':
      return 'This domain is not authorized for Google sign-in';
    default:
      return fallback || 'Authentication failed';
  }
}

function rethrowAuth(e: unknown): never {
  if (e instanceof Error && e.message.includes('Database is closing/hidden')) {
    throw new Error('Sign-in was interrupted. Stay on this tab and try again.');
  }
  if (e instanceof Error && 'code' in e) {
    throw new Error(authErrorMessage(String((e as { code: unknown }).code), e.message));
  }
  throw e;
}

/// forceRefresh: a token minted moments ago still carries whatever claims
/// existed when it was issued, so a freshly granted role would be missed.
///
/// The bar is "holds at least one permission", not "is a full admin" — a
/// content reader has to be able to sign in too.
async function requireAdmin(): Promise<void> {
  const ok = await refreshAdminClaim(auth.currentUser, true);
  if (!ok) {
    await fbSignOut(auth);
    throw new Error('This account is not authorized for admin access');
  }
}

export async function signInWithEmail(email: string, password: string): Promise<void> {
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (e) {
    rethrowAuth(e);
  }
  await requireAdmin();
}

export async function signInWithGoogle(): Promise<void> {
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (e) {
    rethrowAuth(e);
  }
  await requireAdmin();
}

export async function signOut(): Promise<void> {
  await fbSignOut(auth);
}
