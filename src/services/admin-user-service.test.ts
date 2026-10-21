import { describe, expect, it, vi } from 'vitest';

// The service reaches Firebase for one thing only — Storage, for photo bytes —
// and that is not exercised here. Stubbing the module keeps `initializeAuth`
// from running in a Node process that has no browser to persist to.
vi.mock('@/lib/firebase', () => ({ app: {}, auth: {}, db: {}, storage: {} }));

const {
  calculateStatus,
  csvRowsFromUsers,
  filterDeletionRecords,
  filterUsers,
  grantDaysForMonths,
  parseDeletionRow,
  parseUserRow,
} = await import('./admin-user-service');

const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString();

describe('calculateStatus', () => {
  it('reads ISO strings, not Firestore Timestamps', () => {
    expect(
      calculateStatus({ isPremium: true, subscriptionEndDate: iso(30) }),
    ).toBe('Premium');
  });

  it('needs the end date to be in the future, not merely present', () => {
    expect(calculateStatus({ isPremium: true, subscriptionEndDate: iso(-1) })).toBe('Inactive');
  });

  it('treats the Basic tier string as Basic even without the flag', () => {
    expect(calculateStatus({ subscriptionTier: 'Basic', subscriptionEndDate: iso(5) })).toBe(
      'Basic',
    );
  });

  it('splits a trial into Trial and Expired at seven days', () => {
    expect(calculateStatus({ trialStartDate: iso(-2) })).toBe('Trial');
    expect(calculateStatus({ trialStartDate: iso(-8) })).toBe('Expired');
  });

  it('calls an account with no trial at all Inactive, not Expired', () => {
    expect(calculateStatus({})).toBe('Inactive');
  });
});

describe('parseUserRow', () => {
  it('labels an identity-less row as a ghost and scores it zero', () => {
    const row = parseUserRow({ uid: 'abc123xyz', email: null, username: '  ' });
    expect(row.calculatedStatus).toBe('Ghost');
    expect(row.username).toBe('Ghost Record');
    expect(row.health).toBe(0);
    expect(row.profilePhoto).toBeNull();
  });

  it('falls back to the local part of the email when the username is a placeholder', () => {
    expect(parseUserRow({ uid: 'u1', email: 'Ravi.K@example.com', username: 'User' }).username).toBe(
      'Ravi.K',
    );
  });

  it('falls back to the uid when there is no email to name them by', () => {
    const row = parseUserRow({ uid: 'abcdefghij', email: null, username: 'User' });
    expect(row.username).toBe('User_abcde');
    // Still not a ghost: it has a username field, however useless.
    expect(row.calculatedStatus).not.toBe('Ghost');
  });

  it('keeps every column the endpoint returned alongside the derived fields', () => {
    const row = parseUserRow({
      uid: 'u2',
      email: 'a@b.com',
      username: 'Asha',
      phoneNumber: '+91999',
      subscriptionEndDate: iso(10),
      isPremium: true,
    });
    expect(row.phoneNumber).toBe('+91999');
    expect(row.calculatedStatus).toBe('Premium');
    expect(row.platform).toBe('Android');
  });
});

describe('filterUsers', () => {
  const rows = [
    parseUserRow({ uid: 'u1', email: 'a@b.com', username: 'Asha', platform: 'iOS' }),
    parseUserRow({ uid: 'u2', email: 'b@b.com', username: 'Bala', platform: 'Android' }),
    parseUserRow({ uid: 'u3', email: 'ops@aarambh.app', username: 'Ops', role: 'admin' }),
    parseUserRow({ uid: 'u4', email: null, username: null }),
  ];
  const uids = (list: { uid: string }[]) => list.map((r) => r.uid);

  it('drops staff accounts and ghosts from the member list', () => {
    expect(uids(filterUsers(rows, { platformFilter: 'Overall', ghosts: false }))).toEqual([
      'u1',
      'u2',
    ]);
  });

  it('returns only ghosts when the Ghosts view is on', () => {
    expect(uids(filterUsers(rows, { platformFilter: 'Overall', ghosts: true }))).toEqual(['u4']);
  });

  it('recognises the several spellings of an Apple platform', () => {
    expect(uids(filterUsers(rows, { platformFilter: 'iOS', ghosts: false }))).toEqual(['u1']);
    expect(uids(filterUsers(rows, { platformFilter: 'Android', ghosts: false }))).toEqual(['u2']);
  });

  it('excludes a row with no join date once a date filter is set', () => {
    const dateless = [parseUserRow({ uid: 'u9', email: 'c@b.com', username: 'Chitra' })];
    expect(
      filterUsers(dateless, {
        platformFilter: 'Overall',
        ghosts: false,
        startDate: new Date('2020-01-01'),
      }),
    ).toHaveLength(0);
  });
});

