import { useMemo, useState } from 'react';
import {
  Check,
  Loader2,
  Minus,
  Plus,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  UserPlus,
} from 'lucide-react';
import { toast } from 'sonner';
import { ApiException } from '@/lib/api-client';
import { fmtDayMonthYear } from '@/lib/format';
import { useAuth, usePermissions } from '@/auth/auth-context';
import {
  PERMISSION_GROUPS,
  permissionsOfGrant,
  ROLES,
  roleLabel,
  type Permission,
  type RoleKey,
} from '@/auth/permissions';
import { useIamLookup, useIamMembers, useRevokeIamMember, useSetIamMember } from '@/hooks/use-iam';
import { isActiveMember, type IamMember } from '@/types/iam';
import { HeaderSlot } from '@/app/header-slot';
import { PageBar } from '@/components/common/page-header';
import { SearchInput } from '@/components/common/search-input';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableWrap } from '@/components/ui/table';
import { cn } from '@/lib/utils';

/// Access & Roles — who may use this panel, and for what.
///
/// The screen is the front end of the `adm` custom claim. Nothing here is the
/// authorization itself: saving writes a claim server-side, and every route in
/// the panel is re-checked by the API on each call. What this screen owns is
/// making the grant legible — a permission model you cannot see is one nobody
/// audits.
///
/// Reading it needs `iam:read` (Admin and Super Admin); every control that
/// changes something needs `iam:write`, which only Super Admin holds. An Admin
/// therefore gets the roster as a read-only report, which is the intent.

export function IamPage() {
  const { user } = useAuth();
  const { isSuperAdmin } = usePermissions();
  const { data: members, isLoading, error, refetch, isFetching } = useIamMembers();

  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<IamMember | null>(null);
  const [adding, setAdding] = useState(false);
  const [revoking, setRevoking] = useState<IamMember | null>(null);

  const revoke = useRevokeIamMember();

  const rows = useMemo(() => {
    const all = members ?? [];
    const needle = search.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((m) =>
      [m.email, m.displayName, m.uid, ...m.roles].some((v) =>
        (v ?? '').toLowerCase().includes(needle),
      ),
    );
  }, [members, search]);

  const activeCount = (members ?? []).filter(isActiveMember).length;

  async function confirmRevoke() {
    if (!revoking) return;
    try {
      await revoke.mutateAsync({ uid: revoking.uid });
      toast.success(`Revoked access for ${revoking.email ?? revoking.uid}`);
      setRevoking(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not revoke access');
    }
  }

  return (
    <div className="p-6">
      <HeaderSlot>
        <PageBar
          title="Access & Roles"
          status={
            members
              ? `${activeCount} with access${members.length > activeCount ? ` · ${members.length - activeCount} revoked` : ''}`
              : undefined
          }
        >
          <SearchInput value={search} onChange={setSearch} placeholder="Search people…" />
          <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw className={cn(isFetching && 'animate-spin')} /> Refresh
          </Button>
          {isSuperAdmin && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <UserPlus /> Add person
            </Button>
          )}
        </PageBar>
      </HeaderSlot>

      {!isSuperAdmin && (
        <Card className="mb-4 flex items-start gap-3 p-4">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p className="text-[13px] text-muted-foreground">
            You can see who has access but not change it. Granting and revoking needs the{' '}
            <span className="font-semibold">Super Admin</span> role.
          </p>
        </Card>
      )}

      {isLoading ? (
        <LoadingState label="Loading the roster…" />
      ) : error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck className="size-8" />}
          title={search ? 'Nobody matches that search' : 'Nobody has been given access yet'}
          hint={
            search
              ? undefined
              : 'Run the grant-admin-role bootstrap script, or add someone with the button above.'
          }
        />
      ) : (
        <TableWrap>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Person</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead>Permissions</TableHead>
                <TableHead>Last changed</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((member) => (
                <MemberRow
                  key={member.uid}
                  member={member}
                  isSelf={member.uid === user?.uid}
                  canEdit={isSuperAdmin}
                  onEdit={() => setEditing(member)}
                  onRevoke={() => setRevoking(member)}
                />
              ))}
            </TableBody>
          </Table>
        </TableWrap>
      )}

      {adding && <AddMemberDialog onClose={() => setAdding(false)} />}
      {editing && (
        <GrantDialog member={editing} onClose={() => setEditing(null)} />
      )}

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title="Revoke admin access?"
        description={
          <>
            <span className="font-semibold">{revoking?.email ?? revoking?.uid}</span> will be signed
            out and lose access to every section immediately. Their record is kept so the history
            stays auditable, and you can grant access again later.
          </>
        }
        confirmLabel="Revoke access"
        destructive
        onConfirm={confirmRevoke}
      />
    </div>
  );
}

