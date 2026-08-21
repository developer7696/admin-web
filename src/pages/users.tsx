import { Fragment, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Bolt,
  Calendar,
  CalendarCheck,
  Camera,
  CloudOff,
  Download,
  Dumbbell,
  HeartCrack,
  HeartPulse,
  Link2,
  LogIn,
  LogOut,
  Rocket,
  SearchX,
  Smartphone,
  SquarePen,
  Trash2,
  Upload,
  UserMinus,
  Users as UsersIcon,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { Timestamp } from 'firebase/firestore';
import {
  useDeletionStream,
  useUsersStream,
} from '@/hooks/use-admin-users';
import {
  deleteDeletionRecord,
  deleteProfilePhoto,
  deleteUser,
  getUsersCsvData,
  syncToGoogleSheets,
  updateProfilePhoto,
  updateUserSubscription,
  uploadAndSyncProfilePhoto,
  type DeletionRow,
  type PlatformFilter,
  type UserRow,
} from '@/services/admin-user-service';
import { HeaderSlot } from '@/app/header-slot';
import { downloadCsv } from '@/lib/csv';
import { fmtDateBulletTime, fmtDateShort, toDate } from '@/lib/format';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { SearchInput } from '@/components/common/search-input';
import { EmptyState, LoadingState } from '@/components/common/states';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

/// "User Intelligence" — the admin user list, exit feedback, and per-user
/// subscription management.
///
/// Filters, search and sort stay local component state since they are ephemeral
/// UI, not shared data; the users and deletions collections are live Firestore
/// subscriptions and the aggregate stats are a one-shot read.

const SHEETS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbytOmOrYtHPX0e3gmlQ9wxT0T6PywMUlUyrOnjORN3ZWYScUiwqO5fHkxUWA2nztyk07A/exec';

const PLATFORMS: PlatformFilter[] = ['Overall', 'iOS', 'Android'];
const SORTS = ['Newest', 'Health', 'Name'] as const;

function formatDate(value: unknown): string {
  const d = toDate(value);
  return d ? fmtDateShort(d) : '-';
}

function statusColor(status: string): string {
  switch (status) {
    case 'Premium':
      return 'text-violet-500 bg-violet-500/10';
    case 'Basic':
      return 'text-blue-500 bg-blue-500/10';
    case 'Trial':
      return 'text-emerald-500 bg-emerald-500/10';
    default:
      return 'text-slate-500 bg-slate-500/10';
  }
}

function Avatar({ user, size = 64 }: { user: UserRow; size?: number }) {
  const photo = user.profilePhoto;
  return (
    <div
      style={{ width: size, height: size }}
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
    >
      {photo ? (
        <img src={String(photo)} alt={user.username} className="size-full object-cover" />
      ) : (
        <span
          className="font-black text-primary"
          style={{ fontSize: size * 0.38 }}
        >
          {user.username.charAt(0).toUpperCase()}
        </span>
      )}
    </div>
  );
}

/// The two dates worth showing for a member, chosen by status. Same source
/// fields and same colours the stacked lifecycle rows used — flattened to one
/// line so a card is two lines instead of six.
function lifecycleFor(user: UserRow): { label: string; value: string; tint: string }[] {
  const trialStart = toDate(user.trialStartDate);
  const trialEnds = trialStart ? new Date(trialStart.getTime() + 7 * 86_400_000) : null;

  switch (user.calculatedStatus) {
    case 'Trial':
      // Without a start date there is no trial window to describe.
      return trialStart
        ? [
            { label: 'Started', value: fmtDateShort(trialStart), tint: 'text-emerald-600' },
            {
              label: 'Ends',
              value: trialEnds ? fmtDateShort(trialEnds) : '-',
              tint: 'text-red-500',
            },
          ]
        : [];
    case 'Premium':
    case 'Basic':
      return [
        {
          label: 'Started',
          value: formatDate(user.subscriptionStartDate ?? user.createdAt),
          tint: 'text-violet-600',
        },
        {
          label: 'Expires',
          value: formatDate(user.subscriptionEndDate),
          tint: 'text-violet-600',
        },
      ];
    case 'Expired':
    case 'Inactive':
      return [
        {
          label: 'Started',
          value: formatDate(
            user.subscriptionStartDate ?? user.trialStartDate ?? user.createdAt,
          ),
          tint: 'text-slate-500',
        },
        {
          label: 'Expired',
          value: user.subscriptionEndDate
            ? formatDate(user.subscriptionEndDate)
            : trialEnds
              ? fmtDateShort(trialEnds)
              : '-',
          tint: 'text-red-600',
        },
      ];
    default:
      return [];
  }
}

function PersonalStat({
  label,
  value,
  icon,
  tint,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  tint: string;
}) {
  return (
    <Card className="flex-1 p-4">
      <div className={cn('w-fit rounded-[10px] p-2 [&_svg]:size-4', tint)}>{icon}</div>
      <p className={cn('tabular mt-3 text-xl font-black', tint.split(' ').at(-1))}>{value}</p>
      <p className="text-[10px] font-bold uppercase tracking-[0.5px] text-muted-foreground">
        {label}
      </p>
    </Card>
  );
}

function HighlightRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 py-1 text-[13px] [&_svg]:size-4">
      <span className="text-white/70">{icon}</span>
      <span className="font-medium text-white/70">{label}</span>
      <span className="ml-auto font-extrabold text-white">{value}</span>
    </div>
  );
}

