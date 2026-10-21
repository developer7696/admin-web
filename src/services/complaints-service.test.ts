import { describe, expect, it, vi } from 'vitest';

// The service reaches the API client, which reads the Firebase Auth instance at
// import time. Nothing here makes a request, so the module is stubbed rather
// than initialising Firebase in a node test run.
vi.mock('@/lib/firebase', () => ({ auth: {}, db: {}, storage: {} }));

const { parseComplaint, parseComplaintStats } = await import('./complaints-service');

describe('parseComplaint', () => {
  const raw = {
    id: 'c1',
    userId: 'uid-1',
    userEmail: 'someone@example.com',
    userName: 'Someone',
    userProfilePhoto: null,
    subject: 'Cannot log a workout',
    description: 'The save button spins forever.',
    category: 'Bug',
    status: 'in_progress',
    priority: 'high',
    adminResponse: 'Looking into it.',
    adminResponseAt: '2026-09-01T10:30:00.000Z',
    isRead: true,
    createdAt: '2026-08-30T06:00:00.000Z',
    updatedAt: '2026-09-01T10:30:00.000Z',
  };

  it('parses the ISO timestamps admin endpoints emit', () => {
    const row = parseComplaint(raw);
    expect(row.createdAt?.toISOString()).toBe('2026-08-30T06:00:00.000Z');
    expect(row.adminResponseAt?.toISOString()).toBe('2026-09-01T10:30:00.000Z');
    expect(row.updatedAt?.toISOString()).toBe('2026-09-01T10:30:00.000Z');
  });

  it('keeps the absent values null rather than stringifying them', () => {
    const row = parseComplaint({ ...raw, userProfilePhoto: null, adminResponse: null });
    expect(row.userProfilePhoto).toBeNull();
    expect(row.adminResponse).toBeNull();
    expect(row.adminResponseAt).not.toBeNull();
  });

  it('reports the status and priority the API sent, without defaulting them again', () => {
    // An untriaged ticket has no stored status or priority and the API already
    // reports the defaults for it. Defaulting here as well would apply them
    // twice — and would hide a genuinely malformed payload.
    expect(parseComplaint({ ...raw, status: 'pending', priority: 'medium' })).toMatchObject({
      status: 'pending',
      priority: 'medium',
    });
    expect(parseComplaint({ ...raw, status: undefined, priority: undefined })).toMatchObject({
      status: '',
      priority: '',
    });
  });

  it('treats anything but a true `isRead` as unread', () => {
    expect(parseComplaint({ ...raw, isRead: false }).isRead).toBe(false);
    expect(parseComplaint({ ...raw, isRead: undefined }).isRead).toBe(false);
  });
});

describe('parseComplaintStats', () => {
  it('reads the counted buckets straight through', () => {
    expect(
      parseComplaintStats({
        total: 20,
        pending: 8,
        inProgress: 4,
        resolved: 6,
        closed: 2,
        unread: 5,
        read: 15,
        byPriority: { low: 3, medium: 12, high: 5 },
      }),
    ).toEqual({ total: 20, pending: 8, inProgress: 4, resolved: 6, closed: 2, unread: 5 });
  });

  it('falls back to zeros rather than NaN for a payload it cannot read', () => {
    expect(parseComplaintStats(undefined)).toEqual({
      total: 0,
      pending: 0,
      inProgress: 0,
      resolved: 0,
      closed: 0,
      unread: 0,
    });
  });
});
