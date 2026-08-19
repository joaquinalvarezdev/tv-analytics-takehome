import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import type { HistoricalComparisonResponse } from '../api/generated/models/historical-comparison-response';
import { buildTrendChart, formatMedian } from './dashboard-formatting';

/**
 * The comparison-history bar chart: one bar per historical window plus a final highlighted "now" bar,
 * with a dashed median reference line labelled "usual N" — the single biggest change in this redesign,
 * turning "trust the median" into "see the samples". Replaces the old collapsed
 * `<details>`-based `ComparisonHistoryComponent` disclosure with an always-visible chart.
 *
 * The bars themselves are `aria-hidden`: a visually-hidden list right below carries the exact same
 * window/value pairs as real markup, so the chart has a genuine text alternative rather than relying
 * on a single summarizing `aria-label`.
 *
 * `baselineMedian` of `null` (insufficientHistory) omits the dashed line entirely; `0` (a genuine zero
 * baseline) still draws it flush with the chart's base — the two must never look the same.
 */
@Component({
  selector: 'app-comparison-history',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (history().length > 0) {
      <div class="mt-14 rounded-[10px] border border-border bg-surface px-5 pt-7 pb-6 sm:px-[30px]">
        <div class="mb-6 flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1">
          <h2 class="text-[13px] font-semibold tracking-wide text-ink-soft uppercase">
            {{ history().length }} comparable period{{ history().length === 1 ? '' : 's' }}
          </h2>
          <span class="text-[12.5px] text-ink-dim">{{ captionText() }}</span>
        </div>

        <!--
          The median-label gutter is a separate flex sibling, deliberately OUTSIDE the scrollable plot
          area below — so on narrow viewports it never scrolls out from under the label, and the label
          can never collide with a bar's value text because it lives in its own reserved column, exactly
          the way the original design reserves a 70px right-hand gutter for it.

          The bar row needs real per-bar width to stay legible (9 date labels never fit 390px
          gracefully), so the plot area itself scrolls horizontally *inside this card* rather than
          ever widening the page — the page must never scroll sideways.
        -->
        <div class="flex" aria-hidden="true">
          <div class="min-w-0 flex-1 overflow-x-auto">
            <div class="relative min-w-[420px] sm:min-w-0">
              @if (chart().medianPct !== null) {
                <!--
                  z-0, behind the bars (which sit in the z-10 row below): opaque bars occlude the line
                  naturally wherever they cross it, instead of the line drawing over their content.
                -->
                <div
                  class="pointer-events-none absolute inset-x-0 z-0 border-t border-dashed border-median-line"
                  [style.bottom.%]="chart().medianPct"
                ></div>
              }
              <div class="relative z-10 flex h-[150px] items-end gap-2 sm:h-[186px] sm:gap-3">
                @for (bar of chart().bars; track $index) {
                  <div class="flex h-full min-w-0 flex-1 flex-col items-center justify-end" [title]="bar.fullLabel">
                    <!--
                      bg-surface (matching the card behind it) + horizontal padding: wherever this
                      label happens to sit at the median line's height, its own opaque patch occludes
                      the dashed line passing behind it instead of the line striking through the digits.
                    -->
                    <div
                      class="z-10 mb-1.5 bg-surface px-1 text-[11px] sm:mb-[7px] sm:text-xs"
                      [class]="bar.isNow ? 'font-semibold text-ink' : 'text-ink-ghost'"
                    >
                      {{ bar.value }}
                    </div>
                    <div
                      class="w-full max-w-[38px] rounded-t-[3px]"
                      [class]="bar.isNow ? (flagged() ? 'bg-accent' : 'bg-calm') : 'bg-bar-quiet'"
                      [style.height.%]="bar.heightPct"
                    ></div>
                    <div
                      class="mt-2 h-[18px] max-w-full truncate text-[11px] leading-[18px] whitespace-nowrap"
                      [class]="bar.isNow ? 'text-ink-muted' : 'text-ink-whisper'"
                    >
                      {{ bar.label }}
                    </div>
                  </div>
                }
              </div>
            </div>
          </div>

          @if (chart().medianPct !== null) {
            <div class="relative h-[150px] w-[52px] shrink-0 sm:h-[186px] sm:w-16">
              <div
                class="absolute left-0 -translate-y-1/2 pl-2 text-[11px] leading-[14px] whitespace-nowrap text-ink-dim"
                [style.bottom.%]="chart().medianPct"
              >
                usual {{ medianLabel() }}
              </div>
            </div>
          }
        </div>

        <!--
          A plain visually-hidden list, not a table: a table with table-layout auto ignores the
          sr-only utility's explicit width of 1px and keeps its full min-content width for layout
          purposes even while visually clipped, which was quietly widening the page's scrollable area
          on narrow viewports. A list has no such quirk.
        -->
        <ul class="sr-only">
          <li>Activity by period, oldest first, ending with the current period:</li>
          @for (bar of chart().bars; track $index) {
            <li>{{ bar.isNow ? 'Current period (' + bar.label + ')' : bar.label }}: {{ bar.value }} events</li>
          }
          @if (medianLabel(); as median) {
            <li>Usual (median): {{ median }} events</li>
          }
        </ul>
      </div>
    }
  `,
})
export class ComparisonHistoryComponent {
  readonly history = input.required<HistoricalComparisonResponse[]>();
  /** `totals.baselineMedian` — `null` (e.g. `insufficientHistory`) omits the dashed median line. */
  readonly baselineMedian = input<number | null | undefined>(null);
  readonly currentTotal = input.required<number>();
  /** Whether the reported week is still in progress, so the "now" bar and caption read correctly. */
  readonly weekInProgress = input.required<boolean>();
  /** Whether the current period's own verdict is above/below normal, so the "now" bar can be
   *  highlighted the same way a flagged location or type would be. */
  readonly flagged = input(false);

  protected readonly chart = computed(() =>
    buildTrendChart(this.history(), this.currentTotal(), this.weekInProgress(), this.baselineMedian()),
  );

  protected readonly medianLabel = computed(() => formatMedian(this.baselineMedian()));

  protected readonly captionText = computed(() =>
    this.weekInProgress()
      ? 'each covering the same elapsed part of its week'
      : 'each a complete week',
  );
}
