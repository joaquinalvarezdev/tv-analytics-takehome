import { ChangeDetectionStrategy, Component, effect, input, signal } from '@angular/core';

import type { LocationSummaryResponse } from '../api/generated/models/location-summary-response';
import { formatDeltaRatio, formatMedian } from './dashboard-formatting';
import { StatusBadgeComponent } from './status-badge.component';
import { TypeBreakdownTableComponent } from './type-breakdown-table.component';

/**
 * The "which location needs attention" table. Rows are rendered exactly in the order the API
 * returns them (already sorted worst-first by the domain) — this component never re-sorts. Each row
 * expands, via a keyboard-operable `aria-expanded` button, to reveal the per-event-type "why" detail.
 */
@Component({
  selector: 'app-locations-table',
  imports: [StatusBadgeComponent, TypeBreakdownTableComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (locations().length === 0) {
      <p class="text-sm text-slate-500">No locations to show.</p>
    } @else {
      <table class="w-full border-collapse text-sm">
        <caption class="sr-only">Activity by location, worst-first</caption>
        <thead>
          <tr class="border-b border-slate-300 text-left text-slate-500">
            <th scope="col" class="py-2 pr-4 font-medium">Location</th>
            <th scope="col" class="py-2 pr-4 font-medium">Status</th>
            <th scope="col" class="py-2 pr-4 font-medium">This period</th>
            <th scope="col" class="py-2 pr-4 font-medium">Usual</th>
            <th scope="col" class="py-2 pr-4 font-medium">Change</th>
            <th scope="col" class="py-2 font-medium"><span class="sr-only">Details</span></th>
          </tr>
        </thead>
        <tbody>
          @for (loc of locations(); track loc.location; let idx = $index) {
            <tr class="border-b border-slate-200">
              <td class="py-2 pr-4 font-medium text-slate-900">{{ loc.location }}</td>
              <td class="py-2 pr-4">
                <app-status-badge [status]="loc.total.status" [baselineMedian]="loc.total.baselineMedian" />
              </td>
              <td class="py-2 pr-4">{{ loc.total.current }}</td>
              <td class="py-2 pr-4">
                @if (loc.total.baselineMedian === null || loc.total.baselineMedian === undefined) {
                  <span class="text-slate-400">—</span>
                } @else {
                  {{ formatMedian(loc.total.baselineMedian) }}
                }
              </td>
              <td class="py-2 pr-4">{{ formatDeltaRatio(loc.total.deltaRatio) ?? '—' }}</td>
              <td class="py-2">
                <button
                  type="button"
                  class="rounded border border-slate-300 px-2 py-0.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                  [attr.aria-expanded]="isExpanded(idx)"
                  [attr.aria-controls]="detailId(idx)"
                  (click)="toggle(idx)"
                >
                  {{ isExpanded(idx) ? 'Hide detail' : 'Why?' }}
                </button>
              </td>
            </tr>
            @if (isExpanded(idx)) {
              <tr [id]="detailId(idx)">
                <td colspan="6" class="bg-slate-50 px-4 py-3">
                  <app-type-breakdown-table [rows]="loc.byType" [caption]="loc.location + ' breakdown by event type'" />
                </td>
              </tr>
            }
          }
        </tbody>
      </table>
    }
  `,
})
export class LocationsTableComponent {
  readonly locations = input.required<LocationSummaryResponse[]>();

  private readonly expandedRows = signal<ReadonlySet<number>>(new Set());

  protected readonly formatMedian = formatMedian;
  protected readonly formatDeltaRatio = formatDeltaRatio;

  constructor() {
    // Collapse any expanded rows whenever the location list changes (new account/week selection) so
    // a stale "expanded" index from the previous list doesn't appear to belong to a new location.
    effect(() => {
      this.locations();
      this.expandedRows.set(new Set());
    });
  }

  protected isExpanded(idx: number): boolean {
    return this.expandedRows().has(idx);
  }

  protected toggle(idx: number): void {
    const next = new Set(this.expandedRows());
    if (next.has(idx)) {
      next.delete(idx);
    } else {
      next.add(idx);
    }
    this.expandedRows.set(next);
  }

  protected detailId(idx: number): string {
    return `location-detail-${idx}`;
  }
}