describe('parseDeletionRow', () => {
  it('derives a label from the email, since the account kept no username', () => {
    const row = parseDeletionRow({
      uid: 'u1',
      email: 'Ravi.K@example.com',
      reason: 'Too expensive',
      deletedAt: '2026-03-04T10:00:00.000Z',
      source: 'DeletionReasons',
    });
    expect(row.label).toBe('Ravi.K');
    expect(row.date?.toISOString()).toBe('2026-03-04T10:00:00.000Z');
    expect(row.source).toBe('DeletionReasons');
  });

  it('falls back to the uid when the row kept no email either', () => {
    expect(parseDeletionRow({ uid: 'abcdefghij', reason: 'x' }).label).toBe('User_abcde');
  });

  it('names a blank reason rather than rendering an empty card', () => {
    expect(parseDeletionRow({ uid: 'u1', reason: '   ' }).reason).toBe('No reason provided');
    expect(parseDeletionRow({ uid: 'u1' }).reason).toBe('No reason provided');
  });

  it('leaves a missing deletion date null instead of defaulting it to now', () => {
    expect(parseDeletionRow({ uid: 'u1', reason: 'x', deletedAt: null }).date).toBeNull();
  });
});

describe('filterDeletionRecords', () => {
  const rows = [
    parseDeletionRow({ uid: 'a', reason: 'x', deletedAt: '2026-03-10T00:00:00.000Z' }),
    parseDeletionRow({ uid: 'b', reason: 'x', deletedAt: '2026-03-20T00:00:00.000Z' }),
    parseDeletionRow({ uid: 'c', reason: 'x', deletedAt: null }),
  ];

  it('passes everything through when no range is set — undated rows included', () => {
    expect(filterDeletionRecords(rows, {})).toHaveLength(3);
  });

  it('drops undated rows as soon as a range is set', () => {
    const kept = filterDeletionRecords(rows, { startDate: new Date('2026-03-01T00:00:00.000Z') });
    expect(kept.map((r) => r.uid)).toEqual(['a', 'b']);
  });

  it('includes the whole of the end day', () => {
    const kept = filterDeletionRecords(rows, {
      startDate: new Date('2026-03-01T00:00:00.000Z'),
      endDate: new Date('2026-03-10T00:00:00.000Z'),
    });
    expect(kept.map((r) => r.uid)).toEqual(['a']);
  });
});

describe('grantDaysForMonths', () => {
  it('uses real month lengths rather than 30-day months', () => {
    // Jan 15 noon → Feb 15 midnight, rounded up so the grant is never short.
    expect(grantDaysForMonths(1, new Date(2026, 0, 15, 12))).toBe(31);
    expect(grantDaysForMonths(12, new Date(2026, 0, 15, 12))).toBe(365);
  });

  it('rolls a month count past December into the next year', () => {
    // Nov 1 → Feb 1: 30 + 31 + 31 days.
    expect(grantDaysForMonths(3, new Date(2026, 10, 1))).toBe(92);
  });

  it('never returns a non-positive day count', () => {
    expect(grantDaysForMonths(0, new Date(2026, 0, 15, 12))).toBe(1);
  });
});

describe('csvRowsFromUsers', () => {
  const header = csvRowsFromUsers([])[0] as string[];
  const at = (row: unknown[], column: string) => row[header.indexOf(column)];

  it('emits the header even with no rows, so the sheet keeps its columns', () => {
    expect(csvRowsFromUsers([])).toHaveLength(1);
    expect(header[0]).toBe('S.No');
  });

  it('maps the renamed columns to their new field names', () => {
    const [, row] = csvRowsFromUsers([
      {
        uid: 'u1',
        email: 'a@b.com',
        username: 'Asha',
        cityTown: 'Pune',
        maintenanceCalories: 2100,
        height: 165,
        weight: 58.5,
        totalWorkouts: 12,
      },
    ]);
    expect(at(row, 'City')).toBe('Pune');
    expect(at(row, 'Calories')).toBe(2100);
    expect(at(row, 'Height(cm)')).toBe(165);
    expect(at(row, 'Weight(kg)')).toBe(58.5);
    expect(at(row, 'Total Workouts')).toBe(12);
  });

  it('fills Workout Time from preferredWorkoutTime', () => {
    const [, row] = csvRowsFromUsers([
      { uid: 'u1', email: 'a@b.com', preferredWorkoutTime: 'Morning' },
    ]);
    expect(at(row, 'Workout Time')).toBe('Morning');
  });

  it('dashes an unset column instead of shifting every later one', () => {
    const [, row] = csvRowsFromUsers([{ uid: 'u1', email: 'a@b.com', username: 'Asha' }]);
    expect(at(row, 'Workout Time')).toBe('-');
    expect(at(row, 'Phone')).toBe('-');
    expect(row).toHaveLength(header.length);
  });

  it('numbers the rows from one and formats the join date dd-MM-yyyy', () => {
    const rows = csvRowsFromUsers([
      { uid: 'u1', email: 'a@b.com', createdAt: '2026-03-04T10:00:00.000Z' },
      { uid: 'u2', email: 'b@b.com' },
    ]);
    expect(at(rows[1], 'S.No')).toBe(1);
    expect(at(rows[2], 'S.No')).toBe(2);
    expect(at(rows[1], 'Joined Date')).toMatch(/^0[34]-03-2026$/);
    expect(at(rows[2], 'Joined Date')).toBe('-');
  });
});
