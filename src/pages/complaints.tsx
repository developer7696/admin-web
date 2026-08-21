import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SquarePen, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  deleteComplaint,
  fetchSupportCatalog,
  getComplaintStatistics,
  markComplaintAsRead,
  subscribeComplaints,
  updateComplaintPriority,
  updateComplaintStatus,
  type ComplaintRow,
} from '@/services/complaints-service';
import { fmtDateTime, toDate } from '@/lib/format';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { Button } from '@/components/ui/button';
import { PageBar } from '@/components/common/page-header';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

/// Customer support queue: the `complaints` collection, per-status tabs, and a
/// per-complaint status/priority/response editor.

function statusTint(status: string): string {
  switch (status) {
    case 'pending':
      return 'text-orange-600 border-orange-600 bg-orange-500/10';
    case 'in_progress':
      return 'text-blue-600 border-blue-600 bg-blue-500/10';
    case 'resolved':
      return 'text-emerald-600 border-emerald-600 bg-emerald-500/10';
    case 'closed':
      return 'text-red-600 border-red-600 bg-red-500/10';
    default:
      return 'text-slate-500 border-slate-500 bg-slate-500/10';
  }
}

function priorityTint(priority: string): string {
  switch (priority) {
    case 'low':
      return 'text-emerald-600 bg-emerald-500/10';
    case 'medium':
      return 'text-orange-600 bg-orange-500/10';
    case 'high':
      return 'text-red-600 bg-red-500/10';
    default:
      return 'text-slate-500 bg-slate-500/10';
  }
}

function Avatar({ name, photo, size = 40 }: { name: string; photo?: string; size?: number }) {
  return (
    <span
      style={{ width: size, height: size }}
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted"
    >
      {photo ? (
        <img src={photo} alt={name} className="size-full object-cover" />
      ) : (
        <span className="font-semibold text-muted-foreground" style={{ fontSize: size * 0.4 }}>
          {(name || 'U').charAt(0).toUpperCase()}
        </span>
      )}
    </span>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="mb-2 flex items-start gap-3">
      <span className="w-20 shrink-0 text-sm font-bold text-muted-foreground">{label}:</span>
      <span className="min-w-0 flex-1 text-sm">{value}</span>
    </div>
  );
}

function Block({ title, children, tone }: { title: string; children: React.ReactNode; tone?: 'blue' }) {
  return (
    <div className="mt-4">
      <p className="text-base font-bold">{title}</p>
      <div
        className={cn(
          'mt-2 rounded-lg border p-3 text-sm',
          tone === 'blue'
            ? 'border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30'
            : 'border-border bg-muted/50',
        )}
      >
        {children}
      </div>
    </div>
  );
}

