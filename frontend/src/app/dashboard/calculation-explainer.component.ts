import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * "Why is something classified the way it is?" — the rule, in words, as a quiet "+ How this is
 * calculated" disclosure at the foot of the page. A native `<details>`/`<summary>` element: focusable
 * and keyboard-operable (Enter/Space) without any extra ARIA wiring, and never hidden behind
 * hover-only content. The `+`/`−` prefix is pure CSS (`open:` variant), not JS state.
 */
@Component({
  selector: 'app-calculation-explainer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <details class="group">
      <summary class="marker:content-none flex cursor-pointer list-none items-center gap-1.5 text-[13px] text-ink-quiet hover:text-ink-muted">
        <span aria-hidden="true" class="inline-block w-3 text-center group-open:hidden">+</span>
        <span aria-hidden="true" class="hidden w-3 text-center group-open:inline-block">−</span>
        How this is calculated
      </summary>
      <div class="mt-4 grid max-w-3xl grid-cols-1 gap-6 sm:grid-cols-2">
        <p class="text-[13.5px] leading-relaxed text-pretty text-ink-soft">
          Activity is compared with the median of up to 8 comparable prior weeks. It is flagged as above
          or below normal only when it differs from that usual level by at least 25%
          <strong>and</strong> by at least 3 events — both conditions must hold, so a small change on a
          quiet location or event type isn't flagged as news.
        </p>
        <p class="text-[13.5px] leading-relaxed text-pretty text-ink-dim">
          The 8-week window, 25% threshold, and 3-event floor are product defaults chosen for this
          dashboard, not derived truths — they would be worth validating with real account/product
          feedback.
        </p>
      </div>
    </details>
  `,
})
export class CalculationExplainerComponent {}
