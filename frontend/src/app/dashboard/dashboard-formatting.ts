import type { HistoricalComparisonResponse } from '../api/generated/models/historical-comparison-response';
import type { LocationSummaryResponse } from '../api/generated/models/location-summary-response';
import type { MetricComparisonResponse } from '../api/generated/models/metric-comparison-response';
import type { TypeBreakdownResponse } from '../api/generated/models/type-breakdown-response';
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
 * Label for one option in the week picker: the full Mon-Sun range rather than the bare start date,
 * so the control reads as "which period am I looking at" instead of a static timestamp. Built from
 * the existing range/step helpers — no new date maths.
 */
export function weekOptionLabel(weekStart: string, inProgress: boolean): string {
  const label = formatWeekRange(weekStart, addDaysToDateString(weekStart, 6));
  return inProgress ? `${label} (in progress)` : label;
}

/** One month's worth of week options, so a long week list stays scannable in a native `<optgroup>`. */
export interface WeekOptionGroup {
  readonly label: string;
  readonly weeks: readonly { readonly value: string; readonly label: string }[];
}

/**
 * Groups week options under their starting month.
 *
 * Weeks are chosen chronologically, never by text search — substring-matching a date is meaningless
 * (typing "3" would match 13 Jul, 31 May, 3 May and 23 Feb alike), so this feeds an ordered
 * `<select>` rather than a type-to-filter box. Grouping by month keeps ~27 options navigable.
 * A week straddling a month boundary is filed under the month it starts in.
 */
