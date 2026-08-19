import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { type ActivityStatus, describeStatus } from './dashboard-formatting';

/**
 * A status badge that never relies on colour alone: every status carries a distinct text label and
 * glyph, so the meaning survives colour-blindness, greyscale printing, and screen readers alike.
 */
@Component({
  selector: 'app-status-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span
      class="inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium"
      [class]="descriptor().toneClass"
    >
      <span aria-hidden="true">{{ descriptor().glyph }}</span>
      {{ descriptor().label }}
    </span>
  `,
})
export class StatusBadgeComponent {
  readonly status = input.required<ActivityStatus>();
  /** Distinguishes the two noVerdict cases; see `describeStatus`. */
  readonly baselineMedian = input<number | null | undefined>(null);

  protected readonly descriptor = computed(() => describeStatus(this.status(), this.baselineMedian()));
}
