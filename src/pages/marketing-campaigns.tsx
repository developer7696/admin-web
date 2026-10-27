import { useState } from 'react';
import { Loader2, Mail, Pencil, Plus, RotateCcw, Send, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ApiException } from '@/lib/api-client';
import { useAuth, useCan } from '@/auth/auth-context';
import { fmtDateShort } from '@/lib/format';
import { useCampaigns, useMarketingMutation, useMarketingSummary } from '@/hooks/use-marketing';
import { marketingService } from '@/services/marketing-service';
import { isStalled, type Campaign } from '@/types/marketing';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { PageBar } from '@/components/common/page-header';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { MarketingSetupBanner } from './marketing-contacts';

/**
 * Write a campaign, test it on yourself, send it to every subscribed contact.
 * A send runs on the server; this page polls the counts while it does, and
 * offers Resume if the server restarted part-way.
 */

const errorText = (e: unknown, fallback: string): string => (e instanceof ApiException ? e.message : fallback);

function StatusBadge({ campaign }: { campaign: Campaign }) {
  if (isStalled(campaign)) return <Badge variant="warning">Interrupted</Badge>;
  switch (campaign.status) {
    case 'draft':
      return <Badge variant="outline">Draft</Badge>;
    case 'sending':
      return <Badge>Sending…</Badge>;
    case 'sent':
      return <Badge variant="success">Sent</Badge>;
    case 'failed':
      return <Badge variant="destructive">Stopped</Badge>;
  }
}

// ── Editor ──────────────────────────────────────────────────────────────────

