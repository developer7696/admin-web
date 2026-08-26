import { adminApi, ApiException } from '@/lib/api-client';
import {
  parseIamLookup,
  parseIamMember,
  type IamGrantInput,
  type IamLookup,
  type IamMember,
} from '@/types/iam';

/// Who may use this panel, as data. Entirely the API — there is no
/// direct-Firestore path here and there must not be one: `admin_members` is a
/// mirror the server writes, and the thing that actually grants access is a
/// custom claim the browser cannot set at all.
///
/// Every function throws `ApiException` and nothing else.

async function guard<T>(body: () => Promise<T>): Promise<T> {
  try {
    return await body();
  } catch (e) {
    if (e instanceof ApiException) throw e;
    throw new ApiException(
      0,
      'unexpected',
      `Unexpected problem with access control: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

export const iamService = {
  /// The roster, active members first.
  listMembers: (): Promise<IamMember[]> =>
    guard(async () => {
      const json = await adminApi.iamMembers();
      const rows = Array.isArray(json.members) ? json.members : [];
      return rows.map(parseIamMember);
    }),

  /// Resolve an email to an account. Throws `user_not_found` (404) when there is
  /// no such account — which is the whole point of the call: a grant written
  /// against a typo would sit in the roster looking correct and do nothing.
  lookup: (email: string): Promise<IamLookup> =>
    guard(async () => parseIamLookup(await adminApi.iamLookup(email))),

  /// Replace a member's grant.
  ///
  /// Distinct 409s worth catching by `code`: `self_modification` (you cannot
  /// edit your own access), `last_super_admin` (someone has to keep the keys),
  /// `email_unverified` (the grant would be inert).
  setMember: (uid: string, input: IamGrantInput): Promise<IamMember> =>
    guard(async () => {
      const json = await adminApi.iamSetMember(uid, {
        roles: input.roles,
        grants: input.grants,
        denies: input.denies,
        ...(input.note ? { note: input.note } : {}),
      });
      return parseIamMember(json.member);
    }),

  /// Revoke all access. The roster row survives, flagged `revokedAt`.
  revokeMember: (uid: string, reason?: string): Promise<void> =>
    guard(async () => {
      await adminApi.iamRevokeMember(uid, reason);
    }),
};
