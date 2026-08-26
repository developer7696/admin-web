/// Port of the backend's `src/config/permissions.ts`.
///
/// Hand-written, deliberately — same reason `lib/constants.ts` hand-copies the
/// plan keys. There is no codegen in this repo, and a generated file would still
/// need someone to notice the backend changed.
///
/// **This copy decides nothing.** The server resolves the same claim and answers
/// 403 regardless of what the panel believes. What lives here is the UI's model
/// of the grant: which nav entries to draw, which Save buttons to render. If the
/// two ever disagree, the server wins and the user sees an error toast instead
/// of a hidden button — annoying, not a hole.

export const PERMISSIONS = [
  'exercises:read',
  'exercises:write',
  'programs:read',
  'programs:write',
  'articles:read',
  'articles:write',
  'recipes:read',
  'recipes:write',
  'complaints:read',
  'complaints:write',
  'vouchers:read',
  'vouchers:write',
  'users:read',
  'users:write',
  'billing:read',
  'billing:write',
  'analytics:read',
  'iam:read',
  'iam:write',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const PERMISSION_SET: ReadonlySet<string> = new Set(PERMISSIONS);

export const isPermission = (value: unknown): value is Permission =>
  typeof value === 'string' && PERMISSION_SET.has(value);

export const ROLE_KEYS = [
  'super_admin',
  'admin',
  'content_editor',
  'content_reader',
  'support',
  'analyst',
] as const;

export type RoleKey = (typeof ROLE_KEYS)[number];

export type RoleDefinition = {
  key: RoleKey;
  label: string;
  description: string;
  permissions: readonly Permission[];
};

const CONTENT_READ: readonly Permission[] = [
  'exercises:read',
  'programs:read',
  'articles:read',
  'recipes:read',
];

const CONTENT_WRITE: readonly Permission[] = [
  'exercises:write',
  'programs:write',
  'articles:write',
  'recipes:write',
];

export const ROLES: readonly RoleDefinition[] = [
  {
    key: 'super_admin',
    label: 'Super Admin',
    description: 'Everything, including granting and revoking access.',
    permissions: PERMISSIONS,
  },
  {
    key: 'admin',
    label: 'Admin',
    description: 'Everything except changing who has access.',
    permissions: PERMISSIONS.filter((p) => p !== 'iam:write'),
  },
  {
    key: 'content_editor',
    label: 'Content Editor',
    description: 'Create and edit exercises, programs, articles and recipes.',
    permissions: CONTENT_WRITE,
  },
  {
    key: 'content_reader',
    label: 'Content Reader',
    description: 'View exercises, programs, articles and recipes. No edits.',
    permissions: CONTENT_READ,
  },
  {
    key: 'support',
    label: 'Support',
    description: 'Handle complaints; look up users, their billing and vouchers.',
    permissions: ['complaints:write', 'users:read', 'billing:read', 'vouchers:read'],
  },
  {
    key: 'analyst',
    label: 'Analyst',
    description: 'Read the dashboard, conversion report and the user list.',
    permissions: ['analytics:read', 'users:read'],
  },
];

const ROLE_BY_KEY = new Map<string, RoleDefinition>(ROLES.map((role) => [role.key, role]));

export const isRoleKey = (value: unknown): value is RoleKey =>
  typeof value === 'string' && ROLE_BY_KEY.has(value);

export const roleLabel = (key: string): string => ROLE_BY_KEY.get(key)?.label ?? key;

/// Human labels for the permission grid, grouped as the backend groups them.
export const PERMISSION_GROUPS: readonly {
  resource: string;
  label: string;
  permissions: readonly Permission[];
}[] = [
  { resource: 'exercises', label: 'Exercise catalogue', permissions: ['exercises:read', 'exercises:write'] },
  { resource: 'programs', label: 'Programs', permissions: ['programs:read', 'programs:write'] },
  { resource: 'articles', label: 'Articles', permissions: ['articles:read', 'articles:write'] },
  { resource: 'recipes', label: 'Recipes', permissions: ['recipes:read', 'recipes:write'] },
  { resource: 'complaints', label: 'Complaints', permissions: ['complaints:read', 'complaints:write'] },
  { resource: 'vouchers', label: 'Vouchers', permissions: ['vouchers:read', 'vouchers:write'] },
  { resource: 'users', label: 'Users', permissions: ['users:read', 'users:write'] },
  { resource: 'billing', label: 'Billing & payments', permissions: ['billing:read', 'billing:write'] },
  { resource: 'analytics', label: 'Dashboard & conversion', permissions: ['analytics:read'] },
  { resource: 'iam', label: 'Access & roles', permissions: ['iam:read', 'iam:write'] },
];

/// The grant as it rides on the ID token, under the `adm` claim.
export type AdminGrant = {
  /// Preset role keys.
  r: RoleKey[];
  /// Permissions granted on top of the roles.
  g: Permission[];
  /// Permissions removed after the roles and grants are applied.
  d: Permission[];
};

export const EMPTY_GRANT: AdminGrant = { r: [], g: [], d: [] };

const stringsOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

/// Read the `adm` claim, ignoring anything this build does not recognise.
export function readGrant(claims: Record<string, unknown> | undefined): AdminGrant {
  const raw = claims?.adm;
  if (typeof raw !== 'object' || raw === null) return EMPTY_GRANT;
  const grant = raw as Record<string, unknown>;
  return {
    r: stringsOf(grant.r).filter(isRoleKey),
    g: stringsOf(grant.g).filter(isPermission),
    d: stringsOf(grant.d).filter(isPermission),
  };
}

/// Roles → grants → denies → implied reads. Must match the server's order, or
/// the panel hides a control the user could actually have used.
export function permissionsOfGrant(grant: AdminGrant): Set<Permission> {
  const resolved = new Set<string>();
  for (const key of grant.r) {
    for (const permission of ROLE_BY_KEY.get(key)?.permissions ?? []) resolved.add(permission);
  }
  for (const permission of grant.g) resolved.add(permission);
  for (const permission of [...resolved]) {
    if (permission.endsWith(':write')) {
      const read = `${permission.slice(0, -':write'.length)}:read`;
      if (PERMISSION_SET.has(read)) resolved.add(read);
    }
  }
  for (const permission of grant.d) resolved.delete(permission);
  // Denying a read takes the write with it — write-without-read is not a state
  // any screen can be in, and the API resolves it the same way.
  for (const permission of [...resolved]) {
    if (permission.endsWith(':write')) {
      const read = `${permission.slice(0, -':write'.length)}:read`;
      if (PERMISSION_SET.has(read) && !resolved.has(read)) resolved.delete(permission);
    }
  }
  return resolved as Set<Permission>;
}

export const permissionsOfClaims = (claims: Record<string, unknown> | undefined): Set<Permission> =>
  permissionsOfGrant(readGrant(claims));
