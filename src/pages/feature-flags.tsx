import { useState } from 'react';
import { Info } from 'lucide-react';
import { toast } from 'sonner';
import { ApiException } from '@/lib/api-client';
import { useCan } from '@/auth/auth-context';
import { useFeatureFlags, useSetFeatureFlag } from '@/hooks/use-feature-flags';
import type { FeatureFlag } from '@/types/feature-flag';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { PageBar } from '@/components/common/page-header';
import { ErrorState, LoadingState } from '@/components/common/states';

/**
 * Remote on/off switches for features that ship dark.
 *
 * Same shape as the notification rules: turning a feature ON reaches every
 * user, so it is confirmed; turning it OFF is the kill switch, so it is
 * immediate. Stopping something should never be the harder of the two.
 */

function FlagCard({ flag, canWrite }: { flag: FeatureFlag; canWrite: boolean }) {
  const [confirmOn, setConfirmOn] = useState(false);
  const mutation = useSetFeatureFlag();

  async function save(enabled: boolean) {
    try {
      await mutation.mutateAsync({ key: flag.key, enabled });
      toast.success(`${flag.label} turned ${enabled ? 'on' : 'off'}`);
    } catch (e) {
      toast.error(e instanceof ApiException ? e.message : `Could not change ${flag.label}.`);
    }
  }

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">{flag.label}</p>
          {flag.description && (
            <p className="text-xs text-muted-foreground">{flag.description}</p>
          )}
          <code className="mt-1 inline-block text-[11px] text-muted-foreground">{flag.key}</code>
        </div>

        <label className="flex shrink-0 items-center gap-2 text-sm">
          <Switch
            checked={flag.enabled}
            disabled={!canWrite || mutation.isPending}
            onCheckedChange={(next) => {
              if (next) setConfirmOn(true);
              else void save(false);
            }}
          />
          {flag.enabled ? 'On' : 'Off'}
        </label>
      </div>

      <ConfirmDialog
        open={confirmOn}
        onOpenChange={setConfirmOn}
        title={`Turn on ${flag.label}?`}
        description={
          <>
            {flag.label} becomes available to <strong>every user</strong>. The server allows it
            within five minutes; apps show it the next time they refresh their settings, which
            can take a few hours. You can turn it off again at any time.
          </>
        }
        confirmLabel="Turn it on"
        onConfirm={async () => {
          await save(true);
        }}
      />
    </Card>
  );
}

export function FeatureFlagsPage() {
  const canWrite = useCan('features:write');
  const query = useFeatureFlags();
  const flags = query.data ?? [];

  return (
    <div className="scrollbar-thin h-full overflow-y-auto p-4">
      <div className="mx-auto max-w-3xl space-y-3">
        <PageBar
          title="Feature flags"
          status={query.data ? `${flags.filter((f) => f.enabled).length} of ${flags.length} on` : undefined}
        />

        <div className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3">
          <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">
            Every flag ships off. Turning one off stops its API routes within five minutes, even
            on app versions that have not refreshed yet.
            {!canWrite && ' You can view these flags but not change them.'}
          </p>
        </div>

        {query.isLoading && <LoadingState label="Loading flags…" />}
        {query.isError && (
          <ErrorState
            error={query.error}
            onRetry={() => {
              void query.refetch();
            }}
          />
        )}
        {flags.map((flag) => (
          <FlagCard key={flag.key} flag={flag} canWrite={canWrite} />
        ))}
      </div>
    </div>
  );
}
