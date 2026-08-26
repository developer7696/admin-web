import { isPermission, isRoleKey, type Permission, type RoleKey } from '@/auth/permissions';

/// The IAM roster, as data. Plain TypeScript, no Firebase imports — the panel
/// never reads `admin_members` directly, because the collection is a mirror the
/// backend maintains and not something a client should be trusted with.

/// One row of the roster.
export type IamMember = {
  uid: string;
  email: string | null;
  displayName: string | null;
  roles: RoleKey[];
  grants: Permission[];
  denies: Permission[];
  /// What roles + grants − denies actually resolve to, per the SERVER.
  permissions: Permission[];
  note: string | null;
  updatedAt: Date | null;
  updatedBy: string | null;
  updatedByEmail: string | null;
  /// Set when access was revoked. The row is kept so the history survives.
  revokedAt: Date | null;
};

/// The result of looking an email up before granting it access.
export type IamLookup = {
  uid: string;
  email: string | null;
  displayName: string | null;
  emailVerified: boolean;
  /// Their existing roster row, when they already have one.
  member: IamMember | null;
};

/// What a save sends. The complete grant, never a patch — see the backend's
/// `modules/iam/schemas.ts` for why.
export type IamGrantInput = {
  roles: RoleKey[];
  grants: Permission[];
  denies: Permission[];
  note?: string;
};

const str = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

/// ISO string → Date. Anything unparseable becomes null rather than an Invalid
/// Date, which would render as "Invalid Date" in the table.
function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const filterArray = <T>(value: unknown, guard: (item: unknown) => item is T): T[] =>
  Array.isArray(value) ? value.filter(guard) : [];

export function parseIamMember(raw: unknown): IamMember {
  const data = (raw ?? {}) as Record<string, unknown>;
  return {
    uid: typeof data.uid === 'string' ? data.uid : '',
    email: str(data.email),
    displayName: str(data.displayName),
    roles: filterArray(data.roles, isRoleKey),
    grants: filterArray(data.grants, isPermission),
    denies: filterArray(data.denies, isPermission),
    permissions: filterArray(data.permissions, isPermission),
    note: str(data.note),
    updatedAt: parseDate(data.updatedAt),
    updatedBy: str(data.updatedBy),
    updatedByEmail: str(data.updatedByEmail),
    revokedAt: parseDate(data.revokedAt),
  };
}

export function parseIamLookup(raw: unknown): IamLookup {
  const data = (raw ?? {}) as Record<string, unknown>;
  return {
    uid: typeof data.uid === 'string' ? data.uid : '',
    email: str(data.email),
    displayName: str(data.displayName),
    emailVerified: data.emailVerified === true,
    member: data.member == null ? null : parseIamMember(data.member),
  };
}

/// A member is active unless they have been revoked.
export const isActiveMember = (member: IamMember): boolean => member.revokedAt === null;
