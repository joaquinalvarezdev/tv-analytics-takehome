import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { DashboardQueryParamsService } from './dashboard-query-params.service';

/**
 * Placeholder shell for the (single) dashboard route. Renders the current
 * `account` / `weekStart` URL state and lets a reviewer change it, so the
 * reload-persistence behaviour of DashboardQueryParamsService is visible
 * end-to-end. The real weekly-summary UI lands once the generated API
 * client exists.
 */
@Component({
  selector: 'app-dashboard-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="mx-auto max-w-2xl space-y-6 p-6">
      <header>
        <h1 class="text-2xl font-semibold text-slate-900">Relay dashboard</h1>
        <p class="text-sm text-slate-600">Scaffold — weekly summary UI lands with the generated API client.</p>
      </header>

      <section aria-labelledby="current-selection-heading" class="rounded-lg border border-slate-200 p-4">
        <h2 id="current-selection-heading" class="text-base font-medium text-slate-900">Current selection</h2>
        <dl class="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt class="text-slate-500">Account</dt>
          <dd class="text-slate-900">{{ queryParams.account() ?? 'none' }}</dd>
          <dt class="text-slate-500">Week start</dt>
          <dd class="text-slate-900">{{ queryParams.weekStart() ?? 'none' }}</dd>
        </dl>
      </section>

      <form class="space-y-4 rounded-lg border border-slate-200 p-4">
        <div class="flex flex-col gap-1">
          <label for="account-input" class="text-sm font-medium text-slate-700">Account (demo identity switcher)</label>
          <input
            id="account-input"
            name="account"
            type="number"
            min="1"
            step="1"
            class="w-40 rounded border border-slate-300 px-2 py-1 text-sm"
            [value]="queryParams.account() ?? ''"
            (change)="onAccountChange($event)"
          />
        </div>

        <div class="flex flex-col gap-1">
          <label for="week-start-input" class="text-sm font-medium text-slate-700">Week start</label>
          <input
            id="week-start-input"
            name="weekStart"
            type="date"
            class="w-40 rounded border border-slate-300 px-2 py-1 text-sm"
            [value]="queryParams.weekStart() ?? ''"
            (change)="onWeekStartChange($event)"
          />
        </div>
      </form>
    </main>
  `,
})
export class DashboardShellComponent {
  protected readonly queryParams = inject(DashboardQueryParamsService);

  protected onAccountChange(event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    this.queryParams.setAccount(raw === '' ? null : Number(raw));
  }

  protected onWeekStartChange(event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    this.queryParams.setWeekStart(raw === '' ? null : raw);
  }
}
