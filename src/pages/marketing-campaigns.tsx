import { useEffect, useMemo, useState } from 'react';
import { CalendarX, Clock, Copy, Loader2, Mail, Pencil, Plus, RotateCcw, Send, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ApiException } from '@/lib/api-client';
import { useAuth, useCan } from '@/auth/auth-context';
import { fmtDateShort } from '@/lib/format';
import { useCampaigns, useMarketingMutation, useMarketingSummary, useSubscribedContacts } from '@/hooks/use-marketing';
import { marketingService, type CampaignDraft } from '@/services/marketing-service';
import { isStalled, TRANSPORT_NAMES, type Campaign, type MarketingSummary } from '@/types/marketing';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
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
    case 'scheduled':
      return <Badge variant="secondary">Scheduled</Badge>;
    case 'paused':
      return <Badge variant="warning">Paused until tomorrow</Badge>;
    case 'sending':
      return <Badge>Sending…</Badge>;
    case 'sent':
      return <Badge variant="success">Sent</Badge>;
    case 'failed':
      return <Badge variant="destructive">Stopped</Badge>;
  }
}

// ── Editor ──────────────────────────────────────────────────────────────────

/// New campaigns send as Srinidhi, like the hand-written invites; editable per campaign.
const DEFAULT_SENDER = { fromName: 'Srinidhi RK', fromEmail: 'srinidhi@aarambh.app' };
const isHttpUrl = (v: string) => /^https?:\/\/\S+$/.test(v.trim());

