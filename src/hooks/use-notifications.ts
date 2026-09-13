import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminApi, type Json } from '@/lib/api-client';
import {
  parseNotification,
  parseRule,
  type AudiencePreview,
  type NotificationAudience,
  type NotificationModel,
  type NotificationRule,
} from '@/types/notification';

/// Server-side list filters. `undefined` on either axis means "no filter".
/// Text search is applied client-side in the page, so it stays out of the key.
export type NotificationListParams = { status?: string; category?: string };

export const notificationListKey = (p: NotificationListParams) =>
  ['notifications', p.status ?? null, p.category ?? null] as const;
export const notificationRulesKey = ['notifications', 'rules'] as const;

export function useNotifications(params: NotificationListParams) {
  return useQuery<NotificationModel[]>({
    queryKey: notificationListKey(params),
    queryFn: async () => {
      const json = await adminApi.listNotifications(params);
      return ((json.notifications as unknown[]) ?? []).map((n) =>
        parseNotification(n as Record<string, unknown>),
      );
    },
    /// Short, because a campaign in flight changes status on its own — the
    /// worker moves it from `scheduled` to `sent` with no request from here.
    staleTime: 10 * 1000,
  });
}

export function useNotificationRules() {
  return useQuery<NotificationRule[]>({
    queryKey: notificationRulesKey,
    queryFn: async () => {
      const json = await adminApi.notificationRules();
      return ((json.rules as unknown[]) ?? []).map((r) => parseRule(r as Record<string, unknown>));
    },
    staleTime: 60 * 1000,
  });
}

/**
 * Audience size for a predicate.
 *
 * Its own query, keyed on the audience itself, so switching back and forth
 * between two segments while composing does not re-ask the server each time.
 * `enabled` is the caller's switch for "the form is complete enough to count".
 */
export function useAudiencePreview(audience: NotificationAudience | null) {
  return useQuery<AudiencePreview>({
    queryKey: ['notifications', 'audience', JSON.stringify(audience)],
    enabled: audience != null,
    queryFn: () =>
      adminApi.previewAudience(audience as unknown as Json) as unknown as Promise<AudiencePreview>,
    staleTime: 30 * 1000,
  });
}

/// Every write invalidates the whole `notifications` tree: a send changes the
/// row's status AND its delivery counters, and an edit can move it between the
/// status-filtered lists.
function useNotificationMutation<TVars>(fn: (vars: TVars) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation<unknown, Error, TVars>({
    mutationFn: fn,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

export const useCreateNotification = () =>
  useNotificationMutation<Json>((body) => adminApi.createNotification(body));

export const useUpdateNotification = () =>
  useNotificationMutation<{ id: string; body: Json }>(({ id, body }) =>
    adminApi.updateNotification(id, body),
  );

export const useCancelNotification = () =>
  useNotificationMutation<string>((id) => adminApi.cancelNotification(id));

/// Sends to the calling admin's own devices only. Still invalidates, because
/// a test that finds dead tokens changes nothing on the campaign but the
/// response is worth surfacing.
export const useTestNotification = () =>
  useNotificationMutation<string>((id) => adminApi.testNotification(id));

/// THE IRREVERSIBLE ONE. Callers must confirm before invoking this.
export const useSendNotification = () =>
  useNotificationMutation<string>((id) => adminApi.sendNotification(id));

export const useUpdateNotificationRule = () =>
  useNotificationMutation<{ key: string; body: Json }>(({ key, body }) =>
    adminApi.updateNotificationRule(key, body),
  );
