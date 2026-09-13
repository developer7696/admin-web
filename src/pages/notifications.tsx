import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Ban,
  Bell,
  CheckCircle2,
  Clock,
  Plus,
  Send,
  Smartphone,
  SquarePen,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { ApiException } from '@/lib/api-client';
import { fmtDayMonthYearTime, timeAgo } from '@/lib/format';
import { useCan } from '@/auth/auth-context';
import {
  useCancelNotification,
  useNotifications,
  useSendNotification,
  type NotificationListParams,
} from '@/hooks/use-notifications';
import { sendTest } from '@/services/notifications-service';
import {
  CATEGORY_LABELS,
  isEditable,
  STATUS_LABELS,
  type NotificationAudience,
  type NotificationModel,
  type NotificationStatus,
} from '@/types/notification';
import { HeaderSlot } from '@/app/header-slot';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { PageBar } from '@/components/common/page-header';
import { SearchInput } from '@/components/common/search-input';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { NotificationFormDialog } from './notification-form';
import { NotificationRules } from './notification-rules';

/**
 * Push campaigns — the admin side of the backend's `notifications` module.
 *
 * THE SHAPE OF THIS SCREEN IS A SAFETY DECISION. Composing and sending are
 * separate steps: the dialog only ever produces a draft or a schedule, and
 * delivery happens here, behind a confirmation that states the audience size in
 * words. A broadcast reaches every installed device at once and there is no
 * recall, so the cost of one extra click is not worth weighing against that.
 *
 * "Test on my phone" sits next to Send for the same reason. It is the only way
 * to see the real title, image and tap target on a real device before anyone
 * else does.
 */

function describeAudience(a: NotificationAudience): string {
  if (a.kind === 'all') return 'Everyone';
  if (a.kind === 'users') {
    return `${String(a.uids.length)} specific ${a.uids.length === 1 ? 'user' : 'users'}`;
  }
  const bits: string[] = [];
  if (a.tier) bits.push(a.tier);
  if (a.platform) bits.push(a.platform === 'ios' ? 'iOS' : 'Android');
  if (a.program) bits.push(`on ${a.program}`);
  if (a.assessmentCompleted != null) {
    bits.push(a.assessmentCompleted ? 'assessed' : 'not assessed');
  }
  return bits.length > 0 ? bits.join(' · ') : 'Everyone (empty segment)';
}

const STATUS_TONE: Record<NotificationStatus, string> = {
  draft: 'bg-muted text-muted-foreground',
  scheduled: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  sending: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  sent: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  failed: 'bg-destructive/10 text-destructive',
  cancelled: 'bg-muted text-muted-foreground line-through',
};

