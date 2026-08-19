import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { describeStatus, rowTone, type ActivityStatus } from './dashboard-formatting';

/**
 * The small status dot used in the hero verdict and each location row. Colour alone never carries the
 * meaning: a flagged (above/below) dot also gets a visible ring so the flagged/unflagged distinction
 * survives greyscale, and every dot carries an `sr-only` status word for screen readers.
 */
@Component({
  selector: 'app-status-dot',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="inline-flex items-center">
      <span class="inline-block h-[7px] w-[7px] rounded-full" [class]="dotClass()" aria-hidden="true"></span>
      <span class="sr-only">{{ descriptor().label }}</span>
    </span>
  `,
})
export class StatusDotComponent {
  readonly status = input.required<ActivityStatus>();
  /** Distinguishes the two noVerdict cases; see `describeStatus`. */
  readonly baselineMedian = input<number | null | undefined>(null);

  protected readonly descriptor = computed(() => describeStatus(this.status(), this.baselineMedian()));

  protected readonly dotClass = computed(() => {
    switch (rowTone(this.status())) {
      case 'flagged':
        return 'bg-accent ring-2 ring-accent-soft';
      case 'muted':
        return 'bg-muted-soft';
      case 'calm':
      default:
        return 'bg-calm-faint';
    }
  });
}
