import { useState } from 'react';
import { AlertCircle, ArrowLeftRight, HelpCircle, Loader2, Receipt, Search } from 'lucide-react';
import { toast } from 'sonner';
import { adminApi, ApiException, type Json } from '@/lib/api-client';
import { useCan } from '@/auth/auth-context';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { Button } from '@/components/ui/button';
import { PageBar } from '@/components/common/page-header';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/// "I paid on iOS and the app says I have nothing."
///
/// An Apple subscription belongs to an Apple ID, not to an app account, so the
/// backend claims it for the FIRST account that validates it. A user with two
/// sign-ins (two Google accounts, or Google one day and Apple Sign-In the next)
/// then hits "already linked to another account" — and because the app replays
/// StoreKit on every launch, they hit it on the home screen every time, with no
/// way out on their own.
///
/// This page answers where the entitlement actually landed, and moves it when
/// the user genuinely cannot get back into the account that holds it.

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 py-1.5">
      <span className="w-[110px] shrink-0 text-[12.5px] text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 select-text break-all text-[13px] font-medium">{value}</span>
    </div>
  );
}

function formatDate(iso: unknown): string {
  if (typeof iso !== 'string' || iso.length === 0) return '—';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return `${parsed.getDate()}/${parsed.getMonth() + 1}/${parsed.getFullYear()}`;
}

