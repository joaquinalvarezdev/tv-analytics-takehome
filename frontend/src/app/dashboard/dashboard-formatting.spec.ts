import { describe, expect, it } from 'vitest';

import {
  accountHeadline,
  addDaysToDateString,
  describeStatus,
  formatDeltaRatio,
  formatHumanDate,
  formatMedian,
  formatWeekRange,
  generateWeekOptions,
  isWeekInProgress,
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
