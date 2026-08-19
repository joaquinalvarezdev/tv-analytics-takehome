import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, effect, inject, signal } from '@angular/core';

import { Api } from '../api/generated/api';
import { getAccounts } from '../api/generated/fn/weekly-summary-endpoints/get-accounts';
import { getWeeklySummary } from '../api/generated/fn/weekly-summary-endpoints/get-weekly-summary';
import type { AccountResponse } from '../api/generated/models/account-response';
import type { ProblemDetails } from '../api/generated/models/problem-details';
import type { WeeklySummaryResponse } from '../api/generated/models/weekly-summary-response';
import { DashboardQueryParamsService } from './dashboard-query-params.service';

/**
 * The demo/dev account switcher's default when the URL carries no `account` param. In production
 * this whole picker goes away and the account is resolved server-side from the authenticated
 * principal — see the accounts endpoint's Swagger description.
 */
export const DEFAULT_ACCOUNT_ID = 1;

/** Turns an HttpClient failure into a message fit to show a user, preferring the API's own detail. */
function describeError(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    const problem = err.error as ProblemDetails | null;
    if (problem?.detail) {
      return problem.detail;
    }
    if (problem?.title) {
      return problem.title;
    }
    if (err.status === 0) {
      return 'Could not reach the server. Check that the API is running and try again.';
    }
    return `Request failed (HTTP ${err.status}).`;
  }
  return 'Something went wrong. Please try again.';
}

/**
 * Wraps the generated OpenAPI client with the data access this dashboard needs, exposing state as
 * signals (data / loading / error) so presentation components never talk to HttpClient directly.
 *
 * Fetches `GET /api/accounts` once on construction, and refetches `GET /api/accounts/{id}/weekly-summary`
 * whenever the effective account id or the URL's `weekStart` changes (both sourced from
 * `DashboardQueryParamsService`).
 */
@Injectable({ providedIn: 'root' })
export class WeeklySummaryDataService {
  private readonly api = inject(Api);
  private readonly queryParams = inject(DashboardQueryParamsService);

  private readonly accountsState = signal<AccountResponse[] | null>(null);
  private readonly accountsLoadingState = signal(false);
  private readonly accountsErrorState = signal<string | null>(null);

  readonly accounts = this.accountsState.asReadonly();
  readonly accountsLoading = this.accountsLoadingState.asReadonly();
  readonly accountsError = this.accountsErrorState.asReadonly();

  private readonly summaryState = signal<WeeklySummaryResponse | null>(null);
  private readonly summaryLoadingState = signal(false);
  private readonly summaryErrorState = signal<string | null>(null);

  readonly summary = this.summaryState.asReadonly();
  readonly summaryLoading = this.summaryLoadingState.asReadonly();
  readonly summaryError = this.summaryErrorState.asReadonly();

  /** No `account` in the URL → default to the demo account (id 1), per the ticket's selection rules. */
  readonly accountId = computed(() => this.queryParams.account() ?? DEFAULT_ACCOUNT_ID);

  /** The selected account's row from the accounts list (name, timezone, selectable week range). */
  readonly selectedAccount = computed(() => this.accountsState()?.find((a) => a.id === this.accountId()) ?? null);

  /** Guards against an in-flight request for a stale account/week landing after a newer one. */
  private summaryRequestToken = 0;

  constructor() {
    void this.loadAccounts();

    effect(() => {
      const accountId = this.accountId();
      const weekStart = this.queryParams.weekStart();
      void this.loadSummary(accountId, weekStart);
    });
  }

  retryAccounts(): void {
    void this.loadAccounts();
  }

  retrySummary(): void {
    void this.loadSummary(this.accountId(), this.queryParams.weekStart());
  }

  private async loadAccounts(): Promise<void> {
    this.accountsLoadingState.set(true);
    this.accountsErrorState.set(null);
    try {
      const accounts = await this.api.invoke(getAccounts, {});
      this.accountsState.set(accounts);
    } catch (err) {
      this.accountsState.set(null);
      this.accountsErrorState.set(describeError(err));
    } finally {
      this.accountsLoadingState.set(false);
    }
  }

  private async loadSummary(accountId: number, weekStart: string | null): Promise<void> {
    const token = ++this.summaryRequestToken;
    this.summaryLoadingState.set(true);
    this.summaryErrorState.set(null);
    try {
      // No weekStart in the URL → omit the query param entirely; the API defaults to the current
      // (in-progress) week itself, so the frontend never reimplements that default.
      const summary = await this.api.invoke(getWeeklySummary, {
        id: accountId,
        weekStart: weekStart ?? undefined,
      });
      if (token !== this.summaryRequestToken) {
        return; // A newer request has already started; drop this stale response.
      }
      this.summaryState.set(summary);
    } catch (err) {
      if (token !== this.summaryRequestToken) {
        return;
      }
      this.summaryState.set(null);
      this.summaryErrorState.set(describeError(err));
    } finally {
      if (token === this.summaryRequestToken) {
        this.summaryLoadingState.set(false);
      }
    }
  }
}
