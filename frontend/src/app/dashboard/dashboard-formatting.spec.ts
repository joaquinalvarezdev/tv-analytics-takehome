import { describe, expect, it } from 'vitest';

import type { LocationSummaryResponse } from '../api/generated/models/location-summary-response';
import type { TypeBreakdownResponse } from '../api/generated/models/type-breakdown-response';
import {
  accountHeadline,
  addDaysToDateString,
  barGeometry,
  buildTrendChart,
  describeLocationWhy,
  describeStatus,
  eventTypeLabel,
  filterNeedsAttention,
  formatDeltaRatio,
  formatHistoryWindowLabel,
  formatHumanDate,
  formatMedian,
  formatPeriodLine,
  formatWeekRange,
  generateWeekOptions,
  isWeekInProgress,
  largestChangeType,
  locationsAttentionCaption,
  rowTone,
  weekOptionLabel,
  groupWeekOptionsByMonth,
} from './dashboard-formatting';

describe('formatDeltaRatio', () => {
  it('renders +25% for a 0.25 fraction, not "0.25%"', () => {
    // This is the bug class the spec explicitly calls out: deltaRatio is a fraction, not a
    // pre-multiplied percentage. Getting the *100 wrong here would ship a real, confusing bug.
    expect(formatDeltaRatio(0.25)).toBe('+25%');
  });

  it('renders a minus sign for a negative fraction', () => {
    expect(formatDeltaRatio(-0.3333333333333333)).toBe('−33%');
  });

  it('renders no percentage at all when deltaRatio is null', () => {
    expect(formatDeltaRatio(null)).toBeNull();
  });

  it('treats undefined the same as null', () => {
    expect(formatDeltaRatio(undefined)).toBeNull();
  });

  it('rounds to the nearest whole percent', () => {
    expect(formatDeltaRatio(1)).toBe('+100%');
    expect(formatDeltaRatio(0.005)).toBe('+1%');
  });

  it('never renders "-0%" for a rounding result of negative zero', () => {
    expect(formatDeltaRatio(-0.001)).toBe('+0%');
  });

  it('renders +0% for an exact zero delta', () => {
    expect(formatDeltaRatio(0)).toBe('+0%');
  });
});

describe('formatMedian', () => {
  it('shows no decimal for a whole number', () => {
    expect(formatMedian(10)).toBe('10');
  });

  it('shows one decimal for a fractional median', () => {
    expect(formatMedian(6.5)).toBe('6.5');
  });

  it('returns null (not "0" or "-") for a null median, leaving the null/zero distinction to the caller', () => {
    expect(formatMedian(null)).toBeNull();
  });

  it('formats a genuine zero median as "0", distinct from null', () => {
    expect(formatMedian(0)).toBe('0');
  });
});

describe('describeStatus', () => {
  it('labels above/below/typical without relying on the caller for status text', () => {
    expect(describeStatus('above', 10).label).toBe('Above normal');
    expect(describeStatus('below', 10).label).toBe('Below normal');
    expect(describeStatus('typical', 10).label).toBe('Typical');
  });

  it('distinguishes noVerdict with a null baseline (no history) from a zero baseline (genuinely quiet)', () => {
    const noHistory = describeStatus('noVerdict', null);
    const zeroBaseline = describeStatus('noVerdict', 0);

    expect(noHistory.label).toBe('Not enough history');
    expect(zeroBaseline.label).toBe('No usual level for this period');
    expect(noHistory.label).not.toBe(zeroBaseline.label);
  });

  it('every status carries a distinct glyph, not colour alone', () => {
    const glyphs = new Set(
      [describeStatus('above', 1), describeStatus('below', 1), describeStatus('typical', 1), describeStatus('noVerdict', 0)].map(
        (d) => d.glyph,
      ),
    );
    expect(glyphs.size).toBe(4);
  });
});

