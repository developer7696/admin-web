/// Date/number formatting used across the panel. Mirrors the `DateFormat`
/// patterns the Flutter pages used, so exported CSVs and table cells read the
/// same as before.

const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const pad = (n: number) => String(n).padStart(2, '0');

/** `MMM dd` → "Mar 04" */
export const fmtMonthDay = (d: Date) => `${MONTHS_SHORT[d.getMonth()]} ${pad(d.getDate())}`;

/** `MMM d` → "Mar 4" */
export const fmtMonthDayShort = (d: Date) => `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;

/** `MMM dd, yyyy` → "Mar 04, 2026" */
export const fmtDate = (d: Date) => `${fmtMonthDay(d)}, ${d.getFullYear()}`;

/** `MMM d, yyyy` → "Mar 4, 2026" */
export const fmtDateShort = (d: Date) => `${fmtMonthDayShort(d)}, ${d.getFullYear()}`;

/** `d MMM yyyy` → "4 Mar 2026" */
export const fmtDayMonthYear = (d: Date) =>
  `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;

/** `d MMM` → "4 Mar" */
export const fmtDayMonth = (d: Date) => `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;

/** `dd-MM-yyyy` → "04-03-2026" */
export const fmtDateDashed = (d: Date) =>
  `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;

/** `MMM dd, yyyy - HH:mm` → "Mar 04, 2026 - 14:05" */
export const fmtDateTime = (d: Date) => `${fmtDate(d)} - ${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** `d MMM yyyy, HH:mm` → "4 Mar 2026, 14:05" */
export const fmtDayMonthYearTime = (d: Date) =>
  `${fmtDayMonthYear(d)}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** 12-hour clock → "2:05 PM" */
export function fmtClock12(d: Date): string {
  const h24 = d.getHours();
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${pad(d.getMinutes())} ${h24 < 12 ? 'AM' : 'PM'}`;
}

/** `d MMM yyyy, h:mm a` → "4 Mar 2026, 2:05 PM" */
export const fmtDayMonthYearClock = (d: Date) => `${fmtDayMonthYear(d)}, ${fmtClock12(d)}`;

/** `MMMM dd, yyyy • h:mm a` → "March 04, 2026 • 2:05 PM" */
export const fmtLongDateTime = (d: Date) =>
  `${MONTHS_LONG[d.getMonth()]} ${pad(d.getDate())}, ${d.getFullYear()} • ${fmtClock12(d)}`;

/** `MMM d, yyyy • hh:mm a` → "Mar 4, 2026 • 02:05 PM" */
export const fmtDateBulletTime = (d: Date) => {
  const h24 = d.getHours();
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${fmtDateShort(d)} • ${pad(h)}:${pad(d.getMinutes())} ${h24 < 12 ? 'AM' : 'PM'}`;
};

/** Coarse "how long ago", for activity feeds. */
export function timeAgo(d: Date): string {
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return fmtDate(d);
}

/// Rupees from paise. The backend and Razorpay both work in paise; every amount
/// crossing into the UI goes through here so no page invents its own divisor.
export function rupeesFromPaise(paise: number | null | undefined, opts?: { decimals?: boolean }): string {
  if (paise == null) return '—';
  const rupees = paise / 100;
  return `₹${rupees.toLocaleString('en-IN', {
    minimumFractionDigits: opts?.decimals ? 2 : 0,
    maximumFractionDigits: opts?.decimals ? 2 : 0,
  })}`;
}

export function rupees(amount: number | null | undefined): string {
  if (amount == null) return '—';
  return `₹${amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

export const compactNumber = (n: number) => n.toLocaleString('en-IN');

/** Seconds → "12:05". */
export function fmtDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${pad(s)}`;
}

/** Seconds → "1h 12m" / "12m". */
export function fmtDurationLong(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/// Firestore Timestamps, ISO strings and epoch millis all reach the UI from
/// different code paths; normalise once here rather than at 40 call sites.
export function toDate(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'object' && 'toDate' in value && typeof (value as { toDate: unknown }).toDate === 'function') {
    try {
      return (value as { toDate: () => Date }).toDate();
    } catch {
      return null;
    }
  }
  if (typeof value === 'object' && '_seconds' in value) {
    const s = (value as { _seconds: unknown })._seconds;
    if (typeof s === 'number') return new Date(s * 1000);
  }
  if (typeof value === 'number') return new Date(value < 1e12 ? value * 1000 : value);
  if (typeof value === 'string') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** `toDate` with a hard fallback to now, matching VoucherModel._date. */
export const toDateOrNow = (value: unknown): Date => toDate(value) ?? new Date();

/// How a dashboard's signup chart describes its own x-axis. The window follows
/// the date filter and rolls up to months past a quarter, so the label is
/// derived rather than hardcoded — one place, so two dashboards cannot describe
/// the same axis differently.
export function timelineSubtitle(args: {
  from: Date | null;
  to: Date | null;
  granularity: 'day' | 'month';
  fallbackDays: number;
}): string {
  const unit = args.granularity === 'month' ? 'per month' : 'per day';
  if (args.from == null && args.to == null) return `Last ${args.fallbackDays} days, ${unit}`;
  if (args.from != null && args.to != null) {
    return `${fmtDateShort(args.from)} – ${fmtDateShort(args.to)}, ${unit}`;
  }
  if (args.from != null) return `Since ${fmtDateShort(args.from)}, ${unit}`;
  return `Up to ${fmtDateShort(args.to as Date)}, ${unit}`;
}

/** `<input type="date">` value for a Date. */
export const toDateInput = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** `<input type="datetime-local">` value for a Date. */
export const toDateTimeInput = (d: Date) =>
  `${toDateInput(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

export const initialsOf = (name: string, email = ''): string => {
  const src = name.trim() || email.trim();
  if (!src) return '?';
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
};