function MemberRow({
  member,
  isSelf,
  canEdit,
  onEdit,
  onRevoke,
}: {
  member: IamMember;
  isSelf: boolean;
  canEdit: boolean;
  onEdit: () => void;
  onRevoke: () => void;
}) {
  const active = isActiveMember(member);
  return (
    <TableRow className={cn(!active && 'opacity-60')}>
      <TableCell>
        <div className="flex flex-col">
          <span className="font-semibold">
            {member.email ?? member.uid}
            {isSelf && <span className="ml-2 text-[11px] font-medium text-muted-foreground">(you)</span>}
          </span>
          {member.displayName && (
            <span className="text-[11.5px] text-muted-foreground">{member.displayName}</span>
          )}
          {member.note && (
            <span className="mt-0.5 text-[11.5px] italic text-muted-foreground">{member.note}</span>
          )}
        </div>
      </TableCell>
      <TableCell>
        {!active ? (
          <Badge variant="destructive">
            <ShieldOff className="size-3" /> Revoked
          </Badge>
        ) : member.roles.length === 0 ? (
          <Badge variant="outline">Custom</Badge>
        ) : (
          <div className="flex flex-wrap gap-1">
            {member.roles.map((role) => (
              <Badge key={role} variant={role === 'super_admin' ? 'default' : 'secondary'}>
                {role === 'super_admin' && <ShieldCheck className="size-3" />}
                {roleLabel(role)}
              </Badge>
            ))}
          </div>
        )}
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[12.5px] text-muted-foreground">
            {member.permissions.length} permission{member.permissions.length === 1 ? '' : 's'}
          </span>
          {member.grants.length > 0 && (
            <Badge variant="success" title={member.grants.join(', ')}>
              <Plus className="size-3" />
              {member.grants.length} extra
            </Badge>
          )}
          {member.denies.length > 0 && (
            <Badge variant="warning" title={member.denies.join(', ')}>
              <Minus className="size-3" />
              {member.denies.length} removed
            </Badge>
          )}
        </div>
      </TableCell>
      <TableCell className="text-[12.5px] text-muted-foreground">
        {member.updatedAt ? fmtDayMonthYear(member.updatedAt) : '—'}
        {member.updatedByEmail && (
          <div className="text-[11px]">by {member.updatedByEmail}</div>
        )}
      </TableCell>
      <TableCell className="text-right">
        {canEdit && !isSelf ? (
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onEdit}>
              {active ? 'Edit' : 'Restore'}
            </Button>
            {active && (
              <Button variant="outline" size="sm" onClick={onRevoke}>
                Revoke
              </Button>
            )}
          </div>
        ) : (
          // Self-editing is refused by the API too (409 self_modification) - a
          // Super Admin who dropped their own iam:write would lock everyone out.
          <span className="text-[11.5px] text-muted-foreground">
            {isSelf ? 'Ask another Super Admin' : '—'}
          </span>
        )}
      </TableCell>
    </TableRow>
  );
}