describe('accountHeadline', () => {
  it('reports no recorded activity for dataStatus noActivity, regardless of status', () => {
    expect(accountHeadline('noActivity', 'noVerdict')).toBe('This account has no recorded activity.');
  });

  it('reports insufficient history distinctly from noActivity', () => {
    const insufficient = accountHeadline('insufficientHistory', 'noVerdict');
    expect(insufficient).toBe('Not enough history to compare');
    expect(insufficient).not.toBe(accountHeadline('noActivity', 'noVerdict'));
  });

  it('reports the plain-language verdict when dataStatus is ok', () => {
    expect(accountHeadline('ok', 'above')).toBe('Activity is above normal');
    expect(accountHeadline('ok', 'below')).toBe('Activity is below normal');
    expect(accountHeadline('ok', 'typical')).toBe('Activity is normal for you');
  });

  it('reports "no established baseline" (not an error) for an ok account with a zero-baseline noVerdict', () => {
    const headline = accountHeadline('ok', 'noVerdict');
    expect(headline).toBe('No established baseline for this period');
    expect(headline).not.toBe(accountHeadline('insufficientHistory', 'noVerdict'));
  });
});

describe('generateWeekOptions', () => {
  it('returns an empty list when there is no selectable history', () => {
    expect(generateWeekOptions(null, '2026-07-27')).toEqual([]);
  });

  it('steps back 7 days at a time from currentWeekStart to firstSelectableWeekStart, newest first', () => {
    expect(generateWeekOptions('2026-07-13', '2026-07-27')).toEqual(['2026-07-27', '2026-07-20', '2026-07-13']);
  });

  it('returns a single option when first and current week starts are the same Monday', () => {
    expect(generateWeekOptions('2026-07-27', '2026-07-27')).toEqual(['2026-07-27']);
  });

  it('crosses a month boundary correctly', () => {
    expect(generateWeekOptions('2026-01-26', '2026-02-09')).toEqual(['2026-02-09', '2026-02-02', '2026-01-26']);
  });

  it('returns an empty list defensively when the range is inverted', () => {
    expect(generateWeekOptions('2026-08-01', '2026-07-01')).toEqual([]);
  });
});

describe('addDaysToDateString', () => {
  it('adds days across a month boundary', () => {
    expect(addDaysToDateString('2026-01-30', 7)).toBe('2026-02-06');
  });

  it('subtracts days across a year boundary', () => {
    expect(addDaysToDateString('2026-01-03', -7)).toBe('2025-12-27');
  });

  it('is unaffected by DST transitions since it never reads local time', () => {
    // 2026-03-08 is the US spring-forward date; a naive local-time implementation could drop or
    // duplicate a day here.
    expect(addDaysToDateString('2026-03-02', 7)).toBe('2026-03-09');
  });
});

describe('formatHumanDate', () => {
  it('formats a date without a weekday by default', () => {
    expect(formatHumanDate('2026-07-27')).toBe('27 Jul 2026');
  });

  it('includes the weekday when requested', () => {
    expect(formatHumanDate('2026-07-27', true)).toBe('Mon 27 Jul 2026');
  });
});

describe('formatWeekRange', () => {
  it('formats a week entirely within one month compactly', () => {
    expect(formatWeekRange('2026-07-20', '2026-07-26')).toBe('20–26 Jul 2026');
  });

  it('spells out both months when the week crosses a month boundary', () => {
    expect(formatWeekRange('2026-07-27', '2026-08-02')).toBe('27 Jul – 2 Aug 2026');
  });
});

describe('isWeekInProgress', () => {
  it('is true when the dataset ends before the week is over', () => {
    expect(isWeekInProgress('2026-07-27', '2026-08-02')).toBe(true);
  });

  it('is false for a fully completed week', () => {
    expect(isWeekInProgress('2026-07-26', '2026-07-26')).toBe(false);
  });
});

describe('formatHistoryWindowLabel', () => {
  it('renders a single date when the window is a partial elapsed window', () => {
    expect(formatHistoryWindowLabel({ weekStart: '2026-07-27', throughDate: '2026-07-27' })).toBe('27 Jul 2026');
  });

  it('renders a week range when the window spans a full week', () => {
    expect(formatHistoryWindowLabel({ weekStart: '2026-07-20', throughDate: '2026-07-26' })).toBe('20–26 Jul 2026');
  });
});

