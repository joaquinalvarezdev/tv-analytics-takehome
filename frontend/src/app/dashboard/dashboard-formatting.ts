import type { MetricComparisonResponse } from '../api/generated/models/metric-comparison-response';
import type { WeeklySummaryResponse } from '../api/generated/models/weekly-summary-response';

/**
 * Derived from the generated response types rather than hand-duplicated, so a backend enum change
 * cannot silently drift out of sync with the frontend.
 */
export type ActivityStatus = MetricComparisonResponse['status'];
export type DataStatus = WeeklySummaryResponse['dataStatus'];

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface DateParts {
  year: number;
  month: number; // 1-12
  day: number;
}

/**
 * Parses a `yyyy-MM-dd` string into its calendar parts. These are account-local calendar dates from
 * the API, not instants — never run them through `new Date(dateStr)` for display, since that reads
 * the *browser's* timezone and can shift the day. All date math here stays in plain UTC-anchored
 * arithmetic purely as a calendar calculator, never for anything timezone-sensitive.
 */
function parseDateParts(dateStr: string): DateParts {
  const [year, month, day] = dateStr.split('-').map(Number);
  return { year, month, day };
}

function toDateString({ year, month, day }: DateParts): string {
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

/** Adds (or subtracts, for a negative `days`) whole days to a `yyyy-MM-dd` string. */
export function addDaysToDateString(dateStr: string, days: number): string {
  const parts = parseDateParts(dateStr);
  const utcMs = Date.UTC(parts.year, parts.month - 1, parts.day) + days * 24 * 60 * 60 * 1000;
  const shifted = new Date(utcMs);
  return toDateString({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  });
}

function weekdayName(dateStr: string): string {
  const { year, month, day } = parseDateParts(dateStr);
  return WEEKDAY_NAMES[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

/** e.g. "27 Jul 2026", or "Mon 27 Jul 2026" with `includeWeekday`. */
export function formatHumanDate(dateStr: string, includeWeekday = false): string {
  const { year, month, day } = parseDateParts(dateStr);
  const monthName = MONTH_NAMES[month - 1];
  return includeWeekday ? `${weekdayName(dateStr)} ${day} ${monthName} ${year}` : `${day} ${monthName} ${year}`;
}

/** e.g. "20–26 Jul 2026" for a week entirely inside one month; spells out both ends otherwise. */
export function formatWeekRange(weekStart: string, weekEnd: string): string {
  const start = parseDateParts(weekStart);
  const end = parseDateParts(weekEnd);
  const startMonth = MONTH_NAMES[start.month - 1];
  const endMonth = MONTH_NAMES[end.month - 1];

  if (start.year === end.year && start.month === end.month) {
    return `${start.day}–${end.day} ${endMonth} ${end.year}`;
  }
  if (start.year === end.year) {
    return `${start.day} ${startMonth} – ${end.day} ${endMonth} ${end.year}`;
  }
  return `${start.day} ${startMonth} ${start.year} – ${end.day} ${endMonth} ${end.year}`;
}

/**
 * True when the selected week is still in progress: the dataset's last local day (`throughDate`)
 * falls before the week's last day (`weekEnd`). Plain string comparison is safe and exact for
 * `yyyy-MM-dd` values — no `Date` parsing needed.
 */
export function isWeekInProgress(throughDate: string, weekEnd: string): boolean {
  return throughDate < weekEnd;
}

/**
 * Every Monday from `currentWeekStart` back to `firstSelectableWeekStart` inclusive, newest first.
 * Plain date-part arithmetic on `yyyy-MM-dd` strings, stepping back 7 days at a time — no timezone
 * logic, since both inputs are already account-local calendar dates. Returns `[]` when there is no
 * selectable history yet (`firstSelectableWeekStart` is null) or the range is empty/inverted.
 */
export function generateWeekOptions(firstSelectableWeekStart: string | null, currentWeekStart: string): string[] {
  if (firstSelectableWeekStart === null) {
    return [];
  }
  const options: string[] = [];
  let cursor = currentWeekStart;
  // yyyy-MM-dd strings compare lexicographically in calendar order, so this needs no Date parsing.
  while (cursor >= firstSelectableWeekStart) {
    options.push(cursor);
    cursor = addDaysToDateString(cursor, -7);
  }
  return options;
}

/**
 * `deltaRatio` is a fraction (0.25 === +25%), never a pre-multiplied percentage. This is the single
 * place that multiplies by 100 and formats the sign, so nothing downstream can accidentally render
 * the raw fraction as if it were already a percentage.
 */
export function formatDeltaRatio(deltaRatio: number | null | undefined): string | null {
  if (deltaRatio === null || deltaRatio === undefined) {
    return null;
  }
  // `|| 0` folds a `-0` rounding result (e.g. from -0.001) back to plain `0` so it never renders "-0%".
  const roundedPct = Math.round(deltaRatio * 100) || 0;
  const sign = roundedPct < 0 ? '−' : '+';
  return `${sign}${Math.abs(roundedPct)}%`;
}

/**
 * `baselineMedian` may be fractional (e.g. 6.5); shows one decimal only when the value actually has
 * one. Returns `null` unchanged so callers render the null/zero distinction explicitly rather than a
 * generic placeholder that would blur the two.
 */
export function formatMedian(value: number | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export interface StatusDescriptor {
  /** Short label shown in the badge; never relies on colour alone to carry meaning. */
  label: string;
  /** Text glyph (not an emoji/icon font) so meaning survives colour-blindness and screen readers. */
  glyph: string;
  toneClass: string;
}

/**
 * Maps a row/metric's status to a badge descriptor. `noVerdict` covers two distinct situations that
 * must read differently (per `MetricComparisonResponse.baselineMedian` docs): `null` baseline means no
 * baseline was computable at all (insufficient history, or no activity); `0` baseline means a baseline
 * exists and is genuinely zero — a calm, expected state, not an error.
 */
export function describeStatus(status: ActivityStatus, baselineMedian: number | null | undefined): StatusDescriptor {
  switch (status) {
    case 'above':
      return { label: 'Above normal', glyph: '▲', toneClass: 'border-amber-300 bg-amber-50 text-amber-900' };
    case 'below':
      return { label: 'Below normal', glyph: '▼', toneClass: 'border-sky-300 bg-sky-50 text-sky-900' };
    case 'typical':
      return { label: 'Typical', glyph: '●', toneClass: 'border-emerald-300 bg-emerald-50 text-emerald-900' };
    case 'noVerdict':
      return baselineMedian === null || baselineMedian === undefined
        ? { label: 'Not enough history', glyph: '?', toneClass: 'border-slate-300 bg-slate-50 text-slate-700' }
        : {
            label: 'No usual level for this period',
            glyph: '–',
            toneClass: 'border-slate-300 bg-slate-50 text-slate-700',
          };
  }
}

/**
 * The account-level headline text, driven primarily by `dataStatus` (the account-wide data
 * situation) and falling back to `status` (the account's own verdict) only once `dataStatus` is
 * `"ok"`. Kept as one pure function so headline wording can be unit-tested without a component.
 */
export function accountHeadline(dataStatus: DataStatus, status: ActivityStatus): string {
  if (dataStatus === 'noActivity') {
    return 'This account has no recorded activity.';
  }
  if (dataStatus === 'insufficientHistory') {
    return 'Not enough history to compare';
  }
  switch (status) {
    case 'above':
      return 'Activity is above normal';
    case 'below':
      return 'Activity is below normal';
    case 'typical':
      return 'Activity is normal for you';
    case 'noVerdict':
      return 'No established baseline for this period';
  }
}