/// Full member profile: engagement counters, the subscription timeline, and
/// every raw field on the document.
function UserIntakeDialog({
  user,
  onClose,
  onPhotoAction,
}: {
  user: UserRow;
  onClose: () => void;
  onPhotoAction: () => void;
}) {
  const navigate = useNavigate();

  const num = (...keys: string[]) => {
    for (const k of keys) {
      const v = user[k];
      if (typeof v === 'number') return v;
      if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
    }
    return 0;
  };

  const trialStart = toDate(user.trialStartDate);
  const trialEnds = trialStart ? new Date(trialStart.getTime() + 7 * 86_400_000) : null;

  const rawEntries = Object.entries(user).filter(
    ([key]) => !['health', 'calculatedStatus', 'uid', 'profilePhoto'].includes(key),
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl">
        <DialogHeader className="flex-row items-center gap-5">
          <div className="relative">
            <Avatar user={user} size={70} />
            <button
              type="button"
              onClick={onPhotoAction}
              className="absolute bottom-0 right-0 rounded-full border-2 border-card bg-primary p-1 text-primary-foreground"
              aria-label="Manage profile photo"
            >
              <Camera className="size-3" />
            </button>
          </div>
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-2xl font-black">{user.username}</DialogTitle>
            <DialogDescription>{user.email ?? 'Member Intelligence'}</DialogDescription>
          </div>
          <Button
            variant="outline"
            size="icon"
            title="Workout Tracker"
            onClick={() => navigate(`/users/${user.uid}/workouts`)}
          >
            <HeartPulse className="text-primary" />
          </Button>
        </DialogHeader>

        <DialogBody>
          <p className="text-[11px] font-extrabold uppercase tracking-[1.5px] text-muted-foreground">
            Individual performance analysis
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <PersonalStat
              label="Logins"
              value={String(num('loginCount', 'totalLogins', 'logins'))}
              icon={<LogIn />}
              tint="bg-blue-500/10 text-blue-500"
            />
            <PersonalStat
              label="Rocket"
              value={String(num('rocketUsage', 'totalRocket'))}
              icon={<Rocket />}
              tint="bg-purple-500/10 text-purple-500"
            />
            <PersonalStat
              label="Pulse"
              value={String(
                num('articlesRead', 'totalArticles') + num('recipesViewed', 'totalRecipes'),
              )}
              icon={<Bolt />}
              tint="bg-emerald-500/10 text-emerald-500"
            />
            <PersonalStat
              label="Lifetime"
              value={String(num('totalWorkouts', 'workoutCount'))}
              icon={<Dumbbell />}
              tint="bg-orange-500/10 text-orange-500"
            />
          </div>

          <div className="mt-3 flex items-center gap-3 rounded-xl border border-primary/10 bg-primary/[0.05] px-4 py-2.5">
            <AlertCircle className="size-3.5 shrink-0 text-primary" />
            <p className="text-[11px] font-semibold text-primary">
              Detailed monthly activity &amp; hours are synced in the &quot;Workout Tracker&quot;
              view below.
            </p>
          </div>

          <p className="mt-8 text-[11px] font-extrabold uppercase tracking-[1.5px] text-muted-foreground">
            Subscription timeline
          </p>
          <div className="mt-4 rounded-3xl bg-gradient-to-br from-primary to-indigo-800 p-5 shadow-lg shadow-primary/30">
            <HighlightRow icon={<CalendarCheck />} label="Joined" value={formatDate(user.createdAt)} />
            {user.calculatedStatus === 'Trial' ? (
              <>
                <div className="my-2 h-px bg-white/25" />
                <HighlightRow
                  icon={<Activity />}
                  label="Trial Started"
                  value={formatDate(user.trialStartDate)}
                />
                <HighlightRow
                  icon={<AlertCircle />}
                  label="Trial Expires"
                  value={trialEnds ? fmtDateShort(trialEnds) : '-'}
                />
              </>
            ) : user.subscriptionEndDate != null ? (
              <>
                <div className="my-2 h-px bg-white/25" />
                <HighlightRow
                  icon={<Bolt />}
                  label="Plan Started"
                  value={formatDate(user.subscriptionStartDate)}
                />
                <HighlightRow
                  icon={<CalendarCheck />}
                  label="Plan Expires"
                  value={formatDate(user.subscriptionEndDate)}
                />
              </>
            ) : null}
          </div>

          <Button
            variant="outline"
            className="mt-6 h-12 w-full border-primary/20"
            onClick={() => navigate(`/users/${user.uid}/workouts`)}
          >
            <HeartPulse className="text-primary" />
            <span className="font-extrabold text-primary">View Detailed Workout Tracker</span>
          </Button>

          <p className="mt-8 text-[11px] font-extrabold uppercase tracking-[1.5px] text-muted-foreground">
            Raw member intelligence
          </p>
          <div className="mt-4 flex flex-col gap-3">
            {rawEntries.map(([key, value]) => (
              <div
                key={key}
                className="flex gap-4 rounded-2xl border border-border bg-card p-4 text-[13px]"
              >
                <span className="flex-[2] font-bold text-muted-foreground">{key}</span>
                <span className="flex-[3] break-all font-semibold">
                  {value instanceof Timestamp ? formatDate(value) : String(value)}
                </span>
              </div>
            ))}
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

export function UsersPage() {
  const [platform, setPlatform] = useState<PlatformFilter>('Overall');
  const [status, setStatus] = useState('All');
  const [filterNoEmail, setFilterNoEmail] = useState(false);
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'Users' | 'Exits'>('Users');
  const [sortBy, setSortBy] = useState<(typeof SORTS)[number]>('Newest');
  const [ascending, setAscending] = useState(false);
  const [range, setRange] = useState<{ start: Date | null; end: Date | null }>({
    start: null,
    end: null,
  });
  const [syncing, setSyncing] = useState(false);

  const [intakeUser, setIntakeUser] = useState<UserRow | null>(null);
  const [photoUser, setPhotoUser] = useState<UserRow | null>(null);
  const [urlUser, setUrlUser] = useState<UserRow | null>(null);
  const [photoUrl, setPhotoUrl] = useState('');
  const [accessUser, setAccessUser] = useState<UserRow | null>(null);
  const [accessTier, setAccessTier] = useState<'Premium' | 'Basic' | null>(null);
  const [terminating, setTerminating] = useState<UserRow | null>(null);
  const [deletingRecord, setDeletingRecord] = useState<DeletionRow | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const users = useUsersStream({
    platformFilter: platform,
    ghosts: status === 'Ghosts',
    startDate: range.start,
    endDate: range.end,
  });
  const deletions = useDeletionStream({ startDate: range.start, endDate: range.end });

  // Derived from the rows already streaming rather than fetched again. The
  // stream is filtered by platform and date but NOT by status, which is exactly
  // the population these four counts describe — and it is live, so a grant or a
  // deletion moves them without anything being invalidated.
  const stats = useMemo(() => {
    const counts = { premiumCount: 0, basicCount: 0, trialCount: 0, freeCount: 0 };
    for (const u of users.data) {
      switch (u.calculatedStatus) {
        case 'Premium':
          counts.premiumCount += 1;
          break;
        case 'Basic':
          counts.basicCount += 1;
          break;
        case 'Trial':
          counts.trialCount += 1;
          break;
        case 'Expired':
          counts.freeCount += 1;
          break;
      }
    }
    return counts;
  }, [users.data]);

  const filtered = useMemo(() => {
    let rows = [...users.data];

    if (status !== 'All' && status !== 'Ghosts') {
      rows =
        status === 'Inactive'
          ? rows.filter((u) => u.calculatedStatus === 'Expired' || u.calculatedStatus === 'Inactive')
          : rows.filter((u) => u.calculatedStatus === status);
    }

    if (filterNoEmail) {
      rows = rows.filter((u) => !u.email || u.email === 'No email');
    }

    const q = search.toLowerCase();
    if (q) rows = rows.filter((u) => u.username.toLowerCase().includes(q));

    rows.sort((a, b) => {
      let cmp: number;
      if (sortBy === 'Health') cmp = b.health - a.health;
      else if (sortBy === 'Name') cmp = a.username.localeCompare(b.username);
      else cmp = String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''));
      return ascending ? -cmp : cmp;
    });

    return rows;
  }, [users.data, status, filterNoEmail, search, sortBy, ascending]);

  async function exportCsv() {
    try {
      const rows = await getUsersCsvData({
        platformFilter: platform,
        startDate: range.start,
        endDate: range.end,
      });
      downloadCsv(`users_export_${Date.now()}.csv`, rows);
    } catch (e) {
      toast.error(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function syncSheets() {
    setSyncing(true);
    try {
      const ok = await syncToGoogleSheets(SHEETS_SCRIPT_URL, {
        platformFilter: platform,
        startDate: range.start,
        endDate: range.end,
      });
      if (ok) toast.success('Google Sheets Synced!');
      else toast.error('Sync failed.');
    } finally {
      setSyncing(false);
    }
  }

  async function grantAccess(tier: 'Premium' | 'Basic' | 'Trial' | 'None', months?: number) {
    if (!accessUser) return;
    const uid = accessUser.uid;
    try {
      if (tier === 'Trial') {
        await updateUserSubscription(uid, 'Trial', { days: 7 });
        toast.success('Free Trial granted for 7 days');
      } else if (tier === 'None') {
        await updateUserSubscription(uid, 'None');
        toast.success('Subscription removed');
      } else {
        await updateUserSubscription(uid, tier, { months });
        toast.success(`${tier} updated for ${months} months`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
    setAccessUser(null);
    setAccessTier(null);
  }

  async function uploadPhoto(file: File) {
    if (!photoUser) return;
    const uid = photoUser.uid;
    setPhotoUser(null);
    try {
      await uploadAndSyncProfilePhoto(uid, file);
      toast.success('Profile photo updated successfully');
    } catch (e) {
      toast.error(`Failed to update photo: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const listLoading = viewMode === 'Exits' ? deletions.loading : users.loading;
  const listError = viewMode === 'Exits' ? deletions.error : users.error;

  return (
    <div className="flex h-full flex-col">
      {/* Search lives in the top navbar, next to Payments'. It only applies to
          the member list, so Exits mode leaves the slot empty. */}
      {viewMode === 'Users' && (
        <HeaderSlot>
          <SearchInput
            value={search}
            onChange={setSearch}
            variant="header"
            placeholder="Search users…"
            className="w-full max-w-md"
          />
        </HeaderSlot>
      )}

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        <div className="p-4">
          {/* Title, count, mode, platform, date range and the two exports on ONE
              bar — matching the Dashboard. The count is the flexible element and
              truncates first, because a control that has jumped to another line
              is harder to find than a number that has lost its tail.

              Status counts and sorting sit on their own row below: they filter
              the list rather than scoping the page, and there are too many to
              share a line honestly. */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
            <h1 className="shrink-0 text-xl font-bold tracking-tight">Users</h1>

            <p className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
              {listLoading
                ? 'Loading…'
                : viewMode === 'Exits'
                  ? `${deletions.data.length} deletion records`
                  : `${filtered.length} of ${users.data.length} accounts`}
            </p>

            <div className="flex shrink-0 gap-1 rounded-lg border border-border bg-card p-1">
              {(
                [
                  ['Users', 'Members', UsersIcon, 'bg-primary'],
                  ['Exits', 'Exits', LogOut, 'bg-red-500'],
                ] as const
              ).map(([mode, label, Icon, tint]) => {
                const selected = viewMode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setViewMode(mode)}
                    className={cn(
                      'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-bold transition-colors',
                      selected ? cn(tint, 'text-white') : 'text-muted-foreground hover:bg-secondary',
                    )}
                  >
                    <Icon className="size-3.5" /> {label}
                  </button>
                );
              })}
            </div>

            {viewMode === 'Users' && (
              <Select value={platform} onValueChange={(v) => setPlatform(v as PlatformFilter)}>
                <SelectTrigger className="h-8 w-auto shrink-0 gap-1.5 text-xs font-semibold">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PLATFORMS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <div
              className="flex shrink-0 items-center gap-1 rounded-lg border border-border bg-card px-2"
              title="Filter by join date"
            >
              <Calendar className="size-3.5 shrink-0 text-muted-foreground" />
              <Input
                type="date"
                value={range.start ? range.start.toISOString().slice(0, 10) : ''}
                onChange={(e) =>
                  setRange((r) => ({
                    ...r,
                    start: e.target.value ? new Date(e.target.value) : null,
                  }))
                }
                className="h-7 w-[98px] border-0 px-0.5 text-[11px] shadow-none focus-visible:ring-0"
              />
              <span className="text-xs text-muted-foreground">–</span>
              <Input
                type="date"
                value={range.end ? range.end.toISOString().slice(0, 10) : ''}
                onChange={(e) =>
                  setRange((r) => ({ ...r, end: e.target.value ? new Date(e.target.value) : null }))
                }
                className="h-7 w-[98px] border-0 px-0.5 text-[11px] shadow-none focus-visible:ring-0"
              />
              {(range.start || range.end) && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title="Clear date range"
                  onClick={() => setRange({ start: null, end: null })}
                >
                  <X className="size-3.5 text-red-400" />
                </Button>
              )}
            </div>

            <Button variant="outline" size="sm" onClick={() => void exportCsv()}>
              <Download /> CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={syncing}
              onClick={() => void syncSheets()}
            >
              <Upload className={cn(syncing && 'animate-pulse')} /> Sheets
            </Button>
          </div>

          {/* Second row: the list filters. The status counts double as the
              status filter, so they carry their own meaning and need no
              "filter by status" caption above them. */}
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {viewMode === 'Users' && stats && (
              <div className="flex flex-wrap items-center gap-1.5">
                {(
                  [
                    ['Premium', stats.premiumCount, 'text-violet-500 border-violet-500'],
                    ['Basic', stats.basicCount, 'text-blue-500 border-blue-500'],
                    ['Trial', stats.trialCount, 'text-emerald-500 border-emerald-500'],
                    ['Inactive', stats.freeCount, 'text-amber-500 border-amber-500'],
                  ] as const
                ).map(([label, value, tint]) => {
                  const selected = status === label;
                  const [textClass] = tint.split(' ');
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={() => setStatus(selected ? 'All' : label)}
                      className={cn(
                        'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors',
                        selected
                          ? cn(tint, 'bg-current/10 font-semibold')
                          : 'border-input bg-card hover:bg-secondary',
                      )}
                    >
                      <span className={cn('tabular font-extrabold', textClass)}>{value}</span>
                      <span className={selected ? textClass : 'text-muted-foreground'}>{label}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {viewMode === 'Users' && (
              <div className="scrollbar-thin flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
                {SORTS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSortBy(s)}
                    className={cn(
                      'shrink-0 rounded-full border px-2.5 py-1 text-[11px] transition-colors',
                      sortBy === s
                        ? 'border-primary bg-primary/10 font-semibold text-primary'
                        : 'border-input bg-card text-muted-foreground hover:bg-secondary',
                    )}
                  >
                    {s}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setFilterNoEmail((v) => !v)}
                  className={cn(
                    'shrink-0 rounded-full border px-2.5 py-1 text-[11px] transition-colors',
                    filterNoEmail
                      ? 'border-orange-500 bg-orange-500/10 font-semibold text-orange-700 dark:text-orange-400'
                      : 'border-input bg-card text-muted-foreground hover:bg-secondary',
                  )}
                >
                  No Email
                </button>
                <button
                  type="button"
                  onClick={() => setStatus(status === 'Ghosts' ? 'All' : 'Ghosts')}
                  className={cn(
                    'shrink-0 rounded-full border px-2.5 py-1 text-[11px] transition-colors',
                    status === 'Ghosts'
                      ? 'border-red-500 bg-red-500/10 font-semibold text-red-600'
                      : 'border-input bg-card text-muted-foreground hover:bg-secondary',
                  )}
                >
                  Ghosts
                </button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="ml-auto shrink-0"
                  title={ascending ? 'Ascending (Bottom-up)' : 'Descending (Top-down)'}
                  onClick={() => setAscending((v) => !v)}
                >
                  {ascending ? (
                    <ArrowUp className="size-3.5 text-primary" />
                  ) : (
                    <ArrowDown className="size-3.5 text-primary" />
                  )}
                </Button>
              </div>
            )}
          </div>
        </div>

        <div className="px-4 pb-16">
          {listLoading && <LoadingState />}

          {listError && (
            <div className="flex flex-col items-center gap-3 p-10 text-center">
              <CloudOff className="size-10 text-slate-400" />
              <p className="text-sm text-muted-foreground">Failed to load: {listError.message}</p>
            </div>
          )}

          {!listLoading &&
            !listError &&
            (viewMode === 'Exits' ? (
              deletions.data.length === 0 ? (
                <EmptyState
                  icon={<HeartCrack className="size-16" />}
                  title="No deletion reasons discovered"
                />
              ) : (
                deletions.data.map((record) => (
                  <Card key={`${record.collection}-${record.docId}`} className="mb-2.5 rounded-2xl p-4">
                    <div className="flex items-center gap-3">
                      <span className="rounded-full bg-red-50 p-2 dark:bg-red-950/40">
                        <UserMinus className="size-4 text-red-500" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-black">{record.username}</p>
                        <p className="text-[11px] font-medium text-muted-foreground">
                          {fmtDateBulletTime(record.date)}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setDeletingRecord(record)}
                      >
                        <Trash2 className="size-[18px] text-red-500" />
                      </Button>
                    </div>
                    <div className="my-2.5 h-px bg-border" />
                    <p className="text-[10px] font-extrabold uppercase tracking-[0.5px] text-muted-foreground">
                      Reason for deletion
                    </p>
                    <p className="mt-1.5 text-xs font-semibold leading-relaxed text-slate-700 dark:text-slate-300">
                      {record.reason}
                    </p>
                  </Card>
                ))
              )
            ) : filtered.length === 0 ? (
              <EmptyState icon={<SearchX className="size-12" />} title="No matching users found" />
            ) : (
              filtered.map((user) => {
                const platformStr = String(user.platform ?? 'android').toLowerCase();
                const isIos =
                  platformStr.includes('apple') ||
                  platformStr.includes('ios') ||
                  platformStr.includes('iphone');
                const lifecycle = lifecycleFor(user);

                return (
                  <Card key={user.uid} className="mb-2 rounded-xl p-2.5">
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setIntakeUser(user)}
                        className="shrink-0"
                      >
                        <Avatar user={user} size={38} />
                      </button>

                      <button
                        type="button"
                        onClick={() => setIntakeUser(user)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="flex items-center gap-2">
                          <span className="truncate text-[13.5px] font-bold tracking-tight">
                            {user.username}
                          </span>
                          <span
                            className={cn(
                              'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-extrabold',
                              statusColor(user.calculatedStatus),
                            )}
                          >
                            {user.calculatedStatus}
                          </span>
                          <span className="flex shrink-0 items-center gap-1 text-[10px] font-semibold text-slate-400">
                            <Smartphone className="size-3" />
                            {isIos ? 'iOS' : 'Android'}
                          </span>
                        </div>

                        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
                          <span>Since {formatDate(user.createdAt)}</span>
                          {lifecycle.map((entry) => (
                            <Fragment key={entry.label}>
                              <span className="text-slate-300">·</span>
                              <span className={entry.tint}>
                                {entry.label} {entry.value}
                              </span>
                            </Fragment>
                          ))}
                        </p>
                      </button>

                      <div className="flex shrink-0 items-center">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          title="Workout Tracker"
                          onClick={() => navigate(`/users/${user.uid}/workouts`)}
                        >
                          <HeartPulse className="size-4 text-primary/60" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          title="Manage Access"
                          onClick={() => setAccessUser(user)}
                        >
                          <SquarePen className="size-4 text-slate-400" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          title="Billing"
                          onClick={() => navigate(`/users/${user.uid}/billing`)}
                        >
                          <Link2 className="size-4 text-slate-400" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          title="Terminate Member"
                          onClick={() => setTerminating(user)}
                        >
                          <Trash2 className="size-4 text-slate-400" />
                        </Button>
                      </div>
                    </div>
                  </Card>
                );
              })
            ))}
        </div>
      </div>

      {intakeUser && (
        <UserIntakeDialog
          user={intakeUser}
          onClose={() => setIntakeUser(null)}
          onPhotoAction={() => setPhotoUser(intakeUser)}
        />
      )}

      {/* Manage access: tier first, then duration for the paid tiers. */}
      {accessUser && accessTier == null && (
        <Dialog open onOpenChange={(open) => !open && setAccessUser(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Manage Access: {accessUser.username}</DialogTitle>
            </DialogHeader>
            <DialogBody className="flex flex-col gap-1">
              {(
                [
                  ['Premium', 'text-purple-500'],
                  ['Basic', 'text-blue-500'],
                  ['Trial', 'text-emerald-500'],
                  ['None', 'text-slate-500'],
                ] as const
              ).map(([tier, tint]) => (
                <button
                  key={tier}
                  type="button"
                  onClick={() => {
                    if (tier === 'Premium' || tier === 'Basic') setAccessTier(tier);
                    else void grantAccess(tier);
                  }}
                  className={cn(
                    'rounded-md px-3 py-3 text-left font-bold transition-colors hover:bg-secondary',
                    tint,
                  )}
                >
                  {tier}
                </button>
              ))}
            </DialogBody>
          </DialogContent>
        </Dialog>
      )}

      {accessUser && accessTier != null && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) {
              setAccessUser(null);
              setAccessTier(null);
            }
          }}
        >
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Select Duration: {accessTier}</DialogTitle>
            </DialogHeader>
            <DialogBody className="flex flex-col gap-1">
              {[
                [1, '1 Month'],
                [3, '3 Months'],
                [12, '1 Year'],
              ].map(([months, label]) => (
                <button
                  key={months}
                  type="button"
                  onClick={() => void grantAccess(accessTier, months as number)}
                  className="rounded-md px-3 py-3 text-left font-bold transition-colors hover:bg-secondary"
                >
                  {label}
                </button>
              ))}
            </DialogBody>
          </DialogContent>
        </Dialog>
      )}

      {photoUser && (
        <Dialog open onOpenChange={(open) => !open && setPhotoUser(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Manage Profile Photo</DialogTitle>
            </DialogHeader>
            <DialogBody className="flex flex-col gap-1">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex items-center gap-3 rounded-md p-3 text-left transition-colors hover:bg-secondary"
              >
                <span className="rounded-full bg-indigo-50 p-2.5 dark:bg-indigo-950/40">
                  <Upload className="size-4 text-indigo-500" />
                </span>
                <span>
                  <span className="block font-semibold">Upload New Photo</span>
                  <span className="block text-xs text-muted-foreground">
                    Select a photo from your device
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setUrlUser(photoUser);
                  setPhotoUser(null);
                }}
                className="flex items-center gap-3 rounded-md p-3 text-left transition-colors hover:bg-secondary"
              >
                <span className="rounded-full bg-slate-100 p-2.5 dark:bg-slate-800">
                  <Link2 className="size-4 text-slate-500" />
                </span>
                <span className="font-semibold">Use Image URL</span>
              </button>
              {photoUser.profilePhoto != null && (
                <button
                  type="button"
                  onClick={() => {
                    const uid = photoUser.uid;
                    setPhotoUser(null);
                    void deleteProfilePhoto(uid).then(
                      () => toast.success('Photo removed'),
                      (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
                    );
                  }}
                  className="flex items-center gap-3 rounded-md p-3 text-left transition-colors hover:bg-secondary"
                >
                  <span className="rounded-full bg-red-50 p-2.5 dark:bg-red-950/40">
                    <Trash2 className="size-4 text-red-500" />
                  </span>
                  <span className="font-semibold text-red-500">Remove Photo</span>
                </button>
              )}
            </DialogBody>
          </DialogContent>
        </Dialog>
      )}

      {urlUser && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) {
              setUrlUser(null);
              setPhotoUrl('');
            }
          }}
        >
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Update Profile Photo</DialogTitle>
            </DialogHeader>
            <DialogBody>
              <Input
                value={photoUrl}
                placeholder="Enter Image URL"
                onChange={(e) => setPhotoUrl(e.target.value)}
              />
            </DialogBody>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setUrlUser(null);
                  setPhotoUrl('');
                }}
              >
                Cancel
              </Button>
              <Button
                disabled={!photoUrl.trim()}
                onClick={() => {
                  const uid = urlUser.uid;
                  const url = photoUrl.trim();
                  setUrlUser(null);
                  setPhotoUrl('');
                  void updateProfilePhoto(uid, url).then(
                    () => toast.success('Profile photo updated'),
                    (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
                  );
                }}
              >
                Update
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void uploadPhoto(file);
          e.target.value = '';
        }}
      />

      {terminating && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setTerminating(null)}
          title="Terminate User?"
          description={`Are you sure you want to permanently delete ${terminating.username}? This action cannot be undone.`}
          confirmLabel="Terminate"
          destructive
          onConfirm={async () => {
            try {
              await deleteUser(terminating.uid);
                      toast.success(`${terminating.username} terminated`);
            } catch (e) {
              toast.error(e instanceof Error ? e.message : String(e));
            }
          }}
        />
      )}

      {deletingRecord && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setDeletingRecord(null)}
          title="Permanent Deletion"
          description="Are you sure you want to permanently delete this feedback? This cannot be undone."
          confirmLabel="Delete Permanently"
          destructive
          onConfirm={async () => {
            try {
              await deleteDeletionRecord(deletingRecord.collection, deletingRecord.docId);
              toast.success('Feedback permanently deleted');
            } catch (e) {
              toast.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
            }
          }}
        />
      )}
    </div>
  );
}