describe('eventTypeLabel', () => {
  it('maps the three known raw event types to their human labels', () => {
    expect(eventTypeLabel('call_received')).toBe('Calls');
    expect(eventTypeLabel('lead_created')).toBe('Leads');
    expect(eventTypeLabel('appointment_set')).toBe('Appointments');
  });

  it('falls back to a humanized form for an unmapped event type rather than rendering blank', () => {
    expect(eventTypeLabel('some_new_type')).toBe('some new type');
  });
});

function typeRow(eventType: string, current: number, baselineMedian: number | null): TypeBreakdownResponse {
  return { eventType, current, baselineMedian };
}

describe('largestChangeType', () => {
  it('picks the type with the largest absolute change', () => {
    const byType = [typeRow('call_received', 7, 11), typeRow('lead_created', 3, 4), typeRow('appointment_set', 9, 10)];
    // |7-11|=4, |3-4|=1, |9-10|=1 -> call_received wins unambiguously.
    expect(largestChangeType(byType)).toBe('call_received');
  });

  it('returns null when the top two changes are tied', () => {
    const byType = [typeRow('call_received', 8, 5), typeRow('lead_created', 1, 4), typeRow('appointment_set', 10, 10)];
    // |8-5|=3, |1-4|=3 -> tied for largest, no unambiguous winner.
    expect(largestChangeType(byType)).toBeNull();
  });

  it('returns null when nothing changed', () => {
    const byType = [typeRow('call_received', 5, 5), typeRow('lead_created', 2, 2)];
    expect(largestChangeType(byType)).toBeNull();
  });

  it('ignores types with a null baseline', () => {
    const byType = [typeRow('call_received', 5, 5), typeRow('lead_created', 9, null)];
    // lead_created has no baseline to compare against, so despite being the only row with data it
    // must not be picked; the remaining row has zero change, so the result is null.
    expect(largestChangeType(byType)).toBeNull();
  });

  it('picks the sole remaining type once null-baseline types are excluded', () => {
    const byType = [typeRow('call_received', 5, 5), typeRow('lead_created', 9, null), typeRow('appointment_set', 12, 8)];
    expect(largestChangeType(byType)).toBe('appointment_set');
  });
});

function locationWith(status: 'below' | 'above' | 'typical' | 'noVerdict', location: string = status): LocationSummaryResponse {
  return {
    location,
    byType: [],
    total: { status, current: 1, baselineMedian: status === 'noVerdict' ? null : 1, deltaRatio: status === 'noVerdict' ? null : 0 },
  };
}

describe('filterNeedsAttention', () => {
  it('keeps only below/above locations and preserves the API order', () => {
    const locations = [
      locationWith('below', 'Site A'),
      locationWith('above', 'Site B'),
      locationWith('typical', 'Site C'),
      locationWith('below', 'Site D'),
    ];
    expect(filterNeedsAttention(locations).map((l) => l.location)).toEqual(['Site A', 'Site B', 'Site D']);
  });

  it('excludes typical and noVerdict locations', () => {
    const locations = [locationWith('typical', 'Site A'), locationWith('noVerdict', 'Site B')];
    expect(filterNeedsAttention(locations)).toEqual([]);
  });

  it('returns an empty list when there are no locations', () => {
    expect(filterNeedsAttention([])).toEqual([]);
  });
});

describe('weekOptionLabel', () => {
  it('labels a week as its full Mon-Sun range, not the bare start date', () => {
    // The bare start date ("13 Jul 2026") reads as a static timestamp; the range reads as a period.
    expect(weekOptionLabel('2026-07-13', false)).toBe('13–19 Jul 2026');
  });

  it('spells out both months when the week straddles a month boundary', () => {
    expect(weekOptionLabel('2026-06-29', false)).toBe('29 Jun – 5 Jul 2026');
  });

  it('marks the in-progress week so a partial period is never mistaken for a complete one', () => {
    expect(weekOptionLabel('2026-07-27', true)).toBe('27 Jul – 2 Aug 2026 (in progress)');
  });
});