/// Step one of granting: find the account. Doing the lookup before the grant
/// editor opens means a typo fails here, with "no account with that email",
/// rather than silently writing a grant nobody holds.
function AddMemberDialog({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [found, setFound] = useState<IamMember | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const lookup = useIamLookup();

  async function run() {
    const trimmed = email.trim();
    if (!trimmed) return;
    try {
      const result = await lookup.mutateAsync(trimmed);
      setUid(result.uid);
      setFound(
        result.member ?? {
          uid: result.uid,
          email: result.email,
          displayName: result.displayName,
          roles: [],
          grants: [],
          denies: [],
          permissions: [],
          note: null,
          updatedAt: null,
          updatedBy: null,
          updatedByEmail: null,
          revokedAt: null,
        },
      );
      if (!result.emailVerified) {
        toast.warning('That account has not verified its email, so a grant would not take effect.');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Lookup failed');
    }
  }

  if (found && uid) {
    return <GrantDialog member={found} onClose={onClose} />;
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add someone to the admin panel</DialogTitle>
          <DialogDescription>
            They need an existing Aarambh account. Enter the email they sign in with.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Label htmlFor="iam-email">Email address</Label>
          <Input
            id="iam-email"
            type="email"
            autoFocus
            value={email}
            placeholder="person@example.com"
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void run()}
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void run()} disabled={!email.trim() || lookup.isPending}>
            {lookup.isPending ? <Loader2 className="animate-spin" /> : <Check />}
            Find account
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/// Step two: the grant itself.
///
/// Roles are the primary control and the permission grid sits underneath,
/// showing what those roles already imply. Ticking a box the role does not cover
/// adds a grant; unticking one the role DOES cover adds a deny. That is the
/// whole override model, and rendering it as one grid rather than three lists is
/// what makes "content editor, but not recipes" a single obvious click.
function GrantDialog({ member, onClose }: { member: IamMember; onClose: () => void }) {
  const [roles, setRoles] = useState<RoleKey[]>(member.roles);
  const [grants, setGrants] = useState<Permission[]>(member.grants);
  const [denies, setDenies] = useState<Permission[]>(member.denies);
  const [note, setNote] = useState(member.note ?? '');
  const save = useSetIamMember();

  // What the roles alone confer, and what the whole grant confers. The
  // difference is what the checkboxes have to communicate.
  const fromRoles = useMemo(() => permissionsOfGrant({ r: roles, g: [], d: [] }), [roles]);
  const effective = useMemo(
    () => permissionsOfGrant({ r: roles, g: grants, d: denies }),
    [roles, grants, denies],
  );

  function toggleRole(role: RoleKey) {
    setRoles((current) =>
      current.includes(role) ? current.filter((r) => r !== role) : [...current, role],
    );
  }

  /// One checkbox. Turning a permission on that the roles do not give is a
  /// grant; turning one off that they do give is a deny. Both lists are kept
  /// clean of entries that no longer say anything.
  function togglePermission(permission: Permission, next: boolean) {
    const inherited = fromRoles.has(permission);
    setGrants((current) =>
      next && !inherited
        ? [...new Set([...current, permission])]
        : current.filter((p) => p !== permission),
    );
    setDenies((current) =>
      !next && inherited
        ? [...new Set([...current, permission])]
        : current.filter((p) => p !== permission),
    );
  }

  async function submit() {
    try {
      await save.mutateAsync({
        uid: member.uid,
        input: { roles, grants, denies, ...(note.trim() ? { note: note.trim() } : {}) },
      });
      toast.success(`Access updated for ${member.email ?? member.uid}`);
      onClose();
    } catch (e) {
      // The API's 409s are the interesting ones and already carry a usable
      // message - self_modification, last_super_admin, email_unverified.
      const message =
        e instanceof ApiException ? e.message : e instanceof Error ? e.message : 'Save failed';
      toast.error(message);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !save.isPending && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{member.email ?? member.uid}</DialogTitle>
          <DialogDescription>
            Pick the roles they need, then adjust individual permissions if the roles are not an
            exact fit. Changes take effect immediately — they will be signed out and back in.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-5">
          <section>
            <p className="mb-2 text-[11px] font-extrabold uppercase tracking-[0.7px] text-slate-400">
              Roles
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {ROLES.map((role) => {
                const on = roles.includes(role.key);
                return (
                  <button
                    key={role.key}
                    type="button"
                    onClick={() => toggleRole(role.key)}
                    className={cn(
                      'rounded-[10px] border px-3 py-2.5 text-left transition-colors',
                      on
                        ? 'border-primary bg-primary/[0.06]'
                        : 'border-border hover:bg-secondary',
                    )}
                  >
                    <span className="flex items-center gap-2 text-[13.5px] font-bold">
                      {on && <Check className="size-3.5 text-primary" />}
                      {role.label}
                    </span>
                    <span className="mt-0.5 block text-[11.5px] text-muted-foreground">
                      {role.description}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section>
            <p className="mb-1 text-[11px] font-extrabold uppercase tracking-[0.7px] text-slate-400">
              Permissions
            </p>
            <p className="mb-3 text-[11.5px] text-muted-foreground">
              {effective.size} permission{effective.size === 1 ? '' : 's'} in total. Ticked and grey
              means a role already grants it; ticked and green is an extra you added; unticked where
              a role grants it is an exception you removed.
            </p>
            <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {PERMISSION_GROUPS.map((group) => (
                <div key={group.resource}>
                  <p className="mb-1 text-[12px] font-bold">{group.label}</p>
                  {group.permissions.map((permission) => {
                    const inherited = fromRoles.has(permission);
                    const on = effective.has(permission);
                    const added = on && !inherited;
                    const removed = !on && inherited;
                    return (
                      <label
                        key={permission}
                        className="flex cursor-pointer items-center gap-2 py-0.5 text-[12.5px]"
                      >
                        <Checkbox
                          checked={on}
                          onCheckedChange={(value) => togglePermission(permission, value === true)}
                        />
                        <span
                          className={cn(
                            added && 'font-semibold text-emerald-700 dark:text-emerald-300',
                            removed && 'text-amber-700 line-through dark:text-amber-300',
                            !added && !removed && 'text-muted-foreground',
                          )}
                        >
                          {permission.endsWith(':write') ? 'Edit' : 'View'}
                        </span>
                      </label>
                    );
                  })}
                </div>
              ))}
            </div>
          </section>

          <section>
            <Label htmlFor="iam-note">Note (optional)</Label>
            <Input
              id="iam-note"
              value={note}
              placeholder="Why this person has this access"
              onChange={(e) => setNote(e.target.value)}
            />
          </section>
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={save.isPending}>
            {save.isPending ? <Loader2 className="animate-spin" /> : <Check />}
            Save access
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
