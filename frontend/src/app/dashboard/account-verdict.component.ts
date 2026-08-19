import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import type { WeeklySummaryResponse } from '../api/generated/models/weekly-summary-response';
import { accountHeadline, formatDeltaRatio, formatHumanDate, formatMedian, isWeekInProgress } from './dashboard-formatting';

/**
 * The account-level headline answer to "is recent activity normal?", plus the evidence beneath it:
 * current count vs the baseline median, the delta, and the comparison basis in words.
 */
@Component({
  selector: 'app-account-verdict',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-1">
      <p class="text-2xl font-semibold text-slate-900">{{ headline() }}</p>

      @if (summary().dataStatus === 'insufficientHistory') {
        <p class="text-sm text-slate-700">
          {{ summary().totals.current }} events this period. Only {{ summary().baselineWeeksUsed }} complete
          prior week(s) of history exist for this account — at least 4 are needed before a comparison is
          meaningful.
        </p>
      } @else if (medianText(); as medianTxt) {
        <p class="text-sm text-slate-700">
          <span class="text-base font-semibold text-slate-900">{{ summary().totals.current }}</span>
          events this period vs a usual
          <span class="text-base font-semibold text-slate-900">{{ medianTxt }}</span>
          @if (deltaText(); as delta) {
            <span> ({{ delta }})</span>
          }
        </p>
        <p class="text-xs text-slate-500">{{ basisText() }}</p>
      } @else {
        <p class="text-sm text-slate-700">
          {{ summary().totals.current }} events this period — no usual level established for this period yet.
        </p>
      }
    </div>
  `,
})
export class AccountVerdictComponent {
  readonly summary = input.required<WeeklySummaryResponse>();

  protected readonly headline = computed(() => accountHeadline(this.summary().dataStatus, this.summary().totals.status));

  protected medianText(): string | null {
    return formatMedian(this.summary().totals.baselineMedian);
  }

  protected deltaText(): string | null {
    return formatDeltaRatio(this.summary().totals.deltaRatio);
  }

  protected basisText(): string {
    const s = this.summary();
    const inProgress = isWeekInProgress(s.throughDate, s.weekEnd);
    return inProgress
      ? `Compared with the same period (through ${formatHumanDate(s.throughDate, true)}) in your previous ${s.baselineWeeksUsed} weeks — not whole weeks, since this week isn't over yet.`
      : `Compared with the median of your previous ${s.baselineWeeksUsed} weeks.`;
  }
}
