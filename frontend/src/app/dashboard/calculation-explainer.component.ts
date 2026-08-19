import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * "Why is something classified the way it is?" — the rule, in words. A native `<details>`/`<summary>`
 * disclosure: focusable and keyboard-operable (Enter/Space) without any extra ARIA wiring, and never
 * hidden behind hover-only content.
 */
@Component({
  selector: 'app-calculation-explainer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <details class="rounded border border-slate-200 p-3 text-sm text-slate-700">
      <summary class="cursor-pointer font-medium text-slate-900">How is this calculated?</summary>
      <div class="mt-2 space-y-2">
        <p>
          Activity is compared with the median of up to 8 comparable prior weeks. It is flagged as above
          or below normal only when it differs from that usual level by at least 25%
          <strong>and</strong> by at least 3 events — both conditions must hold, so a small change on a
          quiet location or event type isn't flagged as news.
        </p>
        <p class="text-xs text-slate-500">
          The 8-week window, 25% threshold, and 3-event floor are product defaults chosen for this
          dashboard, not derived truths — they would be worth validating with real account/product
          feedback.
        </p>
      </div>
    </details>
  `,
})
export class CalculationExplainerComponent {}
