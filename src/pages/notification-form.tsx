import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ImagePlus, Loader2, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import { ApiException } from '@/lib/api-client';
import { toDateTimeInput } from '@/lib/format';
import { useAudiencePreview } from '@/hooks/use-notifications';
import {
  createNotification,
  updateNotification,
  type ComposeInput,
} from '@/services/notifications-service';
import {
  CATEGORY_LABELS,
  COMPOSABLE_CATEGORIES,
  type NotificationAudience,
  type NotificationModel,
} from '@/types/notification';
import { Button } from '@/components/ui/button';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

/**
 * Composing a push campaign.
 *
 * Two things here are load-bearing rather than decorative, and neither should
 * be removed to tidy the layout:
 *
 *  - the LIVE AUDIENCE COUNT beside the audience picker. It is the only place
 *    an admin finds out that "premium on iOS" is four people, or that a stray
 *    filter left it at everyone, BEFORE the send;
 *  - the PHONE PREVIEW. Title and body are truncated hard by both platforms,
 *    and the preview is where that becomes visible instead of being discovered
 *    on a device after the fact.
 *
 * Saving never sends. The dialog produces a draft, or a scheduled campaign if a
 * time is set; delivery is a separate, confirmed action on the list page.
 */

/// Local field wrapper. The codebase has no form library and no shared
/// FormField — `voucher-form.tsx` defines the same helper for the same reason.
function Field({
  label,
  helper,
  error,
  children,
}: {
  label: string;
  helper?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium">{label}</Label>
      {children}
      {error ? (
        <p className="text-[11px] text-destructive">{error}</p>
      ) : helper ? (
        <p className="text-[11px] text-muted-foreground">{helper}</p>
      ) : null}
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </h3>
  );
}

/// Matches the server's limits, which are the platforms' display limits rather
/// than ours — copy longer than this is stored but never seen.
const TITLE_MAX = 120;
const BODY_MAX = 500;

type AudienceKind = 'all' | 'segment' | 'users';

