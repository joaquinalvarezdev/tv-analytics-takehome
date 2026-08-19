import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { AccountVerdictComponent } from './account-verdict.component';
import { AccountWeekControlsComponent } from './account-week-controls.component';
import { CalculationExplainerComponent } from './calculation-explainer.component';
import { formatHumanDate, isWeekInProgress } from './dashboard-formatting';
import { LocationsTableComponent } from './locations-table.component';
import { TypeBreakdownTableComponent } from './type-breakdown-table.component';
import { WeeklySummaryDataService } from './weekly-summary-data.service';

/**
 * The dashboard page. Answers, top to bottom: is recent activity normal (the headline verdict),
 * which location needs attention (the locations table), and why (the per-type "why?" detail and the
 * calculation explainer). All API integration lives in `WeeklySummaryDataService` — this component
 * only composes presentation components around its signals.
 */
@Component({
  selector: 'app-dashboard-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AccountWeekControlsComponent,
    AccountVerdictComponent,
    TypeBreakdownTableComponent,
    LocationsTableComponent,
    CalculationExplainerComponent,
  ],
  template: `
    <main class="mx-auto max-w-4xl space-y-6 p-6">
      <header class="space-y-4">
        <h1 class="text-2xl font-semibold text-slate-900">Relay dashboard</h1>

        @if (data.accountsError(); as err) {
          <div role="alert" class="flex items-center gap-3 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900">
            <p>Couldn't load accounts: {{ err }}</p>
            <button
              type="button"
              class="rounded border border-red-400 px-2 py-1 text-xs font-medium hover:bg-red-100"
              (click)="data.retryAccounts()"
            >
              Retry
            </button>
          </div>
        } @else {
          <app-account-week-controls
            [accounts]="data.accounts()"
            [accountId]="data.accountId()"
            [selectedAccount]="data.selectedAccount()"
          />
        }
      </header>

      <section aria-live="polite" class="space-y-6">
        @if (data.summaryLoading()) {
          <p class="text-sm text-slate-500">Loading weekly summary…</p>
        } @else if (data.summaryError(); as err) {
          <div role="alert" class="space-y-2 rounded border border-red-300 bg-red-50 p-4 text-sm text-red-900">
            <p>Couldn't load the weekly summary: {{ err }}</p>
            <button
              type="button"
              class="rounded border border-red-400 px-3 py-1 text-xs font-medium hover:bg-red-100"
              (click)="data.retrySummary()"
            >
              Retry
            </button>
          </div>
        } @else if (data.summary(); as summary) {
          <p class="text-sm text-slate-600">
            Data through {{ formatHumanDate(summary.throughDate, true) }}
            @if (isWeekInProgress(summary.throughDate, summary.weekEnd)) {
              <span
                class="ml-1 inline-flex items-center rounded-full border border-indigo-300 bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-900"
              >
                In progress
              </span>
            }
          </p>

          @if (summary.dataStatus === 'noActivity') {
            <p class="rounded border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              This account has no recorded activity.
            </p>
          } @else {
            <app-account-verdict [summary]="summary" />

            <div>
              <h2 class="mb-2 text-base font-medium text-slate-900">By event type</h2>
              <app-type-breakdown-table [rows]="summary.byType" caption="Account-wide breakdown by event type" />
            </div>

            <div>
              <h2 class="mb-2 text-base font-medium text-slate-900">Locations</h2>
              <app-locations-table [locations]="summary.locations" />
            </div>

            <app-calculation-explainer />
          }
        }
      </section>
    </main>
  `,
})
export class DashboardShellComponent {
  protected readonly data = inject(WeeklySummaryDataService);

  protected readonly formatHumanDate = formatHumanDate;
  protected readonly isWeekInProgress = isWeekInProgress;
}