function EditorDialog({ campaign, onClose }: { campaign: Campaign | null; onClose: () => void }) {
  const [subject, setSubject] = useState(campaign?.subject ?? '');
  const [body, setBody] = useState(campaign?.body ?? '');
  const [error, setError] = useState<string | null>(null);
  const save = useMarketingMutation((draft: { subject: string; body: string }) =>
    campaign ? marketingService.update(campaign.id, draft) : marketingService.create(draft),
  );

  async function submit() {
    setError(null);
    try {
      await save.mutateAsync({ subject: subject.trim(), body: body.trim() });
      toast.success('Draft saved');
      onClose();
    } catch (e) {
      setError(errorText(e, 'Could not save the draft.'));
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !save.isPending && !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{campaign ? 'Edit campaign' : 'New campaign'}</DialogTitle>
          <DialogDescription>
            Plain text. A blank line starts a new paragraph, links are clickable, and{' '}
            <code>{'{name}'}</code> becomes each person&apos;s first name (&quot;there&quot; when unknown). An
            unsubscribe link is added at the bottom automatically.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="campaign-subject">Subject</Label>
            <Input
              id="campaign-subject"
              value={subject}
              maxLength={200}
              placeholder="Your 7-day plan is ready, {name}"
              onChange={(e) => {
                setSubject(e.target.value);
              }}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="campaign-body">Message</Label>
            <Textarea
              id="campaign-body"
              value={body}
              rows={14}
              maxLength={20000}
              placeholder={'Hi {name},\n\n…\n\nTeam Aarambh'}
              onChange={(e) => {
                setBody(e.target.value);
              }}
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" disabled={save.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={save.isPending || subject.trim() === '' || body.trim() === ''}
            onClick={() => void submit()}
          >
            {save.isPending && <Loader2 className="animate-spin" />} Save draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Test send ───────────────────────────────────────────────────────────────

function TestDialog({ campaign, onClose }: { campaign: Campaign; onClose: () => void }) {
  const { user } = useAuth();
  const [to, setTo] = useState(user?.email ?? '');
  const [error, setError] = useState<string | null>(null);
  const test = useMarketingMutation((address: string) => marketingService.test(campaign.id, address));

  async function submit() {
    setError(null);
    try {
      await test.mutateAsync(to.trim());
      toast.success(`Test sent to ${to.trim()}`);
      onClose();
    } catch (e) {
      setError(errorText(e, 'Could not send the test.'));
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !test.isPending && !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Send a test</DialogTitle>
          <DialogDescription>Exactly as contacts will get it, with the subject marked [Test].</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-2">
          <Label htmlFor="test-to">Send to</Label>
          <Input
            id="test-to"
            type="email"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
            }}
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" disabled={test.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={test.isPending || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim())} onClick={() => void submit()}>
            {test.isPending && <Loader2 className="animate-spin" />} Send test
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Card ────────────────────────────────────────────────────────────────────

function CampaignCard({
  campaign,
  canWrite,
  subscribed,
  onEdit,
  onTest,
  onSend,
  onDelete,
}: {
  campaign: Campaign;
  canWrite: boolean;
  subscribed: number;
  onEdit: () => void;
  onTest: () => void;
  onSend: () => void;
  onDelete: () => void;
}) {
  const stalled = isStalled(campaign);
  const done = campaign.sent + campaign.failed;
  const pct = campaign.audience > 0 ? Math.min(100, Math.round((done / campaign.audience) * 100)) : 0;
  const isDraft = campaign.status === 'draft';
  const canResume = stalled || campaign.status === 'failed';

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold">{campaign.subject || '(no subject)'}</p>
            <StatusBadge campaign={campaign} />
          </div>
          <p className="line-clamp-2 whitespace-pre-line text-xs text-muted-foreground">{campaign.body}</p>
          <p className="text-[11px] text-muted-foreground">
            {campaign.createdAt && `Created ${fmtDateShort(new Date(campaign.createdAt))}`}
            {campaign.finishedAt && ` · Finished ${fmtDateShort(new Date(campaign.finishedAt))}`}
          </p>
        </div>
        {canWrite && (
          <div className="flex shrink-0 flex-wrap gap-2">
            {isDraft && (
              <>
                <Button size="sm" variant="outline" onClick={onEdit}>
                  <Pencil /> Edit
                </Button>
                <Button size="sm" variant="outline" onClick={onTest}>
                  <Mail /> Test
                </Button>
                <Button size="sm" disabled={subscribed === 0} onClick={onSend}>
                  <Send /> Send to {subscribed}
                </Button>
                <Button size="sm" variant="ghost" aria-label="Delete draft" onClick={onDelete}>
                  <Trash2 />
                </Button>
              </>
            )}
            {!isDraft && (
              <Button size="sm" variant="outline" onClick={onTest}>
                <Mail /> Test
              </Button>
            )}
            {canResume && (
              <Button size="sm" onClick={onSend}>
                <RotateCcw /> Resume
              </Button>
            )}
          </div>
        )}
      </div>

      {!isDraft && (
        <div className="mt-3 space-y-1">
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-xs text-muted-foreground tabular-nums">
            {campaign.sent} sent · {campaign.failed} failed · {campaign.audience} recipients
          </p>
          {campaign.lastError && (
            <p className="text-xs text-red-600">Last error: {campaign.lastError}</p>
          )}
          {stalled && (
            <p className="text-xs text-amber-600">
              The send stopped (the server restarted). Resume continues where it left off — nobody is
              emailed twice.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export function MarketingCampaignsPage() {
  const canWrite = useCan('marketing:write');
  const summary = useMarketingSummary();
  const query = useCampaigns();
  const campaigns = query.data ?? [];
  const subscribed = summary.data?.contacts.subscribed ?? 0;

  const [editing, setEditing] = useState<Campaign | 'new' | null>(null);
  const [testing, setTesting] = useState<Campaign | null>(null);
  const [sending, setSending] = useState<Campaign | null>(null);
  const [deleting, setDeleting] = useState<Campaign | null>(null);
  const send = useMarketingMutation((id: string) => marketingService.send(id));
  const remove = useMarketingMutation((id: string) => marketingService.remove(id));

  return (
    <div className="scrollbar-thin h-full overflow-y-auto p-4">
      <div className="mx-auto max-w-4xl space-y-3">
        <PageBar title="Campaigns" status={summary.data ? `${subscribed} subscribed contacts` : undefined}>
          {canWrite && (
            <Button
              size="sm"
              onClick={() => {
                setEditing('new');
              }}
            >
              <Plus /> New campaign
            </Button>
          )}
        </PageBar>

        <MarketingSetupBanner missing={summary.data?.missingSetup ?? []} />

        {query.isLoading && <LoadingState label="Loading campaigns…" />}
        {query.isError && (
          <ErrorState
            error={query.error}
            onRetry={() => {
              void query.refetch();
            }}
          />
        )}
        {query.isSuccess && campaigns.length === 0 && (
          <EmptyState icon={<Send />} title="No campaigns yet" hint="Write one, send yourself a test, then send it." />
        )}
        {campaigns.map((c) => (
          <CampaignCard
            key={c.id}
            campaign={c}
            canWrite={canWrite}
            subscribed={subscribed}
            onEdit={() => {
              setEditing(c);
            }}
            onTest={() => {
              setTesting(c);
            }}
            onSend={() => {
              setSending(c);
            }}
            onDelete={() => {
              setDeleting(c);
            }}
          />
        ))}
      </div>

      {editing && (
        <EditorDialog
          campaign={editing === 'new' ? null : editing}
          onClose={() => {
            setEditing(null);
          }}
        />
      )}
      {testing && (
        <TestDialog
          campaign={testing}
          onClose={() => {
            setTesting(null);
          }}
        />
      )}
      <ConfirmDialog
        open={sending !== null}
        onOpenChange={(open) => {
          if (!open) setSending(null);
        }}
        title={sending?.status === 'draft' ? `Send to ${subscribed} contacts?` : 'Resume this send?'}
        description={
          <>
            <strong>{sending?.subject}</strong> goes to every subscribed contact. This cannot be undone or
            recalled. {sending?.status !== 'draft' && 'People already emailed are skipped.'}
          </>
        }
        confirmLabel={sending?.status === 'draft' ? 'Send now' : 'Resume'}
        onConfirm={async () => {
          if (!sending) return;
          try {
            await send.mutateAsync(sending.id);
            toast.success('Sending started');
          } catch (e) {
            toast.error(errorText(e, 'Could not start the send.'));
          }
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title="Delete this draft?"
        confirmLabel="Delete draft"
        destructive
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await remove.mutateAsync(deleting.id);
            toast.success('Draft deleted');
          } catch (e) {
            toast.error(errorText(e, 'Could not delete the draft.'));
          }
        }}
      />
    </div>
  );
}
