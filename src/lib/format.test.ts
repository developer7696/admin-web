import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  compactNumber,
  fmtClock12,
  fmtDate,
  fmtDateBulletTime,
  fmtDateDashed,
  fmtDateShort,
  fmtDateTime,
  fmtDayMonth,
  fmtDayMonthYear,
  fmtDayMonthYearClock,
  fmtDayMonthYearTime,
  fmtDuration,
  fmtDurationLong,
  fmtLongDateTime,
  fmtMonthDay,
  fmtMonthDayShort,
  initialsOf,
  rupees,
  rupeesFromPaise,
  timeAgo,
  timelineSubtitle,
  toDate,
  toDateInput,
  toDateOrNow,
  toDateTimeInput,
} from './format';

// 4 Mar 2026, 14:05 local time — single digits in day/hour-12 exercise padding.
const d = new Date(2026, 2, 4, 14, 5, 0);

describe('date formats', () => {
  it('renders every pattern the pages rely on', () => {
    expect(fmtMonthDay(d)).toBe('Mar 04');
    expect(fmtMonthDayShort(d)).toBe('Mar 4');
    expect(fmtDate(d)).toBe('Mar 04, 2026');
    expect(fmtDateShort(d)).toBe('Mar 4, 2026');
    expect(fmtDayMonthYear(d)).toBe('4 Mar 2026');
    expect(fmtDayMonth(d)).toBe('4 Mar');
    expect(fmtDateDashed(d)).toBe('04-03-2026');
    expect(fmtDateTime(d)).toBe('Mar 04, 2026 - 14:05');
    expect(fmtDayMonthYearTime(d)).toBe('4 Mar 2026, 14:05');
    expect(fmtDayMonthYearClock(d)).toBe('4 Mar 2026, 2:05 PM');
    expect(fmtLongDateTime(d)).toBe('March 04, 2026 • 2:05 PM');
    expect(fmtDateBulletTime(d)).toBe('Mar 4, 2026 • 02:05 PM');
  });

  it('handles the 12-hour clock edges', () => {
    expect(fmtClock12(new Date(2026, 0, 1, 0, 0))).toBe('12:00 AM');
    expect(fmtClock12(new Date(2026, 0, 1, 12, 0))).toBe('12:00 PM');
    expect(fmtClock12(new Date(2026, 0, 1, 23, 59))).toBe('11:59 PM');
  });

  it('formats input element values', () => {
    expect(toDateInput(d)).toBe('2026-03-04');
    expect(toDateTimeInput(d)).toBe('2026-03-04T14:05');
  });
});

describe('rupees', () => {
  it('divides paise by 100 and groups in the Indian style', () => {
    expect(rupeesFromPaise(123456789)).toBe('₹12,34,568');
    expect(rupeesFromPaise(99900)).toBe('₹999');
  });

  it('keeps two decimals when asked', () => {
    expect(rupeesFromPaise(123456789, { decimals: true })).toBe('₹12,34,567.89');
    expect(rupeesFromPaise(50, { decimals: true })).toBe('₹0.50');
  });

  it('renders a dash for missing amounts', () => {
    expect(rupeesFromPaise(null)).toBe('—');
    expect(rupeesFromPaise(undefined)).toBe('—');
    expect(rupees(null)).toBe('—');
  });

  it('formats whole-rupee amounts directly', () => {
    expect(rupees(1234567)).toBe('₹12,34,567');
    expect(compactNumber(1234567)).toBe('12,34,567');
  });
});

describe('durations', () => {
  it('renders mm:ss with padded seconds', () => {
    expect(fmtDuration(725)).toBe('12:05');
    expect(fmtDuration(59)).toBe('0:59');
  });

  it('renders hours only when there are any', () => {
    expect(fmtDurationLong(4320)).toBe('1h 12m');
    expect(fmtDurationLong(720)).toBe('12m');
  });
});

describe('timeAgo', () => {
  afterEach(() => vi.useRealTimers());

  it('scales from seconds to the full date', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 4, 12, 0, 0));
    const ago = (ms: number) => timeAgo(new Date(Date.now() - ms));
    expect(ago(30 * 1000)).toBe('just now');
    expect(ago(5 * 60 * 1000)).toBe('5m ago');
    expect(ago(3 * 3600 * 1000)).toBe('3h ago');
    expect(ago(2 * 86400 * 1000)).toBe('2d ago');
    expect(ago(45 * 86400 * 1000)).toBe('Jan 18, 2026');
  });
});

describe('toDate', () => {
  it('passes through valid Dates and rejects invalid ones', () => {
    expect(toDate(d)).toBe(d);
    expect(toDate(new Date('nonsense'))).toBeNull();
  });

  it('unwraps Firestore Timestamp shapes', () => {
    const viaMethod = { toDate: () => d };
    expect(toDate(viaMethod)).toBe(d);
    const viaSeconds = { _seconds: Math.floor(d.getTime() / 1000) };
    expect(toDate(viaSeconds)?.getTime()).toBe(Math.floor(d.getTime() / 1000) * 1000);
  });

  it('treats small numbers as epoch seconds and large ones as millis', () => {
    expect(toDate(1_700_000_000)?.getTime()).toBe(1_700_000_000_000);
    expect(toDate(1_700_000_000_000)?.getTime()).toBe(1_700_000_000_000);
  });

  it('parses ISO strings and rejects garbage', () => {
    expect(toDate('2026-03-04T14:05:00Z')?.toISOString()).toBe('2026-03-04T14:05:00.000Z');
    expect(toDate('not a date')).toBeNull();
    expect(toDate(null)).toBeNull();
    expect(toDate({})).toBeNull();
  });

  it('toDateOrNow falls back to now', () => {
    expect(toDateOrNow(null)).toBeInstanceOf(Date);
    expect(toDateOrNow(d)).toBe(d);
  });
});

describe('timelineSubtitle', () => {
  const from = new Date(2026, 0, 5);
  const to = new Date(2026, 1, 10);

  it('describes each filter state', () => {
    expect(timelineSubtitle({ from: null, to: null, granularity: 'day', fallbackDays: 30 }))
      .toBe('Last 30 days, per day');
    expect(timelineSubtitle({ from, to, granularity: 'day', fallbackDays: 30 }))
      .toBe('Jan 5, 2026 – Feb 10, 2026, per day');
    expect(timelineSubtitle({ from, to: null, granularity: 'month', fallbackDays: 30 }))
      .toBe('Since Jan 5, 2026, per month');
    expect(timelineSubtitle({ from: null, to, granularity: 'day', fallbackDays: 30 }))
      .toBe('Up to Feb 10, 2026, per day');
  });
});

describe('initialsOf', () => {
  it('takes the first letters of the first two words', () => {
    expect(initialsOf('Vishal Panwar')).toBe('VP');
  });

  it('falls back to the email when the name is blank', () => {
    expect(initialsOf('', 'tabletap416@gmail.com')).toBe('TG');
  });

  it('uses two letters of a single word', () => {
    expect(initialsOf('vishal')).toBe('VI');
  });

  it('answers ? when there is nothing to work with', () => {
    expect(initialsOf('', '')).toBe('?');
    expect(initialsOf('   ')).toBe('?');
  });
});