function UpdateDialog({
  complaint,
  statuses,
  priorities,
  onClose,
  onSaved,
}: {
  complaint: ComplaintRow;
  statuses: string[];
  priorities: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [status, setStatus] = useState(
    statuses.includes(String(complaint.status ?? ''))
      ? String(complaint.status)
      : (statuses[0] ?? ''),
  );
  const [priority, setPriority] = useState(
    priorities.includes(String(complaint.priority ?? ''))
      ? String(complaint.priority)
      : (priorities[0] ?? ''),
  );
  const [response, setResponse] = useState(String(complaint.adminResponse ?? ''));
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await updateComplaintStatus({
        complaintId: complaint.id,
        status,
        adminResponse: response.trim() || null,
      });
      await updateComplaintPriority(complaint.id, priority);
      toast.success('Complaint status updated successfully!');
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update complaint status');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Update Complaint</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <div>
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="mt-1.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {statuses.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s.toUpperCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Priority</Label>
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger className="mt-1.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {priorities.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p.toUpperCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Admin Response</Label>
            <Textarea
              rows={3}
              className="mt-1.5"
              placeholder="Enter your response..."
              value={response}
              onChange={(e) => setResponse(e.target.value)}
            />
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={() => void save()}>
            Update
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DetailsDialog({
  complaint,
  onClose,
  onUpdate,
  onDelete,
}: {
  complaint: ComplaintRow;
  onClose: () => void;
  onUpdate: () => void;
  onDelete: () => void;
}) {
  const createdAt = toDate(complaint.createdAt) ?? new Date();
  const respondedAt = toDate(complaint.adminResponseAt);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl">Complaint Details</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="flex items-center gap-4">
            <Avatar
              name={String(complaint.userName ?? 'U')}
              photo={complaint.userProfilePhoto as string | undefined}
              size={60}
            />
            <div className="min-w-0">
              <p className="truncate text-lg font-bold">{String(complaint.userName ?? 'Anonymous')}</p>
              <p className="truncate text-sm text-muted-foreground">
                {String(complaint.userEmail ?? '')}
              </p>
            </div>
          </div>

          <div className="mt-5">
            <DetailRow label="Category" value={String(complaint.category ?? '')} />
            <DetailRow label="Status" value={String(complaint.status ?? '')} />
            <DetailRow label="Priority" value={String(complaint.priority ?? '')} />
            <DetailRow label="Created At" value={fmtDateTime(createdAt)} />
          </div>

          <Block title="Subject">{String(complaint.subject ?? '')}</Block>
          <Block title="Description">{String(complaint.description ?? '')}</Block>

          {complaint.adminResponse != null && (
            <Block title="Admin Response" tone="blue">
              {String(complaint.adminResponse)}
              <p className="mt-2 text-xs text-muted-foreground">
                Responded at: {fmtDateTime(respondedAt ?? new Date())}
              </p>
            </Block>
          )}
        </DialogBody>
        <DialogFooter className="justify-stretch">
          <Button
            className="flex-1"
            onClick={() => {
              onClose();
              onUpdate();
            }}
          >
            Update Status
          </Button>
          <Button
            variant="destructive"
            className="flex-1"
            onClick={() => {
              onClose();
              onDelete();
            }}
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ComplaintsPage() {
  const [tab, setTab] = useState<string>('all');
  const [rows, setRows] = useState<ComplaintRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const [details, setDetails] = useState<ComplaintRow | null>(null);
  const [updating, setUpdating] = useState<ComplaintRow | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const qc = useQueryClient();
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['complaint-stats'],
    queryFn: getComplaintStatistics,
  });
  const { data: catalog } = useQuery({
    queryKey: ['support-catalog'],
    queryFn: fetchSupportCatalog,
  });
  const statuses = catalog?.statuses ?? [];
  const priorities = catalog?.priorities ?? [];
  const tabs = [
    ['all', 'All'] as const,
    ...statuses.map((s) => [s, s.replace(/_/g, ' ')] as const),
  ];

  useEffect(() => {
    setLoading(true);
    return subscribeComplaints(
      tab,
      (next) => {
        setRows(next);
        setLoading(false);
        setError(null);
      },
      (e) => {
        setError(e);
        setLoading(false);
      },
    );
  }, [tab]);

  // The per-status query cannot also order server-side without a composite
  // index, so newest-first is applied here for every tab.
  const sorted = useMemo(
    () =>
      [...rows].sort(
        (a, b) =>
          (toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0),
      ),
    [rows],
  );

  const refreshStats = () => qc.invalidateQueries({ queryKey: ['complaint-stats'] });

  return (
    <div className="flex h-full flex-col">
      {/* The four counts were a full-width card with its own "Complaint
          Statistics" heading above the tabs — a whole band of chrome to say four
          numbers. They read the same inline, and the tab row below already names
          the same states. */}
      <PageBar
        title="Complaints"
        status={
          statsLoading || !stats
            ? 'Loading…'
            : `${stats.total} total · ${stats.pending} pending · ${stats.inProgress} in progress · ${stats.resolved} resolved`
        }
        className="shrink-0 px-4 pb-2.5 pt-4"
      />

      <div className="shrink-0 border-b border-border bg-card px-4 pb-2.5">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            {tabs.map(([value, label]) => (
              <TabsTrigger key={value} value={value}>
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-4">
        {loading && <LoadingState />}
        {error && <ErrorState error={error} />}
        {!loading && !error && sorted.length === 0 && <EmptyState title="No complaints found" />}

        {sorted.map((c) => {
          const isRead = c.isRead === true;
          const status = String(c.status ?? '');
          const priority = String(c.priority ?? '');
          const createdAt = toDate(c.createdAt) ?? new Date();

          return (
            <Card key={c.id} className="mb-3">
              <button
                type="button"
                onClick={() => {
                  if (!isRead) void markComplaintAsRead(c.id).then(refreshStats);
                  setDetails(c);
                }}
                className="block w-full p-4 text-left"
              >
                <div className="flex items-start gap-3">
                  <span
                    className={cn(
                      'mt-2 size-2 shrink-0 rounded-full',
                      isRead ? 'bg-transparent' : 'bg-blue-500',
                    )}
                  />
                  <Avatar
                    name={String(c.userName ?? 'U')}
                    photo={c.userProfilePhoto as string | undefined}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold">{String(c.userName ?? 'Anonymous')}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {String(c.userEmail ?? '')}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span
                      className={cn(
                        'rounded-xl border px-2 py-1 text-[10px] font-bold',
                        statusTint(status),
                      )}
                    >
                      {status.toUpperCase()}
                    </span>
                    <span
                      className={cn('rounded-lg px-1.5 py-0.5 text-[8px] font-bold', priorityTint(priority))}
                    >
                      {priority.toUpperCase()}
                    </span>
                  </div>
                </div>

                <div className="mt-3 flex items-center gap-2">
                  {c.category ? (
                    <span className="shrink-0 rounded-lg bg-blue-500/10 px-2 py-1 text-[10px] font-bold text-blue-600">
                      {String(c.category)}
                    </span>
                  ) : null}
                  <span className="min-w-0 flex-1 truncate text-base font-semibold">
                    {String(c.subject ?? '')}
                  </span>
                </div>

                <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                  {String(c.description ?? '')}
                </p>
              </button>

              <div className="flex items-center justify-between px-4 pb-3">
                <span className="text-xs text-muted-foreground">{fmtDateTime(createdAt)}</span>
                <div className="flex">
                  <Button variant="ghost" size="icon-sm" onClick={() => setUpdating(c)}>
                    <SquarePen className="size-5 text-blue-600" />
                  </Button>
                  <Button variant="ghost" size="icon-sm" onClick={() => setDeleting(c.id)}>
                    <Trash2 className="size-5 text-red-600" />
                  </Button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {details && (
        <DetailsDialog
          complaint={details}
          onClose={() => setDetails(null)}
          onUpdate={() => setUpdating(details)}
          onDelete={() => setDeleting(details.id)}
        />
      )}

      {updating && (
        <UpdateDialog
          complaint={updating}
          statuses={statuses}
          priorities={priorities}
          onClose={() => setUpdating(null)}
          onSaved={refreshStats}
        />
      )}

      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setDeleting(null)}
          title="Delete Complaint"
          description="Are you sure you want to delete this complaint? This action cannot be undone."
          confirmLabel="Delete"
          destructive
          onConfirm={async () => {
            try {
              await deleteComplaint(deleting);
              refreshStats();
              toast.success('Complaint deleted successfully!');
            } catch (e) {
              toast.error(e instanceof Error ? e.message : 'Failed to delete complaint');
            }
          }}
        />
      )}
    </div>
  );
}
