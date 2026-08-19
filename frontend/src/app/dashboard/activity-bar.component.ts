import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import type { RowTone } from './dashboard-formatting';

/**
 * A horizontal bar with an optional median-tick mark: current value as a filled bar against a track,
 * plus a small vertical tick showing where "usual" sits, so current-vs-usual reads visually as well as
 * numerically. The one place this markup exists — reused by both the type list and the location list,
 * which is exactly the genuine duplication worth extracting.
 *
 * Purely decorative: the row that hosts this always prints the same current/usual/change values as
 * text right next to it, so the bar itself is `aria-hidden`. The one true *chart* in this dashboard —
 * the multi-period comparison chart — carries its own accessible text alternative separately.
 */
@Component({
  selector: 'app-activity-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="relative h-2 rounded-full bg-track" aria-hidden="true">
      <div class="absolute inset-y-0 left-0 rounded-full" [class]="fillClass()" [style.width.%]="widthPct()"></div>
      @if (tickPct() !== null) {
        <!-- Explicit null check, not truthy: a tick at exactly 0% (a genuine zero median) must still
             render — collapsing that with "no tick" would erase the null-vs-zero distinction. -->
        <div class="absolute -top-[3px] -bottom-[3px] w-0.5 bg-ink-dim" [style.left.%]="tickPct()"></div>
      }
    </div>
  `,
})
export class ActivityBarComponent {
  readonly widthPct = input.required<number>();
  readonly tickPct = input<number | null>(null);
  readonly tone = input<RowTone>('calm');

  protected readonly fillClass = computed(() => {
    switch (this.tone()) {
      case 'flagged':
        return 'bg-accent';
      case 'muted':
        return 'bg-muted-soft';
      case 'calm':
      default:
        return 'bg-calm-soft';
    }
  });
}