export function AppleLinksPage() {
  const [transactionId, setTransactionId] = useState('');
  const [toUid, setToUid] = useState('');
  const [reason, setReason] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /// Null before the first lookup; distinguishes "nothing searched yet" from
  /// "searched and found nothing", which mean very different things here.
  const [result, setResult] = useState<Json | null>(null);
  const [confirming, setConfirming] = useState(false);
  // Looking up who owns a subscription is `billing:read` - it is the answer to
  // "the user paid and has nothing". MOVING it drops the previous owner to
  // Free, so the whole transfer form needs `billing:write`.
  const canTransfer = useCan('billing:write');

  async function lookup() {
    const id = transactionId.trim();
    if (!id) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      setResult(await adminApi.appleLink(id));
    } catch (e) {
      setError(e instanceof ApiException ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function transfer() {
    const destination = toUid.trim();
    if (!destination) return;
    setLoading(true);
    setError(null);
    try {
      await adminApi.transferAppleLink({
        originalTransactionId: transactionId.trim(),
        toUid: destination,
        reason: reason.trim(),
      });
      setToUid('');
      setReason('');
      toast.success('Subscription moved.');
      await lookup(); // re-read so the page shows the new owner, not the old
    } catch (e) {
      setError(e instanceof ApiException ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const linked = result?.linked === true;
  const owner = (result?.owner ?? {}) as Record<string, unknown>;

  return (
    <div className="scrollbar-thin h-full overflow-y-auto p-4">
      <div className="mx-auto max-w-3xl">
        <PageBar
          title="Apple links"
          status="One Apple subscription entitles exactly one app account"
          statusTitle="An Apple subscription belongs to an Apple ID and entitles exactly one app account — the first one to validate it. When a user signs in with a different account they see 'already active on another account' on every launch."
        />

        {/* The full explanation stays on the page rather than only in the bar's
            tooltip: this pane is used rarely, and the rule it exists to fix is
            not one an admin should have to already know. */}
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          An Apple subscription belongs to an Apple ID and entitles exactly one app account — the
          first one to validate it. When a user signs in with a different account they see
          &quot;already active on another account&quot; on every launch. Look up where their purchase
          landed.
        </p>

        <Card className="mt-3 p-4">
          <Label htmlFor="tx">Apple original transaction ID</Label>
          <div className="relative mt-1.5">
            <Receipt className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="tx"
              value={transactionId}
              placeholder="e.g. 330003071223467"
              className="pl-9"
              onChange={(e) => setTransactionId(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !loading) void lookup();
              }}
            />
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            From the server log line &quot;Apple transaction already linked&quot;, or the user&apos;s
            App Store receipt.
          </p>
          <div className="mt-3.5 flex justify-end">
            <Button disabled={loading || !transactionId.trim()} onClick={() => void lookup()}>
              {loading ? <Loader2 className="animate-spin" /> : <Search />} Look up
            </Button>
          </div>
        </Card>

        {error && (
          <div className="mt-4 flex items-center gap-2.5 rounded-[10px] border border-red-200 bg-red-50 p-3.5 dark:border-red-900 dark:bg-red-950/40">
            <AlertCircle className="size-5 shrink-0 text-red-700 dark:text-red-400" />
            <p className="text-[13px] text-red-900 dark:text-red-300">{error}</p>
          </div>
        )}

        {result != null &&
          (!linked ? (
            /* Not an error, and the most important thing this page can tell you:
               the user paid and NO account was ever entitled. */
            <Card className="mt-4 p-5">
              <div className="flex items-center gap-2">
                <HelpCircle className="size-5 text-orange-600" />
                <p className="text-[15px] font-bold">No account holds this subscription</p>
              </div>
              <p className="mt-2.5 text-[13px] leading-relaxed text-slate-800 dark:text-slate-300">
                Nobody ever claimed it, which means the user&apos;s first validation failed — they
                were charged and entitled nothing. Ask them to open the app and tap Restore
                Purchases; the error they see names the cause. If that succeeds, this page will show
                them as the owner.
              </p>
            </Card>
          ) : (
            <Card className="mt-4 p-5">
              <p className="text-[15px] font-bold">Held by</p>
              <div className="mt-3">
                <Row label="Email" value={String(owner.email ?? '—')} />
                <Row label="uid" value={String(owner.uid ?? '—')} />
                <Row label="Tier" value={String(owner.subscriptionTier ?? '—')} />
                <Row label="Plan" value={String(owner.subscriptionPlan ?? '—')} />
                <Row label="Status" value={String(owner.subscriptionStatus ?? '—')} />
                <Row label="Access until" value={formatDate(owner.subscriptionEndDate)} />
              </div>

              <div className="mt-4 rounded-lg bg-blue-50 p-3 dark:bg-blue-950/30">
                <p className="text-[12.5px] leading-relaxed text-blue-900 dark:text-blue-300">
                  Ask the user to sign in with this account first — their workout history lives there
                  too. Only move the subscription if they truly cannot get back into it.
                </p>
              </div>

              {canTransfer && (
              <>
              <div className="my-8 h-px bg-border" />

              <p className="text-[15px] font-bold">Move it to another account</p>
              <div className="mt-3 flex flex-col gap-3">
                <div>
                  <Label htmlFor="to-uid">Destination uid</Label>
                  <Input
                    id="to-uid"
                    value={toUid}
                    className="mt-1.5"
                    onChange={(e) => setToUid(e.target.value)}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    The account that should own it instead.
                  </p>
                </div>
                <div>
                  <Label htmlFor="reason">Reason (optional)</Label>
                  <Input
                    id="reason"
                    value={reason}
                    className="mt-1.5"
                    onChange={(e) => setReason(e.target.value)}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">Recorded in audit_logs.</p>
                </div>
              </div>

              <div className="mt-3.5 flex justify-end">
                <Button
                  variant="outline"
                  className="border-red-200 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400"
                  disabled={loading || !toUid.trim()}
                  onClick={() => setConfirming(true)}
                >
                  <ArrowLeftRight /> Move subscription
                </Button>
              </div>
              </>
              )}
            </Card>
          ))}
      </div>

      {confirming && (
        <ConfirmDialog
          open
          onOpenChange={setConfirming}
          title="Move this subscription?"
          confirmLabel="Move it"
          destructive
          onConfirm={transfer}
        >
          <p className="text-sm">From&nbsp;&nbsp;{String(owner.email ?? owner.uid ?? '—')}</p>
          <p className="mt-1 text-sm">To&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{toUid.trim()}</p>
          <p className="mt-3.5 text-[12.5px] leading-relaxed text-muted-foreground">
            One Apple subscription entitles one account, so this is a move, not a copy — the account
            it comes from drops to Free immediately.
            <br />
            <br />
            If the user can still sign into the account that holds it, ask them to do that instead.
            Nothing here is reversible except by running the transfer again in the other direction.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
