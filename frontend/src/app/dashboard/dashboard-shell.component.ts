import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { AccountVerdictComponent } from './account-verdict.component';
import { AccountWeekControlsComponent } from './account-week-controls.component';
import { CalculationExplainerComponent } from './calculation-explainer.component';
import { ComparisonHistoryComponent } from './comparison-history.component';
import { isWeekInProgress } from './dashboard-formatting';
import { LocationsListComponent } from './locations-list.component';
import { TypeBreakdownListComponent } from './type-breakdown-list.component';
import { WeeklySummaryDataService } from './weekly-summary-data.service';

/**
 * The dashboard page. Answers, top to bottom: is recent activity normal (the hero verdict, then the
 * comparison-history chart backing it up visually), which location needs attention (the locations
 * list, worst-first), and why (each location's own "Why?" toggle, plus the calculation explainer at
 * the foot of the page). All API integration lives in `WeeklySummaryDataService` — this component only
 * composes presentation components around its signals, matching the editorial layout from the
 * redesign: warm canvas, serif headline, generous whitespace, slim top bar.
 */
@Component({
  selector: 'app-dashboard-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AccountWeekControlsComponent,
    AccountVerdictComponent,
    ComparisonHistoryComponent,
    TypeBreakdownListComponent,
    LocationsListComponent,
    CalculationExplainerComponent,
  ],
  template: `
    <div class="min-h-screen bg-canvas font-sans text-ink antialiased">
      <header class="border-b border-border bg-surface">
        <div class="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-4 px-5 py-3.5 sm:px-10">
          <span class="text-[19px] tracking-wide" style="font-family: var(--font-serif)">Relay</span>

          @if (data.accountsError(); as err) {
            <div role="alert" class="flex items-center gap-3 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-900">
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
        </div>
      </header>

      <main class="mx-auto max-w-4xl px-5 pt-14 pb-20 sm:px-10 sm:pt-16">
        <section aria-live="polite">
          @if (data.summaryLoading()) {
            <p class="text-sm text-ink-subtle">Loading weekly summary…</p>
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
            @if (summary.dataStatus === 'noActivity') {
              <div class="flex items-center gap-2.5">
                <span class="inline-block h-[7px] w-[7px] rounded-full bg-muted-soft" aria-hidden="true"></span>
                <span class="text-xs tracking-[0.08em] text-ink-quiet uppercase">No activity recorded</span>
              </div>
              <h1
                class="mt-[22px] max-w-[16ch] text-[2.25rem] leading-[1.1] font-normal text-ink sm:text-5xl"
                style="font-family: var(--font-serif)"
              >
                This account has no recorded activity
              </h1>
              <p class="mt-5 max-w-[52ch] text-lg text-ink-muted">
                There is nothing to compare yet — activity will appear here once events are recorded.
              </p>
            } @else {
              <app-account-verdict
                [summary]="summary"
                [firstSelectableWeekStart]="data.selectedAccount()?.firstSelectableWeekStart ?? null"
              />

              <app-comparison-history
                [history]="summary.comparisonHistory"
                [baselineMedian]="summary.totals.baselineMedian"
                [currentTotal]="summary.totals.current"
                [weekInProgress]="isWeekInProgress(summary.throughDate, summary.weekEnd)"
                [flagged]="summary.totals.status === 'above' || summary.totals.status === 'below'"
              />

              <div class="mt-16 grid grid-cols-1 items-start gap-10 sm:grid-cols-[1fr_1.45fr] sm:gap-[52px]">
                <app-type-breakdown-list [rows]="summary.byType" />
                <app-locations-list [locations]="summary.locations" [dataStatus]="summary.dataStatus" />
              </div>

              <div class="mt-16 space-y-5 border-t border-border pt-6">
                <!--
                  The account picker in the header is a demo control, not real auth — reviewers switch
                  accounts, so this stays a plain, always-visible sentence (not a tooltip or hover-only
                  aside) rather than something a reader could miss.
                -->
                <p class="max-w-[60ch] text-[13px] leading-relaxed text-ink-quiet">
                  The account picker above stands in for the signed-in account. In production it would
                  be resolved from the authenticated user, not a client-supplied picker.
                </p>
                <app-calculation-explainer />
              </div>
            }
          }
        </section>
      </main>
    </div>
  `,
})
export class DashboardShellComponent {
  protected readonly data = inject(WeeklySummaryDataService);

  protected readonly isWeekInProgress = isWeekInProgress;
}
