import { useState } from 'react';
import { AlertTriangle, Loader2, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { ApiException } from '@/lib/api-client';
import { useCan } from '@/auth/auth-context';
import { useNotificationRules, useUpdateNotificationRule } from '@/hooks/use-notifications';
import { CATEGORY_LABELS, type NotificationRule } from '@/types/notification';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ErrorState, LoadingState } from '@/components/common/states';

/**
 * Auto-on-publish rules.
 *
 * A rule is a standing instruction: while it is on, publishing that kind of
 * content broadcasts to everyone with nobody pressing send. That is the whole
 * point, and it is also why this screen is built the way it is —
 *
 *  - every rule ships OFF, and turning one on goes through a confirmation that
 *    says what will happen rather than asking "are you sure?";
 *  - the templates are editable here, with a live preview, because a rule's
 *    copy is written once and then fires unattended for months;
 *  - turning a rule OFF is immediate and unconfirmed. Stopping an automated
 *    broadcast should never be the harder of the two actions.
 */

/** What each rule reacts to, in the admin's words rather than the key's. */
const RULE_LABELS: Record<string, { title: string; when: string }> = {
  'recipe.published': { title: 'New recipe', when: 'when a recipe is published' },
  'article.published': { title: 'New article', when: 'when an article is published' },
  'program.published': { title: 'New program', when: 'when a program is published' },
  'exercise.published': { title: 'New exercise', when: 'when an exercise is published' },
};

/**
 * Rules whose content type has no publish action to fire them.
 *
 * Empty as of migration 007: programs and exercises gained `is_published` and a
 * publish route, so all four rules now work. Kept rather than deleted because
 * the next content type added will need it again, and a rule that silently
 * never fires is worse than one labelled as such.
 */
const NOT_YET_WIRED = new Set<string>();

const SAMPLE_TITLE = 'Paneer Bhurji';

function RuleCard({ rule, canWrite }: { rule: NotificationRule; canWrite: boolean }) {
  const [titleTemplate, setTitleTemplate] = useState(rule.titleTemplate);
  const [bodyTemplate, setBodyTemplate] = useState(rule.bodyTemplate);
  const [confirmOn, setConfirmOn] = useState(false);
  const mutation = useUpdateNotificationRule();

  const label = RULE_LABELS[rule.key] ?? { title: rule.key, when: '' };
  const unwired = NOT_YET_WIRED.has(rule.key);
  const dirty =
    titleTemplate !== rule.titleTemplate || bodyTemplate !== rule.bodyTemplate;

  const preview = (template: string) => template.replace(/\{\{title\}\}/g, SAMPLE_TITLE);

  async function save(patch: Record<string, unknown>, success: string) {
    try {
      await mutation.mutateAsync({ key: rule.key, body: patch });
      toast.success(success);
    } catch (e) {
      toast.error(e instanceof ApiException ? e.message : 'Could not save the rule.');
    }
  }

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-semibold">{label.title}</p>
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              {CATEGORY_LABELS[rule.category]}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Sends to everyone {label.when}.
          </p>
          {unwired && (
            <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
              <AlertTriangle className="size-3" />
              This content type has no publish action yet, so this rule cannot fire.
            </p>
          )}
        </div>

        {canWrite && (
          <label className="flex shrink-0 items-center gap-2 text-sm">
            <Switch
              checked={rule.enabled}
              disabled={unwired || mutation.isPending}
              onCheckedChange={(next) => {
                // Turning ON is confirmed; turning OFF is immediate.
                if (next) setConfirmOn(true);
                else void save({ enabled: false }, 'Rule turned off');
              }}
            />
            {rule.enabled ? 'On' : 'Off'}
          </label>
        )}
      </div>

      {canWrite && (
        <div className="mt-4 space-y-3 border-t pt-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Title template</Label>
              <Input
                value={titleTemplate}
                onChange={(e) => {
                  setTitleTemplate(e.target.value);
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Message template</Label>
              <Input
                value={bodyTemplate}
                onChange={(e) => {
                  setBodyTemplate(e.target.value);
                }}
              />
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground">
            <code>{'{{title}}'}</code> is replaced with the published item&rsquo;s title. An
            unknown placeholder is left as-is, so a typo shows up here rather than on every
            phone.
          </p>

          {/* The preview is the point of the placeholder note above: it is where
              a mistyped {{titel}} becomes visible. */}
          <div className="rounded-lg border bg-muted/40 p-3">
            <p className="text-sm font-semibold">{preview(titleTemplate) || 'Title'}</p>
            <p className="text-xs text-muted-foreground">
              {preview(bodyTemplate) || 'Message'}
            </p>
          </div>

          {dirty && (
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={mutation.isPending}
                onClick={() =>
                  void save({ titleTemplate, bodyTemplate }, 'Templates saved')
                }
              >
                {mutation.isPending && <Loader2 className="size-4 animate-spin" />}
                Save templates
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setTitleTemplate(rule.titleTemplate);
                  setBodyTemplate(rule.bodyTemplate);
                }}
              >
                Discard
              </Button>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmOn}
        onOpenChange={setConfirmOn}
        title={`Turn on "${label.title}"?`}
        description={
          <>
            From now on, every time {label.when.replace(/^when /, '')}, a notification will be
            sent to <strong>everyone</strong> automatically &mdash; without anyone pressing
            send. You can turn this off again at any time.
          </>
        }
        confirmLabel="Turn it on"
        destructive
        onConfirm={async () => {
          await save({ enabled: true }, 'Rule turned on');
        }}
      />
    </Card>
  );
}

export function NotificationRules() {
  const canWrite = useCan('notifications:write');
  const query = useNotificationRules();

  if (query.isLoading) return <LoadingState label="Loading rules…" />;
  if (query.isError) {
    return (
      <ErrorState
        error={query.error}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }

  const rules = query.data ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
        <Zap className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <p className="text-xs text-muted-foreground">
          A rule that is on sends to every user automatically, with no further approval.
          Everything ships off; turn one on only when its copy reads the way you want it to on
          a phone.
        </p>
      </div>

      {rules.map((rule) => (
        <RuleCard key={rule.key} rule={rule} canWrite={canWrite} />
      ))}
    </div>
  );
}
