import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';

import type { AccountResponse } from '../api/generated/models/account-response';
import { DashboardQueryParamsService } from './dashboard-query-params.service';
import { formatHumanDate, generateWeekOptions } from './dashboard-formatting';

/**
 * Header controls: the account picker (an explicit demo/dev identity switcher — never how a real,
 * authenticated dashboard would resolve "which account") and the week picker. Both write straight
 * through to the URL via `DashboardQueryParamsService`, so a reload restores the exact view.
 */
@Component({
  selector: 'app-account-week-controls',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="flex flex-wrap items-end gap-6" (submit)="$event.preventDefault()">
      <div class="flex flex-col gap-1">
        <label for="account-select" class="text-sm font-medium text-slate-700">
          Account
          <span class="block text-xs font-normal text-slate-500">
            Demo control standing in for the signed-in account — a real dashboard would resolve this
            from the authenticated user, not a client-supplied picker.
          </span>
        </label>
        <select
          id="account-select"
          class="w-64 rounded border border-slate-300 px-2 py-1 text-sm"
          [disabled]="accounts() === null"
          (change)="onAccountChange($event)"
        >
          @for (account of accounts() ?? []; track account.id) {
            <!--
              [selected] per-option, not [value] on the select: accounts load asynchronously, so the
              options don't exist yet the first time Angular would set select.value, and the browser
              silently falls back to the first option. Marking the matching option [selected] instead
              is immune to that ordering, since it's applied once the option itself is created.
            -->
            <option [value]="account.id" [selected]="account.id === accountId()">{{ account.name }}</option>
          }
        </select>
      </div>

      <div class="flex flex-col gap-1">
        <label for="week-select" class="text-sm font-medium text-slate-700">Week</label>
        <select
          id="week-select"
          class="w-64 rounded border border-slate-300 px-2 py-1 text-sm"
          [disabled]="weekOptions().length === 0"
          (change)="onWeekChange($event)"
        >
          @if (weekOptions().length === 0) {
            <option value="">No selectable weeks yet</option>
          }
          @for (week of weekOptions(); track week; let idx = $index) {
            <!-- [selected] per-option; see the account select above for why not [value] on the select. -->
            <option [value]="week" [selected]="week === effectiveWeekStart()">
              {{ formatHumanDate(week) }}{{ idx === 0 ? ' (in progress)' : '' }}
            </option>
          }
        </select>
      </div>
    </form>
  `,
})
export class AccountWeekControlsComponent {
  private readonly queryParams = inject(DashboardQueryParamsService);

  readonly accounts = input<AccountResponse[] | null>(null);
  readonly accountId = input.required<number>();
  readonly selectedAccount = input<AccountResponse | null>(null);

  protected readonly formatHumanDate = formatHumanDate;

  protected readonly weekOptions = computed(() => {
    const account = this.selectedAccount();
    if (!account) {
      return [];
    }
    return generateWeekOptions(account.firstSelectableWeekStart ?? null, account.currentWeekStart);
  });

  protected readonly effectiveWeekStart = computed(
    () => this.queryParams.weekStart() ?? this.selectedAccount()?.currentWeekStart ?? '',
  );

  protected onAccountChange(event: Event): void {
    const value = Number((event.target as HTMLSelectElement).value);
    this.queryParams.setAccount(value);
    // A previously selected week may not exist in the new account's range (different accounts have
    // different first-selectable weeks), so fall back to that account's default (in-progress) week.
    this.queryParams.setWeekStart(null);
  }

  protected onWeekChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    const account = this.selectedAccount();
    // Omit weekStart entirely when the newest (in-progress) week is chosen, matching the "no
    // weekStart in the URL -> API defaults to the current week" rule instead of a redundant param.
    this.queryParams.setWeekStart(account && value === account.currentWeekStart ? null : value);
  }
}