function EditorDialog({ campaign, onClose }: { campaign: Campaign | null; onClose: () => void }) {
  const [subject, setSubject] = useState(campaign?.subject ?? '');
  const [body, setBody] = useState(campaign?.body ?? '');
  const [fromName, setFromName] = useState(campaign ? (campaign.fromName ?? '') : DEFAULT_SENDER.fromName);
  const [fromEmail, setFromEmail] = useState(campaign ? (campaign.fromEmail ?? '') : DEFAULT_SENDER.fromEmail);
  const [imageLink, setImageLink] = useState(campaign?.imageLink ?? '');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preview = useMemo(() => (imageFile ? URL.createObjectURL(imageFile) : null), [imageFile]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  const save = useMarketingMutation(async (draft: CampaignDraft) => {
    let saved = campaign ? await marketingService.update(campaign.id, draft) : await marketingService.create(draft);
    if (imageFile) saved = await marketingService.uploadImage(saved.id, imageFile);
    else if (removeImage && saved.imageUrl) saved = await marketingService.removeImage(saved.id);
    return saved;
  });

  const emailOk = fromEmail.trim() === '' || /^[^\s@]+@aarambh\.app$/i.test(fromEmail.trim());
  const linkOk = imageLink.trim() === '' || isHttpUrl(imageLink);
  const canSave = subject.trim() !== '' && body.trim() !== '' && emailOk && linkOk;
  const shownImage = preview ?? (removeImage ? null : (campaign?.imageUrl ?? null));

  async function submit() {
    setError(null);
    try {
      await save.mutateAsync({
        subject: subject.trim(),
        body: body.trim(),
        imageLink: imageLink.trim(),
        fromName: fromName.trim(),
        fromEmail: fromEmail.trim(),
      });
      toast.success('Draft saved');
      onClose();
    } catch (e) {
      setError(errorText(e, 'Could not save the draft.'));
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !save.isPending && !open && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{campaign ? 'Edit campaign' : 'New campaign'}</DialogTitle>
          <DialogDescription>
            Looks like an email typed in Gmail. An unsubscribe line is added at the bottom automatically.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="campaign-from-name">Sender name</Label>
              <Input
                id="campaign-from-name"
                value={fromName}
                maxLength={80}
                placeholder="Team Aarambh"
                onChange={(e) => {
                  setFromName(e.target.value);
                }}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="campaign-from-email">Sender email (replies go here)</Label>
              <Input
                id="campaign-from-email"
                type="email"
                value={fromEmail}
                placeholder="hello@aarambh.app"
                onChange={(e) => {
                  setFromEmail(e.target.value);
                }}
                aria-invalid={!emailOk}
              />
              {!emailOk && <p className="text-[11px] text-red-600">Must be an @aarambh.app address.</p>}
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="campaign-subject">Subject</Label>
            <Input
              id="campaign-subject"
              value={subject}
              maxLength={200}
              placeholder="You're invited: Move and Train with Aarambh | Oct 31, Hyderabad"
              onChange={(e) => {
                setSubject(e.target.value);
              }}
            />
          </div>

          <div className="space-y-2">
            <Label>Banner image (optional)</Label>
            {shownImage && <img src={shownImage} alt="" className="max-h-48 rounded border object-contain" />}
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="file"
                accept="image/jpeg,image/png,image/gif"
                className="max-w-xs"
                onChange={(e) => {
                  setImageFile(e.target.files?.[0] ?? null);
                  setRemoveImage(false);
                }}
              />
              {(shownImage ?? null) !== null && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setImageFile(null);
                    setRemoveImage(true);
                  }}
                >
                  <Trash2 /> Remove
                </Button>
              )}
            </div>
            <Input
              value={imageLink}
              placeholder="Link when the banner is clicked (optional), e.g. the booking page"
              onChange={(e) => {
                setImageLink(e.target.value);
              }}
              aria-invalid={!linkOk}
            />
            {!linkOk && <p className="text-[11px] text-red-600">Use a full link starting with https://</p>}
            <p className="text-[11px] text-muted-foreground">JPG, PNG or GIF up to 5 MB. About 1200–1600 px wide looks sharp.</p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="campaign-body">Message</Label>
            <Textarea
              id="campaign-body"
              value={body}
              rows={16}
              maxLength={20000}
              placeholder={'Hi {First Name},\n\n…\n\n**Team Aarambh**'}
              onChange={(e) => {
                setBody(e.target.value);
              }}
            />
            <p className="text-[11px] text-muted-foreground">
              <code>{'{First Name}'}</code> → their first name · <code>**bold**</code> → <strong>bold</strong> ·{' '}
              <code>[Maison de Build](https://maps…)</code> → a link · a blank line starts a new paragraph.
            </p>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" disabled={save.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={save.isPending || !canSave} onClick={() => void submit()}>
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
  const [name, setName] = useState(user?.displayName ?? '');
  const [error, setError] = useState<string | null>(null);
  const test = useMarketingMutation((address: string) => marketingService.test(campaign.id, address, name.trim()));

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
        <DialogBody className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="test-to">Email</Label>
            <Input
              id="test-to"
              type="email"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
              }}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="test-name">Name</Label>
            <Input
              id="test-name"
              value={name}
              placeholder="Fills {First Name} - leave empty to see “there”"
              onChange={(e) => {
                setName(e.target.value);
              }}
            />
          </div>
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

// ── Recipients ──────────────────────────────────────────────────────────────

/// Pick who gets the campaign: a searchable checklist of subscribed contacts.
/// "Select all" acts on what the search shows, so "search gmail → Select all"
/// picks exactly those.
function RecipientPicker({ selected, onChange }: { selected: Set<string>; onChange: (next: Set<string>) => void }) {
  const query = useSubscribedContacts(true);
  const [search, setSearch] = useState('');
  const all = query.data ?? [];
  const q = search.trim().toLowerCase();
  const shown = q === '' ? all : all.filter((c) => c.email.includes(q) || (c.name ?? '').toLowerCase().includes(q));
  const allShownSelected = shown.length > 0 && shown.every((c) => selected.has(c.id));

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  }
  function toggleShown() {
    const next = new Set(selected);
    for (const c of shown) {
      if (allShownSelected) next.delete(c.id);
      else next.add(c.id);
    }
    onChange(next);
  }

  if (query.isLoading) return <LoadingState label="Loading contacts…" />;
  if (query.isError) return <p className="text-xs text-red-600">{errorText(query.error, 'Could not load contacts.')}</p>;
  return (
    <div className="space-y-2">
      <Input
        placeholder="Search name or email"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
        }}
      />
      <div className="flex items-center justify-between text-xs">
        <label className="flex cursor-pointer items-center gap-2 font-medium">
          <Checkbox checked={allShownSelected} onCheckedChange={toggleShown} />
          {q ? `Select all ${shown.length} shown` : `Select all ${all.length}`}
        </label>
        <span className="text-muted-foreground">
          {selected.size} selected
          {selected.size > 0 && (
            <button type="button" className="ml-2 underline" onClick={() => { onChange(new Set()); }}>
              clear
            </button>
          )}
        </span>
      </div>
      <div className="scrollbar-thin max-h-56 overflow-y-auto rounded-md border">
        {shown.map((c) => (
          <label key={c.id} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted/60">
            <Checkbox
              checked={selected.has(c.id)}
              onCheckedChange={() => {
                toggle(c.id);
              }}
            />
            <span className="min-w-0 flex-1 truncate">{c.name ?? '—'}</span>
            <span className="truncate text-xs text-muted-foreground">{c.email}</span>
          </label>
        ))}
        {shown.length === 0 && <p className="p-3 text-sm text-muted-foreground">No match.</p>}
      </div>
    </div>
  );
}