describe('groupWeekOptionsByMonth', () => {
  const weeks = ['2026-07-27', '2026-07-20', '2026-07-06', '2026-06-29', '2026-06-22'];

  it('groups weeks under their starting month, preserving the newest-first order', () => {
    const groups = groupWeekOptionsByMonth(weeks);

    expect(groups.map((g) => g.label)).toEqual(['Jul 2026', 'Jun 2026']);
    expect(groups[0].weeks.map((w) => w.value)).toEqual(['2026-07-27', '2026-07-20', '2026-07-06']);
    expect(groups[1].weeks.map((w) => w.value)).toEqual(['2026-06-29', '2026-06-22']);
  });

  it('files a month-straddling week under the month it starts in', () => {
    // 29 Jun - 5 Jul belongs to Jun, not Jul. Passed as the *second* week so the assertion is about
    // grouping alone and not entangled with the in-progress marker the newest week always carries.
    const groups = groupWeekOptionsByMonth(['2026-07-06', '2026-06-29']);

    expect(groups.map((g) => g.label)).toEqual(['Jul 2026', 'Jun 2026']);
    expect(groups[1].weeks[0].label).toBe('29 Jun – 5 Jul 2026');
  });

  it('marks only the newest week as in progress', () => {
    const groups = groupWeekOptionsByMonth(weeks);
    const labels = groups.flatMap((g) => g.weeks.map((w) => w.label));

    expect(labels.filter((l) => l.includes('(in progress)'))).toHaveLength(1);
    expect(labels[0]).toContain('(in progress)');
  });

  it('returns no groups when the account has no selectable weeks', () => {
    expect(groupWeekOptionsByMonth([])).toEqual([]);
  });
});

describe('formatPeriodLine', () => {
  it('marks a completed week as complete, with no through-date clause', () => {
    expect(formatPeriodLine('2026-07-20', '2026-07-26', '2026-07-26')).toBe('20–26 Jul 2026 · complete');
  });

  it('marks an in-progress week with the elapsed through-date', () => {
    expect(formatPeriodLine('2026-07-27', '2026-08-02', '2026-07-27')).toBe(
      '27 Jul – 2 Aug 2026 · in progress · through Mon 27 Jul 2026',
    );
  });
});

describe('barGeometry', () => {
  it('gives a zero-width bar for a zero value, with the median tick still placed', () => {
    expect(barGeometry(0, 5, 10)).toEqual({ widthPct: 0, tickPct: 50 });
  });

  it('clamps a value above the median (and above max) to 100%', () => {
    // current === max here, since max is computed as the largest value in the row group.
    expect(barGeometry(15, 10, 15)).toEqual({ widthPct: 100, tickPct: (10 / 15) * 100 });
  });

  it('omits the tick entirely for a null median, distinct from a tick at 0', () => {
    expect(barGeometry(5, null, 10)).toEqual({ widthPct: 50, tickPct: null });
  });

  it('places a tick at 0 for a genuine zero median, distinct from a null median', () => {
    expect(barGeometry(5, 0, 10)).toEqual({ widthPct: 50, tickPct: 0 });
  });

  it('never divides by zero for an all-zero row group', () => {
    expect(barGeometry(0, 0, 0)).toEqual({ widthPct: 0, tickPct: null });
  });
});

