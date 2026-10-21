import { describe, expect, it } from 'vitest';
import {
  EMPTY_GRANT,
  PERMISSIONS,
  isPermission,
  isRoleKey,
  permissionsOfClaims,
  permissionsOfGrant,
  readGrant,
  roleLabel,
} from './permissions';

describe('guards', () => {
  it('recognises known permissions and role keys', () => {
    expect(isPermission('exercises:read')).toBe(true);
    expect(isPermission('exercises:delete')).toBe(false);
    expect(isPermission(42)).toBe(false);
    expect(isRoleKey('support')).toBe(true);
    expect(isRoleKey('owner')).toBe(false);
  });

  it('labels known roles and echoes unknown keys', () => {
    expect(roleLabel('super_admin')).toBe('Super Admin');
    expect(roleLabel('mystery_role')).toBe('mystery_role');
  });
});

describe('readGrant', () => {
  it('answers the empty grant when the claim is missing or malformed', () => {
    expect(readGrant(undefined)).toEqual(EMPTY_GRANT);
    expect(readGrant({})).toEqual(EMPTY_GRANT);
    expect(readGrant({ adm: 'yes' })).toEqual(EMPTY_GRANT);
    expect(readGrant({ adm: null })).toEqual(EMPTY_GRANT);
  });

  it('keeps only the roles and permissions this build recognises', () => {
    const grant = readGrant({
      adm: {
        r: ['support', 'owner', 7],
        g: ['users:write', 'users:delete'],
        d: ['billing:read', false],
      },
    });
    expect(grant).toEqual({ r: ['support'], g: ['users:write'], d: ['billing:read'] });
  });
});

describe('permissionsOfGrant', () => {
  it('expands roles into their permissions', () => {
    const resolved = permissionsOfGrant({ r: ['analyst'], g: [], d: [] });
    expect(resolved).toEqual(new Set(['analytics:read', 'users:read']));
  });

  it('gives admin everything except iam:write', () => {
    const resolved = permissionsOfGrant({ r: ['admin'], g: [], d: [] });
    expect(resolved.has('iam:write')).toBe(false);
    expect(resolved.size).toBe(PERMISSIONS.length - 1);
  });

  it('gives super_admin everything', () => {
    const resolved = permissionsOfGrant({ r: ['super_admin'], g: [], d: [] });
    expect(resolved).toEqual(new Set(PERMISSIONS));
  });

  it('implies the read when only the write is granted', () => {
    const resolved = permissionsOfGrant({ r: [], g: ['exercises:write'], d: [] });
    expect(resolved).toEqual(new Set(['exercises:write', 'exercises:read']));
  });

  it('applies denies after roles and grants', () => {
    const resolved = permissionsOfGrant({ r: ['support'], g: [], d: ['vouchers:read'] });
    expect(resolved.has('vouchers:read')).toBe(false);
    expect(resolved.has('users:read')).toBe(true);
  });

  it('takes the write with it when the read is denied', () => {
    const resolved = permissionsOfGrant({ r: [], g: ['programs:write'], d: ['programs:read'] });
    expect(resolved.has('programs:write')).toBe(false);
    expect(resolved.has('programs:read')).toBe(false);
  });

  it('content_editor can read what it can write', () => {
    const resolved = permissionsOfGrant({ r: ['content_editor'], g: [], d: [] });
    expect(resolved.has('articles:read')).toBe(true);
    expect(resolved.has('articles:write')).toBe(true);
    expect(resolved.has('users:read')).toBe(false);
  });
});

describe('permissionsOfClaims', () => {
  it('resolves a full claim end to end', () => {
    const resolved = permissionsOfClaims({
      adm: { r: ['analyst'], g: ['vouchers:write'], d: ['users:read'] },
    });
    expect(resolved).toEqual(new Set(['analytics:read', 'vouchers:write', 'vouchers:read']));
  });

  it('resolves missing claims to no permissions', () => {
    expect(permissionsOfClaims(undefined).size).toBe(0);
  });
});