export function NotificationsPage() {
  const canWrite = useCan('notifications:write');

  const [tab, setTab] = useState('campaigns');
  const [status, setStatus] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<NotificationModel | null>(null);
  const [confirmSend, setConfirmSend] = useState<NotificationModel | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<NotificationModel | null>(null);
  const [testing, setTesting] = useState<string | null>(null);

  const params: NotificationListParams = status === 'all' ? {} : { status };
  const query = useNotifications(params);
  const sendMutation = useSendNotification();
  const cancelMutation = useCancelNotification();

  // Text search is client-side: the backend has no search param, and the list
  // is small enough that filtering loaded rows is honest here rather than
  // misleading (unlike the user list, which pages).
  const rows = useMemo(() => {
    const all = query.data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (n) => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q),
    );
  }, [query.data, search]);

  async function runTest(n: NotificationModel) {
    setTesting(n.id);
    try {
      const res = await sendTest(n.id);
      if (res.pushSent > 0) {
        toast.success(`Sent to ${String(res.pushSent)} of your devices — check your phone.`);
      } else {
        toast.warning('No device accepted the test. Is the app signed in on your phone?');
      }
    } catch (e) {
      toast.error(e instanceof ApiException ? e.message : 'Could not send the test.');
    } finally {
      setTesting(null);
    }
  }

  return (
    <>
      <HeaderSlot>
        <SearchInput
          variant="header"
          value={search}
          onChange={setSearch}
          placeholder="Search notifications…"
        />
      </HeaderSlot>

      <div className="space-y-4">
        <PageBar
          title="Notifications"
          status={
            query.data
              ? `${String(query.data.length)} campaign${query.data.length === 1 ? '' : 's'}`
              : undefined
          }
        >
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {(Object.keys(STATUS_LABELS) as NotificationStatus[]).map((s) => (
                <SelectItem key={s} value={s}>
                  {STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {canWrite && (
            <Button
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Plus className="size-4" />
              New notification
            </Button>
          )}
        </PageBar>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
            {/* Rules are a standing instruction rather than a message, so they
                get their own tab instead of sitting among one-off sends. */}
            <TabsTrigger value="rules">Automatic rules</TabsTrigger>
          </TabsList>

          <TabsContent value="campaigns" className="mt-4">
        {query.isLoading ? (
          <LoadingState label="Loading notifications…" />
        ) : query.isError ? (
          <ErrorState
            error={query.error}
            onRetry={() => {
              void query.refetch();
            }}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Bell className="size-7" />}
            title={search ? 'No notifications match that search' : 'No notifications yet'}
            hint={
              search
                ? undefined
                : 'Compose one to tell everyone about a new recipe, program or announcement.'
            }
            action={
              canWrite && !search ? (
                <Button
                  onClick={() => {
                    setEditing(null);
                    setFormOpen(true);
                  }}
                >
                  <Plus className="size-4" />
                  New notification
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="space-y-2">
            {rows.map((n) => (
              <Card key={n.id} className="p-4">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                          STATUS_TONE[n.status],
                        )}
                      >
                        {STATUS_LABELS[n.status]}
                      </span>
                      <Badge variant="outline">{CATEGORY_LABELS[n.category]}</Badge>
                      {n.source.startsWith('auto:') && (
                        <Badge variant="outline" title={`Raised by the ${n.source} rule`}>
                          Automatic
                        </Badge>
                      )}
                      <p className="truncate font-semibold">{n.title}</p>
                    </div>

                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{n.body}</p>

                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Users className="size-3" />
                        {describeAudience(n.audience)}
                      </span>

                      {n.status === 'scheduled' && n.scheduledAt && (
                        <span className="inline-flex items-center gap-1">
                          <Clock className="size-3" />
                          Goes out {fmtDayMonthYearTime(n.scheduledAt)}
                        </span>
                      )}

                      {n.status === 'sent' && n.sentAt && (
                        <span className="inline-flex items-center gap-1">
                          <CheckCircle2 className="size-3" />
                          {/* The number that matters: devices reached, not the
                              segment size. They differ by mutes and dead tokens. */}
                          {String(n.pushSent)} of {String(n.recipientCount)} · {timeAgo(n.sentAt)}
                        </span>
                      )}

                      {n.pushFailed > 0 && (
                        <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                          <AlertTriangle className="size-3" />
                          {String(n.pushFailed)} failed
                        </span>
                      )}

                      {n.status === 'failed' && n.lastError && (
                        <span className="inline-flex items-center gap-1 text-destructive" title={n.lastError}>
                          <AlertTriangle className="size-3" />
                          {n.lastError}
                        </span>
                      )}
                    </div>
                  </div>

                  {canWrite && (
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      {isEditable(n) && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              void runTest(n);
                            }}
                            disabled={testing === n.id}
                          >
                            <Smartphone className="size-4" />
                            {testing === n.id ? 'Sending…' : 'Test on my phone'}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setEditing(n);
                              setFormOpen(true);
                            }}
                          >
                            <SquarePen className="size-4" />
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setConfirmCancel(n);
                            }}
                          >
                            <Ban className="size-4" />
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => {
                              setConfirmSend(n);
                            }}
                          >
                            <Send className="size-4" />
                            Send now
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
          </TabsContent>

          <TabsContent value="rules" className="mt-4">
            <NotificationRules />
          </TabsContent>
        </Tabs>
      </div>

      <NotificationFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        existing={editing}
        onSaved={() => {
          void query.refetch();
        }}
      />

      {/* The confirmation states the audience in words rather than asking "are
          you sure?" — the thing worth checking is WHO, not whether. */}
      <ConfirmDialog
        open={confirmSend != null}
        onOpenChange={(o) => {
          if (!o) setConfirmSend(null);
        }}
        title="Send this notification now?"
        description={
          confirmSend ? (
            <>
              <strong>{confirmSend.title}</strong> will be delivered to{' '}
              <strong>{describeAudience(confirmSend.audience).toLowerCase()}</strong> immediately.
              This cannot be undone.
            </>
          ) : null
        }
        confirmLabel="Send now"
        destructive
        onConfirm={async () => {
          if (!confirmSend) return;
          try {
            await sendMutation.mutateAsync(confirmSend.id);
            toast.success('Sent');
          } catch (e) {
            toast.error(e instanceof ApiException ? e.message : 'Could not send.');
          } finally {
            setConfirmSend(null);
          }
        }}
      />

      <ConfirmDialog
        open={confirmCancel != null}
        onOpenChange={(o) => {
          if (!o) setConfirmCancel(null);
        }}
        title="Cancel this notification?"
        description="It will not be sent. The copy is kept, so it can be reused."
        confirmLabel="Cancel it"
        onConfirm={async () => {
          if (!confirmCancel) return;
          try {
            await cancelMutation.mutateAsync(confirmCancel.id);
            toast.success('Cancelled');
          } catch (e) {
            toast.error(e instanceof ApiException ? e.message : 'Could not cancel.');
          } finally {
            setConfirmCancel(null);
          }
        }}
      />
    </>
  );
}
