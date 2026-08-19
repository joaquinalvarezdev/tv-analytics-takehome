import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import type { TypeBreakdownResponse } from '../api/generated/models/type-breakdown-response';
import { formatMedian } from './dashboard-formatting';

/**
 * Current-vs-usual detail per event type. Reused both for the account-wide breakdown and for each
 * location's expanded "why" detail — the genuine reuse that earns it its own component.
 */
@Component({
  selector: 'app-type-breakdown-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <table class="w-full text-sm">
      <caption class="sr-only">{{ caption() }}</caption>
      <thead>
        <tr class="text-left text-slate-500">
          <th scope="col" class="py-1 pr-4 font-medium">Event type</th>
          <th scope="col" class="py-1 pr-4 font-medium">This period</th>
          <th scope="col" class="py-1 font-medium">Usual</th>
        </tr>
      </thead>
      <tbody>
        @for (row of rows(); track row.eventType) {
          <tr class="border-t border-slate-200">
            <td class="py-1 pr-4 capitalize">{{ eventTypeLabel(row.eventType) }}</td>
            <td class="py-1 pr-4">{{ row.current }}</td>
            <td class="py-1">
              @if (row.baselineMedian === null || row.baselineMedian === undefined) {
                <span class="text-slate-400">not enough history</span>
              } @else {
                {{ formatMedian(row.baselineMedian) }}
              }
            </td>
          </tr>
        }
      </tbody>
    </table>
  `,
})
export class TypeBreakdownTableComponent {
  readonly rows = input.required<TypeBreakdownResponse[]>();
  readonly caption = input('Breakdown by event type');

  protected readonly formatMedian = formatMedian;

  protected eventTypeLabel(eventType: string): string {
    return eventType.replace(/_/g, ' ');
  }
}
