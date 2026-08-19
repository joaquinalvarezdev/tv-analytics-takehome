import { Injectable, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';

/**
 * yyyy-MM-dd, e.g. 2026-06-01. Deliberately simple (no time component) because
 * weekStart always refers to a calendar day, never a moment in time.
 */
const WEEK_START_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parses the `account` query param into a positive integer, or `null` when
 * absent/invalid. Never throws and never produces `NaN`.
 */
export function parseAccountParam(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') {
    return null;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    return null;
  }
  return value;
}

/**
 * Parses the `weekStart` query param into a `yyyy-MM-dd` string, or `null`
 * when absent/invalid. Validates both the shape and that the date actually
 * exists (rejects e.g. 2026-02-30).
 */
export function parseWeekStartParam(raw: string | null): string | null {
  if (raw === null || !WEEK_START_PATTERN.test(raw)) {
    return null;
  }
  const [year, month, day] = raw.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const isRealDate =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return isRealDate ? raw : null;
}

/**
 * Exposes the dashboard's user-controlled state (`account`, `weekStart`) as
 * signals backed by the URL query string, so the selection survives reload
 * and is shareable via link. Reads are derived from the router's
 * `queryParamMap` observable via `toSignal`; writes go back through the
 * `Router` with `queryParamsHandling: 'merge'` (so the two params never
 * clobber each other or any future param) and `replaceUrl: true` (so
 * switching account/week doesn't spam the browser history stack).
 */
@Injectable({ providedIn: 'root' })
export class DashboardQueryParamsService {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  private readonly queryParamMap = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });

  readonly account = computed(() => parseAccountParam(this.queryParamMap().get('account')));
  readonly weekStart = computed(() => parseWeekStartParam(this.queryParamMap().get('weekStart')));

  setAccount(account: number | null): void {
    this.updateQueryParams({ account: account === null ? null : String(account) });
  }

  setWeekStart(weekStart: string | null): void {
    this.updateQueryParams({ weekStart });
  }

  private updateQueryParams(queryParams: Record<string, string | null>): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
