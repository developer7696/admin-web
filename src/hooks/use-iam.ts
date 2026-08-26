import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { iamService } from '@/services/iam-service';
import type { IamGrantInput, IamLookup, IamMember } from '@/types/iam';

export const iamMembersKey = ['iam', 'members'] as const;

/// The roster.
///
/// Not held stale: this is the screen where someone checks whether a revoke took
/// effect, and a cached "still has access" here is the one answer that must not
/// be wrong. It is also a handful of rows, so refetching costs nothing.
export function useIamMembers() {
  return useQuery<IamMember[]>({
    queryKey: iamMembersKey,
    queryFn: iamService.listMembers,
    staleTime: 0,
  });
}

/// Re-read the roster. Failures are swallowed so a refresh blip never replaces
/// the write's own error — same rule as the exercise catalogue.
async function reload(qc: QueryClient): Promise<void> {
  try {
    await qc.refetchQueries({ queryKey: iamMembersKey });
  } catch {
    // Never let a reload failure mask the mutation's result.
  }
}

/// Look an email up before granting. A mutation rather than a query because it
/// is a one-shot action from a dialog, not state the screen keeps.
export function useIamLookup() {
  return useMutation<IamLookup, Error, string>({
    mutationFn: iamService.lookup,
  });
}

/// Save a member's grant, then reload.
///
/// `onSettled` rather than `onSuccess`: a save that timed out may still have
/// landed, and a roster that disagrees with the claims is exactly the state this
/// screen exists to prevent.
export function useSetIamMember() {
  const qc = useQueryClient();
  return useMutation<IamMember, Error, { uid: string; input: IamGrantInput }>({
    mutationFn: ({ uid, input }) => iamService.setMember(uid, input),
    onSettled: () => reload(qc),
  });
}

export function useRevokeIamMember() {
  const qc = useQueryClient();
  return useMutation<void, Error, { uid: string; reason?: string }>({
    mutationFn: ({ uid, reason }) => iamService.revokeMember(uid, reason),
    onSettled: () => reload(qc),
  });
}