// ── Send now or later ───────────────────────────────────────────────────────

/// `yyyy-MM-ddTHH:mm` in local time, for <input type="datetime-local">.
const toLocalInput = (d: Date): string => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const fmtWhen = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/** "Resend + Brevo": the services in the order they send. */
const serviceLine = (summary: MarketingSummary | undefined): string => {
  const list = summary?.transports.length ? summary.transports : summary?.transport ? [summary.transport] : [];
  return list.map((t) => TRANSPORT_NAMES[t]).join(' + ') || 'the mail service';
};

function SendDialog({
  campaign,
  subscribed,
  summary,
  onClose,
}: {
  campaign: Campaign;
  subscribed: number;
  summary: MarketingSummary | undefined;
  onClose: () => void;
}) {
  // What the mail services allow in a day together (Gmail ~2,000, Resend 100, Brevo 300).
  const dayCap = summary?.dailyCapacity || 100;
  const isDraft = campaign.status === 'draft';
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [who, setWho] = useState<'all' | 'chosen'>(campaign.audienceIds ? 'chosen' : 'all');
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(campaign.audienceIds ?? []));
  // A paused or failed send keeps the people it started with.
  const contactIds = !isDraft ? campaign.audienceIds : who === 'chosen' ? [...chosen] : null;
  const recipients = contactIds ? contactIds.length : subscribed;
  const [at, setAt] = useState(() => toLocalInput(new Date(Date.now() + 60 * 60_000)));
  // A list longer than a day's allowance wants the cap on.
  const [limitOn, setLimitOn] = useState(
    campaign.dailyLimit !== null || (campaign.audienceIds?.length ?? subscribed) > dayCap,
  );
  const [limit, setLimit] = useState(String(campaign.dailyLimit ?? dayCap));
  const [error, setError] = useState<string | null>(null);

  const dailyLimit = limitOn ? Number(limit) : null;
  const limitOk = !limitOn || (Number.isInteger(dailyLimit) && (dailyLimit ?? 0) >= 1);
  const atDate = new Date(at);
  const atOk = when === 'now' || (!Number.isNaN(atDate.getTime()) && atDate.getTime() > Date.now() + 60_000);
  const days = dailyLimit ? Math.ceil(recipients / dailyLimit) : 1;
  const whoOk = !isDraft || who === 'all' || chosen.size > 0;

  const go = useMarketingMutation(() =>
    when === 'later' && isDraft
      ? marketingService.schedule(campaign.id, atDate, dailyLimit, contactIds)
      : marketingService.send(campaign.id, dailyLimit, contactIds),
  );

  async function submit() {
    setError(null);
    try {
      await go.mutateAsync(undefined);
      toast.success(when === 'later' && isDraft ? `Scheduled for ${fmtWhen(atDate.toISOString())}` : 'Sending started');
      onClose();
    } catch (e) {
      setError(errorText(e, 'Could not start the send.'));
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !go.isPending && !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{isDraft ? `Send to ${recipients} contact${recipients === 1 ? '' : 's'}` : 'Continue this send'}</DialogTitle>
          <DialogDescription>
            <strong>{campaign.subject}</strong>{' '}
            {contactIds ? 'goes to the chosen contacts' : 'goes to every subscribed contact'} and cannot be recalled.
            {!isDraft && ' People already emailed are skipped.'}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4 text-sm">
          {isDraft && (
            <div className="space-y-2">
              <p className="font-medium">Recipients</p>
              <label className="flex items-center gap-2">
                <input type="radio" checked={who === 'all'} onChange={() => { setWho('all'); }} /> All subscribed
                contacts ({subscribed})
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" checked={who === 'chosen'} onChange={() => { setWho('chosen'); }} /> Choose
                contacts
              </label>
              {who === 'chosen' && <RecipientPicker selected={chosen} onChange={setChosen} />}
            </div>
          )}
          {isDraft && (
            <div className="space-y-2">
              <label className="flex items-center gap-2">
                <input type="radio" checked={when === 'now'} onChange={() => { setWhen('now'); }} /> Send now
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" checked={when === 'later'} onChange={() => { setWhen('later'); }} /> Schedule for
              </label>
              {when === 'later' && (
                <Input
                  type="datetime-local"
                  value={at}
                  min={toLocalInput(new Date())}
                  onChange={(e) => {
                    setAt(e.target.value);
                  }}
                  aria-invalid={!atOk}
                />
              )}
              {!atOk && <p className="text-[11px] text-red-600">Pick a time at least a minute from now.</p>}
            </div>
          )}
          <div className="space-y-2 rounded-lg border p-3">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={limitOn} onChange={(e) => { setLimitOn(e.target.checked); }} />
              Limit emails per day
            </label>
            {limitOn && (
              <div className="flex items-center gap-2">
                <Input
                  className="w-28"
                  inputMode="numeric"
                  value={limit}
                  onChange={(e) => {
                    setLimit(e.target.value.replace(/\D/g, ''));
                  }}
                  aria-invalid={!limitOk}
                />
                <span className="text-xs text-muted-foreground">
                  per 24 hours — {recipients} contacts take about {days} day{days === 1 ? '' : 's'}
                </span>
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">
              {serviceLine(summary)} sends about {dayCap.toLocaleString()} a day. With a
              limit, the send pauses and continues by itself the next day.
            </p>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" disabled={go.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={go.isPending || !limitOk || !atOk || !whoOk} onClick={() => void submit()}>
            {go.isPending && <Loader2 className="animate-spin" />}{' '}
            {when === 'later' && isDraft ? 'Schedule' : isDraft ? 'Send now' : 'Continue now'}
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
  onUnschedule,
  onDuplicate,
  duplicating,
  onDelete,
}: {
  campaign: Campaign;
  canWrite: boolean;
  subscribed: number;
  onEdit: () => void;
  onTest: () => void;
  onSend: () => void;
  onUnschedule: () => void;
  onDuplicate: () => void;
  duplicating: boolean;
  onDelete: () => void;
}) {
  const stalled = isStalled(campaign);
  const done = campaign.sent + campaign.failed;
  const pct = campaign.audience > 0 ? Math.min(100, Math.round((done / campaign.audience) * 100)) : 0;
  const isDraft = campaign.status === 'draft';
  const canResume = stalled || campaign.status === 'failed' || campaign.status === 'paused';
  const isScheduled = campaign.status === 'scheduled';

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold">{campaign.subject || '(no subject)'}</p>
            <StatusBadge campaign={campaign} />
          </div>
          <p className="text-[11px] text-muted-foreground">
            From {campaign.fromEmail ? `${campaign.fromName ?? ''} <${campaign.fromEmail}>` : 'hello@aarambh.app'}
          </p>
          {campaign.imageUrl && <img src={campaign.imageUrl} alt="" className="max-h-24 rounded border object-contain" />}
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
                  <Send /> Send…
                </Button>
                <Button size="sm" variant="ghost" aria-label="Delete draft" onClick={onDelete}>
                  <Trash2 />
                </Button>
              </>
            )}
            {isScheduled && (
              <>
                <Button size="sm" variant="outline" onClick={onTest}>
                  <Mail /> Test
                </Button>
                <Button size="sm" variant="outline" onClick={onUnschedule}>
                  <CalendarX /> Cancel schedule
                </Button>
              </>
            )}
            {!isDraft && !isScheduled && (
              <Button size="sm" variant="outline" onClick={onTest}>
                <Mail /> Test
              </Button>
            )}
            {canResume && (
              <Button size="sm" onClick={onSend}>
                <RotateCcw /> Resume
              </Button>
            )}
            <Button size="sm" variant="outline" disabled={duplicating} onClick={onDuplicate}>
              {duplicating ? <Loader2 className="animate-spin" /> : <Copy />} Duplicate
            </Button>
          </div>
        )}
      </div>

      {isScheduled && campaign.scheduledAt && (
        <p className="mt-3 text-xs">
          <Clock className="mr-1 inline size-3.5" />
          Sends {fmtWhen(campaign.scheduledAt)} to{' '}
          {campaign.audienceIds ? `${campaign.audienceIds.length} chosen contacts` : 'all subscribed contacts'}
          {campaign.dailyLimit ? `, ${campaign.dailyLimit} a day` : ''}. Cancel to edit it.
        </p>
      )}
      {!isDraft && !isScheduled && (
        <div className="mt-3 space-y-1">
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-xs text-muted-foreground tabular-nums">
            {campaign.sent} sent · {campaign.failed} failed · {campaign.audience}{' '}
            {campaign.audienceIds ? 'chosen recipients' : 'recipients'}
          </p>
          {campaign.lastError && (
            <p className="text-xs text-red-600">Last error: {campaign.lastError}</p>
          )}
          {campaign.status === 'paused' && campaign.resumeAt && (
            <p className="text-xs text-amber-600">
              Daily limit reached{campaign.dailyLimit ? ` (${campaign.dailyLimit} a day)` : ''}. Continues by itself{' '}
              {fmtWhen(campaign.resumeAt)} — or press Resume to continue now.
            </p>
          )}
          {stalled && (
            <p className="text-xs text-amber-600">
              The send stopped (the server restarted). It continues by itself within a minute, or press
              Resume — nobody is emailed twice.
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
  const unschedule = useMarketingMutation((id: string) => marketingService.unschedule(id));
  const remove = useMarketingMutation((id: string) => marketingService.remove(id));
  const duplicate = useMarketingMutation((id: string) => marketingService.duplicate(id));

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
        {summary.data?.transport && (
          <p className="text-xs text-muted-foreground">
            Sending through <strong>{serviceLine(summary.data)}</strong>
            {summary.data.sender ? ` as ${summary.data.sender}` : ''} — about{' '}
            {(summary.data.dailyCapacity || 100).toLocaleString()} emails a day.
            {summary.data.transports.length > 1 && ' Each service takes over when the one before reaches its daily limit.'}
          </p>
        )}

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
            onUnschedule={() => {
              void unschedule
                .mutateAsync(c.id)
                .then(() => toast.success('Schedule cancelled - back to draft'))
                .catch((e: unknown) => toast.error(errorText(e, 'Could not cancel the schedule.')));
            }}
            onDuplicate={() => {
              void duplicate
                .mutateAsync(c.id)
                .then((copy) => {
                  toast.success('Copied to a new draft');
                  setEditing(copy);
                })
                .catch((e: unknown) => toast.error(errorText(e, 'Could not duplicate the campaign.')));
            }}
            duplicating={duplicate.isPending && duplicate.variables === c.id}
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
      {sending && (
        <SendDialog
          campaign={sending}
          subscribed={subscribed}
          summary={summary.data}
          onClose={() => {
            setSending(null);
          }}
        />
      )}
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
