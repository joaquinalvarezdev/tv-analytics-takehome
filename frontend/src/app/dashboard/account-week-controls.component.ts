import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';

import type { AccountResponse } from '../api/generated/models/account-response';
import { DashboardQueryParamsService } from './dashboard-query-params.service';
import { generateWeekOptions, groupWeekOptionsByMonth } from './dashboard-formatting';
import { SearchableSelectComponent, type SelectOption } from './searchable-select.component';

/**
 * Header controls: the account picker (an explicit demo/dev identity switcher — never how a real,
 * authenticated dashboard would resolve "which account") and the week picker. Both write straight
 * through to the URL via `DashboardQueryParamsService`, so a reload restores the exact view.
 *
 * The two use deliberately different controls. Accounts are recalled by name, so 20 of them are best
 * served by type-to-filter search. Weeks are not: text-matching a date is meaningless (typing "3"
 * matches 13 Jul, 31 May and 23 Feb alike), so weeks stay an ordered `<select>`, grouped by month to
 * keep the list navigable, and labelled with the full range so an option reads as a period.
 */
@Component({
  selector: 'app-account-week-controls',
  imports: [SearchableSelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-wrap items-center gap-5">
      <app-searchable-select
        inputId="account-select"
        label="Account"
        emptyText="Loading accounts…"
        [options]="accountOptions()"
        [selectedValue]="String(accountId())"
        (valueChange)="onAccountChange($event)"
      />

      <div class="flex items-center gap-2">
        <label for="week-select" class="text-xs tracking-wide text-ink-dim">Week</label>
        <select
          id="week-select"
          class="min-w-[13rem] rounded-md border border-border-strong bg-white px-2.5 py-1.5 text-[13px] text-ink disabled:bg-canvas disabled:text-ink-whisper"
          [disabled]="weekGroups().length === 0"
          (change)="onWeekChange($event)"
        >
          @if (weekGroups().length === 0) {
            <option value="">No selectable weeks for this account</option>
          }
          @for (group of weekGroups(); track group.label) {
            <optgroup [label]="group.label">
              @for (week of group.weeks; track week.value) {
                <!--
                  [selected] per-option, not [value] on the select: the account (and therefore the week
                  list) loads asynchronously, so the options don't exist yet the first time Angular
                  would set select.value, and the browser silently falls back to the first option.
                -->
                <option [value]="week.value" [selected]="week.value === effectiveWeekStart()">
                  {{ week.label }}
                </option>
              }
            </optgroup>
          }
        </select>
      </div>
    </div>
  `,
})
export class AccountWeekControlsComponent {
  private readonly queryParams = inject(DashboardQueryParamsService);

  readonly accounts = input<AccountResponse[] | null>(null);
  readonly accountId = input.required<number>();
  readonly selectedAccount = input<AccountResponse | null>(null);

  /** Exposed for the template: option values are strings, account ids are numbers. */
  protected readonly String = String;

  protected readonly accountOptions = computed<SelectOption[]>(() =>
    (this.accounts() ?? []).map((account) => ({ value: String(account.id), label: account.name })),
  );

  protected readonly weekGroups = computed(() => {
    const account = this.selectedAccount();
    if (!account) {
      return [];
    }
    return groupWeekOptionsByMonth(
      generateWeekOptions(account.firstSelectableWeekStart ?? null, account.currentWeekStart),
    );
  });

  protected readonly effectiveWeekStart = computed(
    () => this.queryParams.weekStart() ?? this.selectedAccount()?.currentWeekStart ?? '',
  );

  protected onAccountChange(value: string): void {
    // One atomic navigation, not setAccount() followed by setWeekStart(): Router.navigate is async,
    // so a second call would merge against the pre-navigation URL and drop the account change.
    // Clearing the week is required because a week valid for one account may not exist for another,
    // so the new account falls back to its own default (in-progress) week.
    this.queryParams.setAccountAndWeek(Number(value), null);
  }

  protected onWeekChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    const account = this.selectedAccount();
    // Omit weekStart entirely when the newest (in-progress) week is chosen, matching the "no
    // weekStart in the URL -> API defaults to the current week" rule instead of a redundant param.
    this.queryParams.setWeekStart(account && value === account.currentWeekStart ? null : value);
  }
}