describe('buildTrendChart', () => {
  const history = [
    { weekStart: '2026-07-13', throughDate: '2026-07-19', total: 12 },
    { weekStart: '2026-07-06', throughDate: '2026-07-12', total: 10 },
  ];

  it('reverses comparisonHistory (most-recent-first) into chronological order, ending with "now"', () => {
    const chart = buildTrendChart(history, 8, false, 10);
    expect(chart.bars.map((b) => b.value)).toEqual([10, 12, 8]);
    expect(chart.bars.map((b) => b.isNow)).toEqual([false, false, true]);
    expect(chart.bars.at(-1)?.label).toBe('This week');
  });

  it('labels the current bar "So far" while the week is in progress', () => {
    const chart = buildTrendChart(history, 8, true, 10);
    expect(chart.bars.at(-1)?.label).toBe('So far');
  });

  it('omits the median line for a null baseline (insufficientHistory), distinct from a 0 baseline', () => {
    expect(buildTrendChart(history, 8, false, null).medianPct).toBeNull();
    expect(buildTrendChart(history, 8, false, 0).medianPct).toBe(0);
  });

  it('scales the median against the tallest bar, including when the median itself is the tallest value', () => {
    const chart = buildTrendChart(history, 5, false, 20);
    expect(chart.medianPct).toBe(100);
    expect(Math.max(...chart.bars.map((b) => b.heightPct))).toBeLessThan(100);
  });
});

function locationDetail(
  status: 'below' | 'above' | 'typical' | 'noVerdict',
  current: number,
  baselineMedian: number | null,
  location = 'Site A',
): LocationSummaryResponse {
  return {
    location,
    byType: [],
    total: { status, current, baselineMedian, deltaRatio: status === 'noVerdict' ? null : (current - (baselineMedian ?? 0)) / (baselineMedian || 1) },
  };
}

describe('describeLocationWhy', () => {
  it('explains a flagged location in terms of the real threshold, without recomputing it', () => {
    const why = describeLocationWhy(locationDetail('above', 15, 8));
    expect(why).toContain('Site A ran 15 events against a usual 8');
    expect(why).toContain('at least 25% off usual and at least 3 events');
  });

  it('explains a typical location by the gap falling under the floor', () => {
    const why = describeLocationWhy(locationDetail('typical', 9, 8));
    expect(why).toContain('The gap is 1 event,');
    expect(why).toContain('under the 25%-and-3-event threshold');
  });

  it('distinguishes a null baseline (no history) from a genuine zero baseline for noVerdict', () => {
    const noHistory = describeLocationWhy(locationDetail('noVerdict', 5, null));
    const zeroBaseline = describeLocationWhy(locationDetail('noVerdict', 5, 0));
    expect(noHistory).toContain('Not enough history yet');
    expect(zeroBaseline).toContain('its baseline is zero');
    expect(noHistory).not.toBe(zeroBaseline);
  });

  it('pluralizes the gap correctly for a single-event difference vs. several', () => {
    expect(describeLocationWhy(locationDetail('typical', 9, 8))).toContain('1 event,');
    expect(describeLocationWhy(locationDetail('typical', 6, 8))).toContain('2 events,');
  });
});

describe('locationsAttentionCaption', () => {
  it('returns null (says nothing) while dataStatus is not "ok"', () => {
    const locations = [locationWith('above', 'Site A')];
    expect(locationsAttentionCaption(locations, 'insufficientHistory')).toBeNull();
    expect(locationsAttentionCaption(locations, 'noActivity')).toBeNull();
  });

  it('reports "none need attention" for zero flagged locations', () => {
    const locations = [locationWith('typical', 'Site A'), locationWith('noVerdict', 'Site B')];
    expect(locationsAttentionCaption(locations, 'ok')).toBe('none need attention');
  });

  it('singularizes for exactly one flagged location', () => {
    const locations = [locationWith('above', 'Site A'), locationWith('typical', 'Site B')];
    expect(locationsAttentionCaption(locations, 'ok')).toBe('1 needs attention');
  });

  it('pluralizes for more than one flagged location', () => {
    const locations = [locationWith('above', 'Site A'), locationWith('below', 'Site B')];
    expect(locationsAttentionCaption(locations, 'ok')).toBe('2 need attention');
  });
});

describe('rowTone', () => {
  it('gives above/below their own "flagged" tone, distinct from colour alone', () => {
    expect(rowTone('above')).toBe('flagged');
    expect(rowTone('below')).toBe('flagged');
  });

  it('gives typical a calm tone and noVerdict a muted tone', () => {
    expect(rowTone('typical')).toBe('calm');
    expect(rowTone('noVerdict')).toBe('muted');
  });
});
