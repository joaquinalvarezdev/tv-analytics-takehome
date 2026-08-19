import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import type { TypeBreakdownResponse } from '../api/generated/models/type-breakdown-response';
import { ActivityBarComponent } from './activity-bar.component';
import { barGeometry, eventTypeLabel, formatMedian } from './dashboard-formatting';

interface TypeRow {
  readonly eventType: string;
  readonly label: string;
  readonly current: number;
  readonly usualText: string | null;
  readonly widthPct: number;
  readonly tickPct: number | null;
}

/**
 * "By event type": current-vs-usual for each event type, as a bar with a median tick.
 *
 * Deliberately renders every bar in one neutral tone rather than colouring "flagged" types the way
 * the design's demo data does — `TypeBreakdownResponse` carries no `status` field (see its doc
 * comment: "Carries no independent status"), so there is no real above/below verdict to colour by
 * here. Recomputing the above/below threshold client-side just to colour a bar would risk silently
 * drifting from the backend's actual classification (which also special-cases a zero baseline as
 * `noVerdict`, not "flagged") — exactly the kind of "what normal means" duplication this project rules
 * out. Per-type flagging still shows up precisely where it belongs: `describeLocationWhy` and each
 * location's own verdict.
 */
@Component({
  selector: 'app-type-breakdown-list',
  imports: [ActivityBarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section aria-labelledby="type-breakdown-heading">
      <h2 id="type-breakdown-heading" class="mb-5 text-[13px] font-semibold tracking-wide text-ink-soft uppercase">
        By event type
      </h2>
      @if (rows().length === 0) {
        <p class="text-sm text-ink-subtle">No event types recorded for this period.</p>
      } @else {
        <ul class="flex flex-col gap-[22px]">
          @for (row of typeRows(); track row.eventType) {
            <li>
              <div class="mb-[9px] flex items-baseline justify-between gap-3">
                <span class="text-[15px]">{{ row.label }}</span>
                <span class="text-[15px] tabular-nums">
                  <b class="font-semibold">{{ row.current }}</b>
                  <span class="text-[13px] text-ink-ghost">
                    {{ row.usualText ? ' vs ' + row.usualText + ' usual' : ' · not enough history' }}
                  </span>
                </span>
              </div>
              <app-activity-bar [widthPct]="row.widthPct" [tickPct]="row.tickPct" tone="calm" />
            </li>
          }
        </ul>
      }
    </section>
  `,
})
export class TypeBreakdownListComponent {
  readonly rows = input.required<TypeBreakdownResponse[]>();

  protected readonly typeRows = computed<TypeRow[]>(() => {
    const rows = this.rows();
    const max = Math.max(1, ...rows.flatMap((r) => [r.current, r.baselineMedian ?? 0]));
    return rows.map((row) => {
      const geometry = barGeometry(row.current, row.baselineMedian, max);
      return {
        eventType: row.eventType,
        label: eventTypeLabel(row.eventType),
        current: row.current,
        usualText: formatMedian(row.baselineMedian),
        widthPct: geometry.widthPct,
        tickPct: geometry.tickPct,
      };
    });
  });
}
