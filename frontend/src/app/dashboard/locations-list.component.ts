import { ChangeDetectionStrategy, Component, computed, effect, input, signal } from '@angular/core';

import type { LocationSummaryResponse } from '../api/generated/models/location-summary-response';
import { ActivityBarComponent } from './activity-bar.component';
import type { DataStatus } from './dashboard-formatting';
import {
  barGeometry,
  describeLocationWhy,
  eventTypeLabel,
  formatDeltaRatio,
  formatMedian,
  largestChangeType,
  locationsAttentionCaption,
  rowTone,
} from './dashboard-formatting';
import { StatusDotComponent } from './status-dot.component';

interface LocationRow {
  readonly location: string;
  readonly status: LocationSummaryResponse['total']['status'];
  readonly baselineMedian: number | null | undefined;
  readonly current: number;
  readonly countsText: string;
  readonly changeText: string;
  readonly widthPct: number;
  readonly tickPct: number | null;
  readonly flagged: boolean;
  readonly why: string;
  /** The event type that moved most, already humanised; null when there is no clear single mover. */
  readonly largestChange: string | null;
  readonly types: readonly { readonly label: string; readonly current: number; readonly usualText: string }[];
}

/**
 * The largest-moving event type for a location, humanised, or null when there is no single clear
 * mover. Answers "what changed there?" without ever asserting *why* it changed — Relay has no basis
 * for a causal claim, so the wording stays "Largest change: Calls", never "caused by".
 */
function largestChangeMover(loc: LocationSummaryResponse): string | null {
  const key = largestChangeType(loc.byType);
  return key === null ? null : eventTypeLabel(key);
}

/**
 * The full "Locations" list — one row per location, in the exact worst-first order the API already
 * returns (never re-sorted here), each with a bar-with-median-tick, the raw counts, the change
 * percentage, and a keyboard-operable "Why?" disclosure. The "N need attention" caption folds in what
 * used to be a separate `NeedsAttentionComponent` summary block — the redesign treats it as one list,
 * not a summary-plus-detail pair.
 *
 * `noVerdict` rows (no baseline to judge against) render in the same calm, muted tone as `typical` —
 * never styled like an error — with their own explanation via `describeLocationWhy`.
 */
@Component({
  selector: 'app-locations-list',
  imports: [ActivityBarComponent, StatusDotComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section aria-labelledby="locations-heading">
      <div class="mb-5 flex items-baseline justify-between gap-4">
        <h2 id="locations-heading" class="text-[13px] font-semibold tracking-wide text-ink-soft uppercase">
          Locations
        </h2>
        @if (attentionCaption(); as caption) {
          <span class="text-[12.5px] text-ink-dim">{{ caption }}</span>
        }
      </div>

      @if (locations().length === 0) {
        <p class="text-sm text-ink-subtle">No locations to show.</p>
      } @else {
        <ul class="flex flex-col">
          @for (row of locationRows(); track row.location; let idx = $index) {
            <li class="border-t border-border-soft py-3.5 last:border-b">
              <div class="flex flex-wrap items-center gap-x-4 gap-y-2 sm:flex-nowrap">
                <app-status-dot [status]="row.status" [baselineMedian]="row.baselineMedian" />
                <span
                  class="w-24 shrink-0 truncate text-[15px]"
                  [class.font-semibold]="row.flagged"
                  [title]="row.location"
                >
                  {{ row.location }}
                </span>
                <div class="order-last w-full min-w-[120px] flex-1 basis-full sm:order-none sm:basis-auto">
                  <app-activity-bar
                    [widthPct]="row.widthPct"
                    [tickPct]="row.tickPct"
                    [tone]="row.flagged ? 'flagged' : rowTone(row.status)"
                  />
                </div>
                <span class="shrink-0 text-right text-sm text-ink-soft tabular-nums">{{ row.countsText }}</span>
                <span
                  class="w-14 shrink-0 text-right text-sm tabular-nums"
                  [class]="row.flagged ? 'font-medium text-accent-strong' : 'text-ink-dim'"
                >
                  {{ row.changeText }}
                </span>
                <button
                  type="button"
                  class="shrink-0 rounded px-1 py-1 text-[13px] text-accent hover:underline"
                  [attr.aria-expanded]="isOpen(row.location)"
                  [attr.aria-controls]="whyId(idx)"
                  (click)="toggle(row.location)"
                >
                  {{ isOpen(row.location) ? 'Close' : 'Why?' }}
                </button>
              </div>
              @if (isOpen(row.location)) {
                <div [id]="whyId(idx)" class="mt-2 pl-[23px]">
                  <p class="max-w-[62ch] text-[13.5px] leading-relaxed text-ink-faint">{{ row.why }}</p>
                  @if (row.largestChange) {
                    <p class="mt-1.5 text-[13.5px] text-ink-soft">
                      Largest change: <span class="font-medium">{{ row.largestChange }}</span>
                    </p>
                  }
                  <dl class="mt-2.5 grid max-w-[40ch] grid-cols-[1fr_auto] gap-x-8 gap-y-1 text-[13px]">
                    @for (type of row.types; track type.label) {
                      <dt class="text-ink-faint">{{ type.label }}</dt>
                      <dd class="text-right text-ink-soft tabular-nums">
                        {{ type.current }} <span class="text-ink-dim">vs {{ type.usualText }} usual</span>
                      </dd>
                    }
                  </dl>
                </div>
              }
            </li>
          }
        </ul>
      }
    </section>
  `,
})
export class LocationsListComponent {
  readonly locations = input.required<LocationSummaryResponse[]>();
  readonly dataStatus = input.required<DataStatus>();

  private readonly openRows = signal<ReadonlySet<string>>(new Set());

  protected readonly rowTone = rowTone;

  constructor() {
    // Collapse any expanded rows whenever the location list changes (new account/week selection) so a
    // stale "open" entry doesn't appear to belong to a different location.
    effect(() => {
      this.locations();
      this.openRows.set(new Set());
    });
  }

  protected readonly attentionCaption = computed(() => locationsAttentionCaption(this.locations(), this.dataStatus()));

  protected readonly locationRows = computed<LocationRow[]>(() => {
    const locations = this.locations();
    const max = Math.max(1, ...locations.flatMap((l) => [l.total.current, l.total.baselineMedian ?? 0]));

    return locations.map((loc) => {
      const { status, current, baselineMedian, deltaRatio } = loc.total;
      const geometry = barGeometry(current, baselineMedian, max);
      const usualText = formatMedian(baselineMedian);
      return {
        location: loc.location,
        status,
        baselineMedian,
        current,
        countsText: usualText === null ? `${current} · no usual level` : `${current} vs ${usualText} usual`,
        changeText: formatDeltaRatio(deltaRatio) ?? '—',
        widthPct: geometry.widthPct,
        tickPct: geometry.tickPct,
        flagged: status === 'above' || status === 'below',
        why: describeLocationWhy(loc),
        largestChange: largestChangeMover(loc),
        types: loc.byType.map((type) => ({
          label: eventTypeLabel(type.eventType),
          current: type.current,
          usualText: formatMedian(type.baselineMedian) ?? 'no',
        })),
      };
    });
  });

  protected isOpen(location: string): boolean {
    return this.openRows().has(location);
  }

  protected toggle(location: string): void {
    const next = new Set(this.openRows());
    if (next.has(location)) {
      next.delete(location);
    } else {
      next.add(location);
    }
    this.openRows.set(next);
  }

  protected whyId(idx: number): string {
    return `location-why-${idx}`;
  }
}