export function groupWeekOptionsByMonth(weeks: readonly string[]): WeekOptionGroup[] {
  const groups: { label: string; weeks: { value: string; label: string }[] }[] = [];

  weeks.forEach((week, index) => {
    const { year, month } = parseDateParts(week);
    const groupLabel = `${MONTH_NAMES[month - 1]} ${year}`;
    // Index 0 is the newest week, which is the in-progress one.
    const option = { value: week, label: weekOptionLabel(week, index === 0) };

    const current = groups[groups.length - 1];
    if (current && current.label === groupLabel) {
      current.weeks.push(option);
    } else {
      groups.push({ label: groupLabel, weeks: [option] });
    }
  });

  return groups;
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

export type RowTone = 'flagged' | 'calm' | 'muted';

/**
 * Maps a status to a visual tone for a bar/dot row. `flagged` (above/below) always gets a distinct
 * font-weight/shape treatment on top of colour — see the row components — so the flagged/unflagged
 * distinction never depends on colour perception alone.
 */
export function rowTone(status: ActivityStatus): RowTone {
  if (status === 'above' || status === 'below') {
    return 'flagged';
  }
  return status === 'typical' ? 'calm' : 'muted';
}

/**
 * Label for one `HistoricalComparisonResponse` window: a single date when the window is a partial
 * elapsed window (`throughDate === weekStart`, e.g. every window behind an in-progress current
 * week), or a week range otherwise. Delegates entirely to the existing date-formatting helpers — no
 * new date arithmetic.
 */
export function formatHistoryWindowLabel(window: Pick<HistoricalComparisonResponse, 'weekStart' | 'throughDate'>): string {
  return window.throughDate === window.weekStart
    ? formatHumanDate(window.weekStart)
    : formatWeekRange(window.weekStart, window.throughDate);
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  call_received: 'Calls',
  lead_created: 'Leads',
  appointment_set: 'Appointments',
};

/**
 * Human label for a raw `eventType` key (e.g. `call_received` → `Calls`). Falls back to a generic
 * humanization for any type not in the known set, so a future event type never renders blank. The
 * single mapping used everywhere an event type is shown, so the account-wide breakdown, each
 * location's "why" detail, and the "largest change" line never drift out of sync with each other.
 */
export function eventTypeLabel(eventType: string): string {
  return EVENT_TYPE_LABELS[eventType] ?? eventType.replace(/_/g, ' ');
}

/**
 * The single event type that moved the most, as `|current − baselineMedian|`, among `byType`.
 * Types with a null baseline are skipped (no basis for comparison). Returns `null` — deliberately,
 * so callers show nothing rather than a misleading pick — when no type has a non-zero change, or
 * when the largest change is tied between two or more types. Never implies *why* the number moved,
 * only *which* type moved most; callers must not editorialize beyond that.
 */
export function largestChangeType(byType: TypeBreakdownResponse[]): string | null {
  // flatMap rather than filter+map so the null check actually narrows the type — `.filter()` can't
  // carry that narrowing through, which is what would otherwise force an `as number` cast here.
  const changes = byType
    .flatMap((row) =>
      row.baselineMedian === null || row.baselineMedian === undefined
        ? []
        : [{ eventType: row.eventType, change: Math.abs(row.current - row.baselineMedian) }],
    )
    .filter((row) => row.change > 0);

  if (changes.length === 0) {
    return null;
  }

  const maxChange = Math.max(...changes.map((row) => row.change));
  const winners = changes.filter((row) => row.change === maxChange);
  return winners.length === 1 ? winners[0].eventType : null;
}

/**
 * Locations whose verdict needs a human look — `below` or `above` — in the exact order the API
 * already returned them (worst-first). Never re-sorts. Excludes `typical` (nothing to flag) and
 * `noVerdict` (no baseline exists yet to judge against, so it isn't "needs attention" — it belongs
 * only in the full locations table).
 */
export function filterNeedsAttention(locations: LocationSummaryResponse[]): LocationSummaryResponse[] {
  return locations.filter((loc) => loc.total.status === 'below' || loc.total.status === 'above');
}

/**
 * The hero's uppercase period line: the week range plus whether it is in progress (and, if so,
 * through which day) or complete. e.g. "20–26 Jul 2026 · complete" or
 * "27 Jul – 2 Aug 2026 · in progress · through Mon 27 Jul 2026".
 */
export function formatPeriodLine(weekStart: string, weekEnd: string, throughDate: string): string {
  const range = formatWeekRange(weekStart, weekEnd);
  return isWeekInProgress(throughDate, weekEnd)
    ? `${range} · in progress · through ${formatHumanDate(throughDate, true)}`
    : `${range} · complete`;
}

export interface BarGeometry {
  /** Fill width as a percentage of the row group's `max`, clamped to [0, 100]. */
  readonly widthPct: number;
  /** Median-tick position as a percentage of the same `max`, or `null` when no baseline exists to mark. */
  readonly tickPct: number | null;
}

/**
 * Bar fill width and median-tick position for one row, both expressed as percentages of `max` — the
 * largest value across the whole row group (e.g. every type's current/usual together), so bars stay
 * visually comparable within that group rather than each being scaled to itself.
 *
 * `max <= 0` (an all-zero group) returns a zero-width bar and no tick rather than dividing by zero.
 * A `baselineMedian` of `null`/`undefined` returns `tickPct: null` — distinct from a real `0` median,
 * which still gets a tick at position 0.
 */
export function barGeometry(current: number, baselineMedian: number | null | undefined, max: number): BarGeometry {
  if (max <= 0) {
    return { widthPct: 0, tickPct: null };
  }
  const widthPct = Math.max(0, Math.min(100, (current / max) * 100));
  const tickPct =
    baselineMedian === null || baselineMedian === undefined
      ? null
      : Math.max(0, Math.min(100, (baselineMedian / max) * 100));
  return { widthPct, tickPct };
}

export interface TrendBar {
  /** Compact axis label, e.g. "6 Apr" — kept short so nine columns fit without scrolling. */
  readonly label: string;
  /** The window's full human range, for the tooltip and the chart's accessible table. */
  readonly fullLabel: string;
  readonly value: number;
  readonly heightPct: number;
  readonly isNow: boolean;
}

export interface TrendChart {
  /** Oldest window first, ending with the current period ("now"). */
  readonly bars: readonly TrendBar[];
  /** Dashed median-line position as a percentage of chart height, or `null` when no baseline exists
   *  (`insufficientHistory`) — distinct from a real `0` median, which still draws a line at the base. */
  readonly medianPct: number | null;
}

/**
 * The comparison-history bar chart's geometry: `comparisonHistory` (most-recent-first, per its own
 * doc comment) reversed into chronological order with the current period appended as the highlighted
 * "now" bar, each scaled against the tallest value in the set — including the median itself, so the
 * dashed line never draws above the tallest bar.
 */
/**
 * A compact axis label for one chart column: day + short month, e.g. "6 Apr".
 *
 * The chart shows nine columns side by side, so a full range ("27 Apr – 3 May 2026") forces each
 * column wider than the card and pushes the most important bar — "now" — out of view behind a
 * horizontal scroll. The full range stays available in the chart's accessible table and each
 * column's tooltip; the axis only needs enough to place the window in time.
 */
export function formatAxisDate(dateStr: string): string {
  const { month, day } = parseDateParts(dateStr);
  return `${day} ${MONTH_NAMES[month - 1]}`;
}

export function buildTrendChart(
  history: readonly HistoricalComparisonResponse[],
  currentTotal: number,
  weekInProgress: boolean,
  baselineMedian: number | null | undefined,
): TrendChart {
  const points = [...history].reverse().map((window) => ({
    label: formatAxisDate(window.weekStart),
    fullLabel: formatHistoryWindowLabel(window),
    value: window.total,
    isNow: false,
  }));
  points.push({
    label: weekInProgress ? 'So far' : 'This week',
    fullLabel: weekInProgress ? 'This week so far' : 'This week',
    value: currentTotal,
    isNow: true,
  });

  const max = Math.max(1, ...points.map((p) => p.value), baselineMedian ?? 0);
  const bars = points.map((p) => ({ ...p, heightPct: Math.max(4, Math.round((p.value / max) * 100)) }));
  const medianPct =
    baselineMedian === null || baselineMedian === undefined
      ? null
      : Math.max(0, Math.min(100, (baselineMedian / max) * 100));

  return { bars, medianPct };
}

/**
 * The "Why?" explanation sentence for one location row — plain language grounded in the row's real
 * `status`/`current`/`baselineMedian`, never a recomputation of the above/below threshold itself
 * (that stays exclusively the backend's call; recreating it client-side would risk silently drifting
 * from what "normal" actually means). `noVerdict` gets a calm, non-alarming sentence that still
 * distinguishes a null baseline (no history yet) from a genuine zero baseline.
 */
export function describeLocationWhy(loc: LocationSummaryResponse): string {
  const { current, baselineMedian, status } = loc.total;

  if (status === 'noVerdict') {
    return baselineMedian === null || baselineMedian === undefined
      ? `Not enough history yet to say what's usual for ${loc.location} in this period.`
      : `${loc.location} has no usual level to compare against for this period — its baseline is zero.`;
  }

  const medianTxt = formatMedian(baselineMedian) ?? '0';
  const gap = Math.abs(current - (baselineMedian ?? 0));
  const gapWord = `${gap} event${gap === 1 ? '' : 's'}`;

  if (status === 'typical') {
    return `${loc.location} ran ${current} events against a usual ${medianTxt}. The gap is ${gapWord}, under the 25%-and-3-event threshold, so it reads as ordinary week-to-week movement.`;
  }
  return `${loc.location} ran ${current} events against a usual ${medianTxt}. That clears both flags — at least 25% off usual and at least 3 events — so it's called out as a real change rather than noise.`;
}

/**
 * The "N need(s) attention" / "none need attention" caption shown next to the locations list header.
 * `null` while `dataStatus` isn't `"ok"`: with fewer than 4 baseline weeks every location's verdict is
 * `noVerdict` by construction (no baseline to judge against), so "none need attention" would read as a
 * real all-clear when it's actually "we can't tell yet" — the caption says nothing instead of lying.
 */
export function locationsAttentionCaption(locations: LocationSummaryResponse[], dataStatus: DataStatus): string | null {
  if (dataStatus !== 'ok') {
    return null;
  }
  const count = filterNeedsAttention(locations).length;
  return count === 0 ? 'none need attention' : `${count} need${count === 1 ? 's' : ''} attention`;
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