export function NotificationFormDialog({
  open,
  onOpenChange,
  existing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /// Null to compose a new campaign; a campaign to edit one that has not gone
  /// out. The list page only offers edit for draft and scheduled rows.
  existing: NotificationModel | null;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState<string>('announcement');

  const [audienceKind, setAudienceKind] = useState<AudienceKind>('all');
  const [tier, setTier] = useState<string>('any');
  const [platform, setPlatform] = useState<string>('any');
  const [program, setProgram] = useState('');
  const [uids, setUids] = useState('');

  const [deeplinkType, setDeeplinkType] = useState<string>('none');
  const [deeplinkTarget, setDeeplinkTarget] = useState('');

  const [scheduleOn, setScheduleOn] = useState(false);
  const [scheduledAt, setScheduledAt] = useState('');

  const [imageFile, setImageFile] = useState<Blob | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  // Reset from `existing` every time the dialog opens, so reopening after a
  // cancel never shows the previous campaign's copy.
  useEffect(() => {
    if (!open) return;
    setErrors({});
    setImageFile(null);
    setImagePreview(existing?.imageUrl ?? null);

    setTitle(existing?.title ?? '');
    setBody(existing?.body ?? '');
    setCategory(existing?.category ?? 'announcement');

    const a = existing?.audience ?? { kind: 'all' as const };
    setAudienceKind(a.kind);
    setTier(a.kind === 'segment' ? (a.tier ?? 'any') : 'any');
    setPlatform(a.kind === 'segment' ? (a.platform ?? 'any') : 'any');
    setProgram(a.kind === 'segment' ? (a.program ?? '') : '');
    setUids(a.kind === 'users' ? a.uids.join('\n') : '');

    setDeeplinkType(existing?.deeplink?.type ?? 'none');
    setDeeplinkTarget(existing?.deeplink?.targetId ?? '');

    setScheduleOn(existing?.scheduledAt != null);
    setScheduledAt(existing?.scheduledAt ? toDateTimeInput(existing.scheduledAt) : '');
  }, [open, existing]);

  const parsedUids = useMemo(
    () =>
      uids
        .split(/[\s,]+/)
        .map((u) => u.trim())
        .filter(Boolean),
    [uids],
  );

  const audience: NotificationAudience = useMemo(() => {
    if (audienceKind === 'all') return { kind: 'all' };
    if (audienceKind === 'users') return { kind: 'users', uids: parsedUids };
    return {
      kind: 'segment',
      ...(tier !== 'any' ? { tier: tier as 'premium' | 'basic' | 'free' } : {}),
      ...(platform !== 'any' ? { platform: platform as 'ios' | 'android' } : {}),
      ...(program.trim() ? { program: program.trim() } : {}),
    };
  }, [audienceKind, tier, platform, program, parsedUids]);

  // Only ask the server to count once the predicate is answerable — an empty
  // uid list matches nobody and is not worth a round trip.
  const canCount = audienceKind !== 'users' || parsedUids.length > 0;
  const preview = useAudiencePreview(open && canCount ? audience : null);

  function validate(): Record<string, string> {
    const next: Record<string, string> = {};
    if (!title.trim()) next.title = 'A title is required.';
    if (title.length > TITLE_MAX) next.title = `At most ${String(TITLE_MAX)} characters.`;
    if (!body.trim()) next.body = 'A message is required.';
    if (body.length > BODY_MAX) next.body = `At most ${String(BODY_MAX)} characters.`;

    if (audienceKind === 'users' && parsedUids.length === 0) {
      next.audience = 'Add at least one user id.';
    }
    if (audienceKind === 'users' && parsedUids.length > 200) {
      next.audience = 'At most 200 user ids. For a larger group, use a segment.';
    }
    if (deeplinkType !== 'none' && !deeplinkTarget.trim()) {
      next.deeplink = 'A target id is required when a destination is set.';
    }
    if (scheduleOn) {
      if (!scheduledAt) {
        next.scheduledAt = 'Pick a date and time.';
      } else if (new Date(scheduledAt).getTime() <= Date.now()) {
        // Refused rather than sent immediately — a mistyped date should say so.
        next.scheduledAt = 'The scheduled time must be in the future.';
      }
    }
    return next;
  }

  function pickImage(file: File | undefined) {
    if (!file) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  }

  async function save() {
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    const input: ComposeInput = {
      title,
      body,
      category,
      audience,
      deeplink:
        deeplinkType === 'none'
          ? null
          : {
              type: deeplinkType as 'recipe' | 'program' | 'article' | 'exercise',
              targetId: deeplinkTarget.trim(),
            },
      scheduledAt: scheduleOn && scheduledAt ? new Date(scheduledAt).toISOString() : null,
      imageFile,
    };

    setBusy(true);
    try {
      if (existing) {
        await updateNotification(existing.id, input);
        toast.success('Notification updated');
      } else {
        await createNotification(input);
        toast.success(
          input.scheduledAt ? 'Scheduled — it will go out at that time' : 'Saved as a draft',
        );
      }
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof ApiException ? e.message : 'Could not save the notification.');
    } finally {
      setBusy(false);
    }
  }

  const countLabel = preview.isLoading
    ? 'Counting…'
    : preview.isError
      ? 'Could not count this audience'
      : preview.data
        ? `${String(preview.data.count)} ${preview.data.count === 1 ? 'person' : 'people'}`
        : '—';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{existing ? 'Edit notification' : 'New notification'}</DialogTitle>
          <DialogDescription>
            Saving does not send. You can test it on your own phone, then send from the list.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-5">
          <div className="grid gap-5 md:grid-cols-[1fr_260px]">
            <div className="space-y-4">
              <SectionTitle>Message</SectionTitle>

              <Field
                label="Title"
                error={errors.title}
                helper={`${String(title.length)}/${String(TITLE_MAX)} — phones show roughly the first 65`}
              >
                <Input
                  value={title}
                  maxLength={TITLE_MAX}
                  onChange={(e) => {
                    setTitle(e.target.value);
                  }}
                  placeholder="New recipe just landed"
                />
              </Field>

              <Field
                label="Message"
                error={errors.body}
                helper={`${String(body.length)}/${String(BODY_MAX)} — phones show roughly the first 240`}
              >
                <Textarea
                  rows={4}
                  value={body}
                  maxLength={BODY_MAX}
                  onChange={(e) => {
                    setBody(e.target.value);
                  }}
                  placeholder="Paneer bhurji, 22 g protein, ready in 15 minutes."
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Category" helper="Users can mute categories individually.">
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {COMPOSABLE_CATEGORIES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {CATEGORY_LABELS[c]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                <Field label="Image" helper="Optional. JPEG, PNG or WebP, up to 2 MB.">
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".jpg,.jpeg,.png,.webp"
                    className="hidden"
                    onChange={(e) => {
                      pickImage(e.target.files?.[0]);
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-start"
                    onClick={() => fileRef.current?.click()}
                  >
                    <ImagePlus className="size-4" />
                    {imageFile ? 'Replace image' : imagePreview ? 'Replace image' : 'Add image'}
                  </Button>
                </Field>
              </div>

              <SectionTitle>Where it opens</SectionTitle>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Destination">
                  <Select value={deeplinkType} onValueChange={setDeeplinkType}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Just open the app</SelectItem>
                      <SelectItem value="recipe">A recipe</SelectItem>
                      <SelectItem value="program">A program</SelectItem>
                      <SelectItem value="article">An article</SelectItem>
                      <SelectItem value="exercise">An exercise</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                {deeplinkType !== 'none' && (
                  <Field
                    label="Target id"
                    error={errors.deeplink}
                    helper="The id of the item to open."
                  >
                    <Input
                      value={deeplinkTarget}
                      onChange={(e) => {
                        setDeeplinkTarget(e.target.value);
                      }}
                      placeholder="e.g. P01"
                    />
                  </Field>
                )}
              </div>
            </div>

            {/* The preview. Deliberately alongside the copy fields rather than
                on a second tab — truncation is the thing it exists to show, and
                a preview you have to click to reach is a preview nobody sees. */}
            <div className="space-y-2">
              <SectionTitle>Preview</SectionTitle>
              <div className="rounded-xl border bg-muted/40 p-3">
                <div className="rounded-lg bg-background p-3 shadow-sm">
                  <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Aarambh · now
                  </p>
                  <p className="line-clamp-1 text-sm font-semibold">
                    {title.trim() || 'Notification title'}
                  </p>
                  <p className="line-clamp-3 text-xs text-muted-foreground">
                    {body.trim() || 'Your message will appear here.'}
                  </p>
                  {imagePreview && (
                    <img
                      src={imagePreview}
                      alt=""
                      className="mt-2 max-h-28 w-full rounded-md object-cover"
                    />
                  )}
                </div>
              </div>
            </div>
          </div>

          <SectionTitle>Who receives it</SectionTitle>

          <div className="rounded-lg border p-3">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Audience">
                <Select
                  value={audienceKind}
                  onValueChange={(v) => {
                    setAudienceKind(v as AudienceKind);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Everyone</SelectItem>
                    <SelectItem value="segment">A segment</SelectItem>
                    <SelectItem value="users">Specific users</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              {audienceKind === 'segment' && (
                <>
                  <Field label="Plan">
                    <Select value={tier} onValueChange={setTier}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="any">Any plan</SelectItem>
                        <SelectItem value="premium">Premium</SelectItem>
                        <SelectItem value="basic">Basic</SelectItem>
                        <SelectItem value="free">Free</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Platform">
                    <Select value={platform} onValueChange={setPlatform}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="any">Any device</SelectItem>
                        <SelectItem value="ios">iOS</SelectItem>
                        <SelectItem value="android">Android</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="On program" helper="Optional program id, e.g. P01.">
                    <Input
                      value={program}
                      onChange={(e) => {
                        setProgram(e.target.value);
                      }}
                      placeholder="Any program"
                    />
                  </Field>
                </>
              )}
            </div>

            {audienceKind === 'users' && (
              <div className="mt-4">
                <Field
                  label="User ids"
                  error={errors.audience}
                  helper="One per line, or comma separated. Up to 200."
                >
                  <Textarea
                    rows={3}
                    value={uids}
                    onChange={(e) => {
                      setUids(e.target.value);
                    }}
                    placeholder="uid-1&#10;uid-2"
                  />
                </Field>
              </div>
            )}

            {/* The count. Read from the server by the same predicate builder the
                send uses, so it cannot disagree with what actually goes out. */}
            <div
              className={cn(
                'mt-3 flex items-center gap-2 rounded-md px-3 py-2 text-sm',
                audienceKind === 'all'
                  ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                  : 'bg-muted',
              )}
            >
              {preview.isLoading ? (
                <Loader2 className="size-4 shrink-0 animate-spin" />
              ) : (
                <Users className="size-4 shrink-0" />
              )}
              <span className="font-medium">{countLabel}</span>
              {errors.audience == null && preview.data && preview.data.count > 0 && (
                <span className="truncate text-xs text-muted-foreground">
                  e.g. {preview.data.sample.map((s) => s.username ?? s.email ?? s.uid).join(', ')}
                </span>
              )}
            </div>
          </div>

          <SectionTitle>When</SectionTitle>
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex items-center gap-2 pb-2 text-sm">
              <Switch checked={scheduleOn} onCheckedChange={setScheduleOn} />
              Schedule for later
            </label>
            {scheduleOn && (
              <div className="min-w-56 flex-1">
                <Field label="Send at" error={errors.scheduledAt}>
                  <Input
                    type="datetime-local"
                    value={scheduledAt}
                    onChange={(e) => {
                      setScheduledAt(e.target.value);
                    }}
                  />
                </Field>
              </div>
            )}
            {!scheduleOn && (
              <p className="pb-2 text-[11px] text-muted-foreground">
                Saved as a draft. Nothing is sent until you press Send on the list.
              </p>
            )}
          </div>
        </DialogBody>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => {
              onOpenChange(false);
            }}
            disabled={busy}
          >
            <X className="size-4" />
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            {existing ? 'Save changes' : scheduleOn ? 'Schedule' : 'Save draft'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
