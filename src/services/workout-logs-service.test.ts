import { describe, expect, it, vi } from 'vitest';

/// The ratings parse. The page trusts these shapes, so a server that sends a
/// rating as a string, or a summary missing a star, must not reach it as NaN.

vi.mock('@/lib/firebase', () => ({ app: {}, auth: {}, db: {}, storage: {} }));
const workoutRatings = vi.fn();
const workoutLogs = vi.fn();
vi.mock('@/lib/api-client', () => ({ adminApi: { workoutRatings, workoutLogs } }));

const { fetchWorkoutRatings, fetchWorkoutLogs, ratingOf } = await import('./workout-logs-service');

const row = (over: Record<string, unknown> = {}) => ({
  id: 'P01_W01_S1',
  uid: 'u1',
  programId: 'P01',
  weekId: 'W01',
  dayId: 'S1',
  sessionName: 'Week 1 - Day 1',
  completedAt: '2026-10-21T06:29:00.000Z',
  duration: 369,
  rating: 5,
  user: { uid: 'u1', username: 'Srinidhi', email: null },
  ...over,
});

describe('ratingOf', () => {
  it('keeps a whole 1–5 and nothing else', () => {
    expect(ratingOf(5)).toBe(5);
    for (const bad of [0, 6, 2.5, '4', null, undefined]) expect(ratingOf(bad)).toBeNull();
  });
});

describe('fetchWorkoutRatings', () => {
  it('parses the summary and the rated rows', async () => {
    workoutRatings.mockResolvedValueOnce({
      summary: {
        completed: 10,
        rated: 4,
        average: 4.25,
        distribution: { '5': 2, '4': 1, '3': 1 },
        truncated: false,
      },
      rows: [row(), row({ id: 'P01_W01_S2', rating: 3 })],
    });
    const page = await fetchWorkoutRatings({});
    expect(page.summary).toEqual({
      completed: 10,
      rated: 4,
      average: 4.25,
      distribution: { '1': 0, '2': 0, '3': 1, '4': 1, '5': 2 },
      truncated: false,
    });
    expect(page.rows.map((r) => r.rating)).toEqual([5, 3]);
    expect(page.rows[0]?.user.username).toBe('Srinidhi');
  });

  it('has no average when nothing is rated, rather than a zero', async () => {
    workoutRatings.mockResolvedValueOnce({ summary: { completed: 3, rated: 0, average: null }, rows: [] });
    expect((await fetchWorkoutRatings({})).summary.average).toBeNull();
  });
});

describe('fetchWorkoutLogs', () => {
  it('carries the rating, and null for an unrated session', async () => {
    workoutLogs.mockResolvedValueOnce({ rows: [row(), row({ id: 'x', rating: undefined })], nextCursor: null });
    const page = await fetchWorkoutLogs({});
    expect(page.rows.map((r) => r.rating)).toEqual([5, null]);
  });
});
