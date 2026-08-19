import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, type ParamMap } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { vi } from 'vitest';

import {
  DashboardQueryParamsService,
  parseAccountParam,
  parseWeekStartParam,
} from './dashboard-query-params.service';

describe('parseAccountParam', () => {
  it('returns null when the param is absent', () => {
    expect(parseAccountParam(null)).toBeNull();
  });

  it('returns null for a non-numeric value', () => {
    expect(parseAccountParam('abc')).toBeNull();
  });

  it('returns null for a non-integer value', () => {
    expect(parseAccountParam('6.5')).toBeNull();
  });

  it('returns null for a non-positive value', () => {
    expect(parseAccountParam('0')).toBeNull();
    expect(parseAccountParam('-3')).toBeNull();
  });

  it('parses a valid positive integer', () => {
    expect(parseAccountParam('6')).toBe(6);
  });
});

describe('parseWeekStartParam', () => {
  it('returns null when the param is absent', () => {
    expect(parseWeekStartParam(null)).toBeNull();
  });

  it('returns null for a malformed date string', () => {
    expect(parseWeekStartParam('06-01-2026')).toBeNull();
    expect(parseWeekStartParam('not-a-date')).toBeNull();
  });

  it('returns null for a calendar date that does not exist', () => {
    expect(parseWeekStartParam('2026-02-30')).toBeNull();
  });

  it('parses a valid yyyy-MM-dd string', () => {
    expect(parseWeekStartParam('2026-06-01')).toBe('2026-06-01');
  });
});

describe('DashboardQueryParamsService', () => {
  let queryParamMap$: BehaviorSubject<ParamMap>;
  let navigate: ReturnType<typeof vi.fn>;

  function setUrlParams(params: Record<string, string | null>): void {
    const current = queryParamMap$.value;
    const merged: Record<string, string> = {};
    for (const key of current.keys) {
      const value = current.get(key);
      if (value !== null) {
        merged[key] = value;
      }
    }
    for (const [key, value] of Object.entries(params)) {
      if (value === null) {
        delete merged[key];
      } else {
        merged[key] = value;
      }
    }
    queryParamMap$.next(convertToParamMap(merged));
  }

  beforeEach(() => {
    queryParamMap$ = new BehaviorSubject<ParamMap>(convertToParamMap({}));

    // navigate() simulates what the real Router would do to the URL: merge
    // the given query params and let queryParamMap re-emit, so the round
    // trip (write via the service -> read back from the signal) is real.
    navigate = vi.fn((_commands: unknown[], extras?: { queryParams?: Record<string, string | null> }) => {
      setUrlParams(extras?.queryParams ?? {});
      return Promise.resolve(true);
    });

    TestBed.configureTestingModule({
      providers: [
        { provide: Router, useValue: { navigate } },
        {
          provide: ActivatedRoute,
          useValue: {
            queryParamMap: queryParamMap$.asObservable(),
            snapshot: { queryParamMap: queryParamMap$.value },
          },
        },
      ],
    });
  });

  it('exposes null for both params when the URL has none', () => {
    const service = TestBed.inject(DashboardQueryParamsService);

    expect(service.account()).toBeNull();
    expect(service.weekStart()).toBeNull();
  });

  it('exposes null when the URL carries an invalid value', () => {
    setUrlParams({ account: 'not-a-number', weekStart: '2026-99-99' });
    const service = TestBed.inject(DashboardQueryParamsService);

    expect(service.account()).toBeNull();
    expect(service.weekStart()).toBeNull();
  });

  it('sets account and week in one navigation, so neither change is lost', () => {
    // Regression guard. Switching account must also clear the week (a week valid for one account may
    // not exist for another). Doing that as setAccount() then setWeekStart() silently dropped the
    // account: Router.navigate is async, so the second call merged its params against the URL as it
    // was *before* the first navigation committed. Account switching was broken this way from the
    // dashboard's first commit until a browser caught it — every unit test passed throughout,
    // because each call is correct in isolation.
    const service = TestBed.inject(DashboardQueryParamsService);
    setUrlParams({ weekStart: '2026-06-01' });

    service.setAccountAndWeek(8, null);

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        queryParams: { account: '8', weekStart: null },
        queryParamsHandling: 'merge',
      }),
    );
    expect(service.account()).toBe(8);
    expect(service.weekStart()).toBeNull();
  });

  it('round-trips setAccount through the URL back into the signal', () => {
    const service = TestBed.inject(DashboardQueryParamsService);

    service.setAccount(6);

    expect(navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        queryParams: { account: '6' },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      }),
    );
    expect(service.account()).toBe(6);
  });

  it('round-trips setWeekStart without clobbering an already-set account', () => {
    const service = TestBed.inject(DashboardQueryParamsService);

    service.setAccount(6);
    service.setWeekStart('2026-06-01');

    expect(service.account()).toBe(6);
    expect(service.weekStart()).toBe('2026-06-01');
  });

  it('clears a param by writing null', () => {
    const service = TestBed.inject(DashboardQueryParamsService);

    service.setAccount(6);
    service.setAccount(null);

    expect(service.account()).toBeNull();
  });
});
