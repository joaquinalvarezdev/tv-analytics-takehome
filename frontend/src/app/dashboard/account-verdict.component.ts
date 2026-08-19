import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import type { WeeklySummaryResponse } from '../api/generated/models/weekly-summary-response';
import {
  accountHeadline,
  insufficientHistoryReason,
  formatDeltaRatio,
  formatHumanDate,
  formatMedian,
  formatPeriodLine,
  isWeekInProgress,
} from './dashboard-formatting';
import { StatusDotComponent } from './status-dot.component';

/**
 * The hero verdict: a status dot + uppercase period line, then the large serif headline answer to "is
 * recent activity normal?", then the supporting numbers, then a quiet methodology note. This is the
 * redesign's biggest structural change from the old card-based `AccountVerdictComponent` — the verdict
 * is now the page's opening statement rather than one card among several.
 */
@Component({
  selector: 'app-account-verdict',
  imports: [StatusDotComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mb-[22px] flex items-center gap-2.5">
      <app-status-dot [status]="summary().totals.status" [baselineMedian]="summary().totals.baselineMedian" />
      <span class="text-xs tracking-[0.08em] text-ink-quiet uppercase">{{ periodLine() }}</span>
    </div>

    <h1 class="mb-5 max-w-[16ch] text-[2.5rem] leading-[1.05] font-normal text-pretty text-ink sm:text-[3.5rem]" style="font-family: var(--font-serif)">
      {{ headline() }}
    </h1>

    @if (summary().dataStatus === 'insufficientHistory') {
      <p class="mb-1.5 max-w-[52ch] text-lg leading-normal text-pretty text-ink-muted sm:text-[19px]">
        {{ summary().totals.current }} events this period.
      </p>
      <p class="max-w-[60ch] text-sm leading-relaxed text-ink-subtle">{{ historyReason() }}</p>
    } @else if (medianText(); as medianTxt) {
      <p class="mb-1.5 max-w-[52ch] text-lg leading-normal text-pretty text-ink-muted sm:text-[19px]">
        {{ summary().totals.current }} events {{ inProgress() ? 'so far' : 'this week' }}, against a usual
        {{ medianTxt }}
        @if (deltaText(); as delta) {
          ({{ delta }})
        }.
      </p>
      <p class="max-w-[60ch] text-sm leading-relaxed text-ink-subtle">{{ basisText() }}</p>
    } @else {
      <p class="max-w-[52ch] text-lg leading-normal text-pretty text-ink-muted sm:text-[19px]">
        {{ summary().totals.current }} events this period — no usual level established for this period yet.
      </p>
    }
  `,
})
export class AccountVerdictComponent {
  readonly summary = input.required<WeeklySummaryResponse>();
  /**
   * The selected account's first selectable week, used only to explain an `insufficientHistory`
   * verdict — see `insufficientHistoryReason`. Null when the account has no activity at all.
   */
  readonly firstSelectableWeekStart = input<string | null>(null);

  protected readonly historyReason = computed(() =>
    insufficientHistoryReason(this.summary().baselineWeeksUsed, this.summary().weekStart, this.firstSelectableWeekStart()),
  );

  protected readonly headline = computed(() => accountHeadline(this.summary().dataStatus, this.summary().totals.status));

  protected readonly inProgress = computed(() => isWeekInProgress(this.summary().throughDate, this.summary().weekEnd));

  protected readonly periodLine = computed(() => {
    const s = this.summary();
    return formatPeriodLine(s.weekStart, s.weekEnd, s.throughDate);
  });

  protected medianText(): string | null {
    return formatMedian(this.summary().totals.baselineMedian);
  }

  protected deltaText(): string | null {
    return formatDeltaRatio(this.summary().totals.deltaRatio);
  }

  protected basisText(): string {
    const s = this.summary();
    return this.inProgress()
      ? `Compared with the same period (through ${formatHumanDate(s.throughDate, true)}) in your previous ${s.baselineWeeksUsed} weeks — not whole weeks, since this week isn't over yet.`
      : `Compared with the median of your previous ${s.baselineWeeksUsed} weeks.`;
  }
}
