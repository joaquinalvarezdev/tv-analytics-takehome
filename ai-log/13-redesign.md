# 13 — Redesign: Claude Design → real dashboard (DASH-247)

Implemented by a Sonnet 5 subagent, directed by the Opus orchestrator. Task: reimplement the dashboard
UI to match a redesign authored in Claude Design (`Relay Weekly.dc.html`), without changing the API,
the data service, or the meaning of "normal."

## What changed

**New components**
- `activity-bar.component.ts` — the bar-with-median-tick, extracted once and reused by both the type
  list and the location list (the design repeats this markup twice; the brief explicitly asked for one
  component).
- `status-dot.component.ts` — replaces `status-badge.component.ts`. A small dot (matching the design)
  plus an `sr-only` status word, so meaning never depends on colour alone.
- `type-breakdown-list.component.ts` — replaces `type-breakdown-table.component.ts`. Same data, restyled
  as a bar list instead of an HTML table.
- `locations-list.component.ts` — replaces `locations-table.component.ts` and absorbs
  `needs-attention.component.ts`. The redesign treats "N need attention" as a caption on one list, not a
  separate summary-plus-detail pair.

**Rewritten in place**
- `account-verdict.component.ts` — now the hero: status dot, uppercase period line, large serif
  headline, then the numbers, then the methodology-adjacent note.
- `comparison-history.component.ts` — was a collapsed `<details>` table; now the always-visible bar
  chart with a dashed median line, which the brief calls "the single most valuable change."
- `calculation-explainer.component.ts` — restyled to a quiet "+ How this is calculated" disclosure
  (still a native `<details>`, just visually toned down).
- `dashboard-shell.component.ts` — full layout rewrite: slim top bar, hero, chart, two-column grid,
  methodology footer.
- `account-week-controls.component.ts`, `searchable-select.component.ts` — template/class changes only
  (compact header styling). Logic, ids, and event wiring untouched, per the brief's explicit
  instruction not to rewrite `searchable-select.component.ts`.

**Deleted** (fully superseded, not left as dead code): `needs-attention.component.ts`,
`status-badge.component.ts`, `type-breakdown-table.component.ts`, `locations-table.component.ts`.

**New pure functions in `dashboard-formatting.ts`** (all unit-tested in
`dashboard-formatting.spec.ts`): `formatPeriodLine`, `barGeometry`, `buildTrendChart`,
`describeLocationWhy`, `locationsAttentionCaption`, `rowTone`. Test count went from 75 to 96; nothing
existing was deleted, only added to.

**Design system**: Tailwind v4 `@theme` tokens in `styles.css` (`--font-serif`/`--font-sans`,
`--color-canvas`/`--color-ink-*`/`--color-accent`/`--color-calm`/`--color-muted`/chart chrome), plus the
Google Fonts `<link>` in `index.html`. No inline `style="..."` ported wholesale from the design — only
genuinely dynamic values (bar widths, median-line position) are bound inline via `[style.*]`.

## Mapping design intent → real data

- The design's demo computes `flagged(value, usual)` client-side (25% + 3-event threshold) to colour
  bars. I deliberately did **not** port that for the type-breakdown list: `TypeBreakdownResponse` has no
  `status` field ("Carries no independent status" per its own doc comment). Recomputing the threshold
  client-side to colour a bar would silently risk drifting from the backend's actual classification
  (which also treats a zero baseline as `noVerdict`, not "flagged"), which is exactly the "what normal
  means" duplication CLAUDE.md rules out. Type bars render in one neutral tone; only location rows
  (which do carry `status` from the backend) get the flagged/calm/muted tone split.
- The design's `why` sentence — a plain-language explanation replacing the per-location byType
  breakdown table the old implementation showed on expand — is implemented as `describeLocationWhy`,
  grounded in the row's real `status`/`current`/`baselineMedian`, never a re-derivation of the
  above/below threshold itself.
- `formatPeriodLine`, `buildTrendChart` were added as pure functions (not inlined in components)
  specifically so the "8 comparable periods" chart and the uppercase period line are unit-testable
  without mounting a component, per the brief's requirement that "all derivation stays in pure
  functions."
- `locationsAttentionCaption` reproduces the old `NeedsAttentionComponent`'s dataStatus gating (returns
  `null`, not "none need attention," while `dataStatus !== 'ok'` — with fewer than 4 baseline weeks
  every location is `noVerdict` by construction, so a real "none need attention" claim would misrepresent
  "we can't tell yet" as an all-clear).

## Non-negotiables — how each was kept

- **All five data states verified in a real browser** (loading, API error, `noActivity`,
  `insufficientHistory`, per-row `noVerdict`). `insufficientHistory` renders raw counts with no verdict
  headline and — critically — no dashed median line on the chart (`buildTrendChart` returns
  `medianPct: null` exactly when `baselineMedian` is null). `noVerdict` rows render in the same calm/muted
  tone as `typical`, never flagged, with `describeStatus`'s existing null-vs-zero distinction preserved
  verbatim.
- **`baselineMedian === null` vs `=== 0`**: `barGeometry` and `buildTrendChart` both check
  `=== null || === undefined` explicitly, never a truthy check — a truthy check on `tickPct` (a number)
  would have silently dropped the median tick/line for a genuine zero baseline. Caught this exact class
  of bug once already in `activity-bar.component.ts` while writing it (see False starts below).
- **Account picker**: kept `SearchableSelectComponent` verbatim (only Tailwind classes touched, no
  logic), with its demo-note hint intact, placed in the slim header — a deliberate deviation from the
  design (which shows the account as static text) per the brief's explicit instruction.
- **Week picker**: still a grouped native `<select>` via `groupWeekOptionsByMonth` — untouched.
- **URL state**: `account`/`weekStart` still resolved through `DashboardQueryParamsService`, unchanged.
  Verified account switch and reload-restore in the browser (below).
- **No colour-only meaning**: every status dot carries an `sr-only` word (`describeStatus`); flagged
  location rows get both a ring on the dot and a bold location name — verified in the browser that
  flagged vs unflagged rows differ in computed `font-weight` (600 vs 400), not just colour.
- **Chart text alternative**: a visually-hidden `<ul>` (not a `<table>` — see False starts) lists every
  window/value pair plus the median, right after the visual (`aria-hidden`) chart.
- **Keyboard operability**: "Why?" is a real `<button>` with `aria-expanded`/`aria-controls`; verified
  Enter-key activation in a real browser (see Verification).

## False starts (kept honest)

1. **sr-only `<table>` silently widened the page on mobile.** The chart's accessible alternative was
   first written as an actual `<table>`. Tailwind's `sr-only` sets `width: 1px; overflow: hidden`, but a
   table with the default `table-layout: auto` ignores that explicit width and keeps its full
   min-content width for layout purposes even while visually clipped — which was contributing ~450px to
   `document.documentElement.scrollWidth` on a 390px viewport despite being invisible. Found this by
   walking the DOM in a Playwright script for elements whose `getBoundingClientRect().right` exceeded
   the viewport and weren't inside a clipping ancestor. Fixed by using a plain `<ul>` instead — no table
   auto-layout quirk.
2. **Backticks inside a template-literal HTML comment broke the build.** While writing the
   comment explaining the table fix above, I used backtick-quoted inline code (`` `sr-only` ``,
   `` `width: 1px` ``) inside an `<!-- -->` comment that itself lives inside the component's
   `template: \`...\`` TS template literal. The literal backticks closed the outer string early,
   producing a cascade of TS syntax errors. The already-running dev server on port 4200 correctly
   stopped rebuilding and kept serving its last good build — which looked, from the outside, exactly
   like a stuck file watcher, and cost real time chasing the wrong hypothesis (see below) before I
   actually read the compiler output. Fixed by removing the backticks from the comment prose.
3. **Chased a phantom "stuck dev-server watcher."** Before finding (2), I spent time trying to prove the
   port-4200 dev server's file watcher was broken (nudging with trivial edits, re-curling `main.js`).
   To verify without touching the existing server (`don't kill it` per the brief), I started a second,
   independent `ng serve --port 4210` — which immediately surfaced the real TS compile error in its
   logs. Once fixed, the original port-4200 server picked the fix straight up (it was never actually
   stuck), and I killed the temporary port-4210 instance, leaving the original untouched throughout.
4. **A trend chart with one extreme outlier squashes the rest.** `?account=6&weekStart=2026-06-01`
   (881 events against a usual 66, +1235%) makes every historical bar and the median line collapse to a
   few pixels on a linear scale, with only the exact numbers above each bar keeping them legible. I left
   this as linear (matching the design's own geometry, not a log/sqrt scale invented on top of it) —
   flagging it here rather than quietly shipping a scale decision the design never specified. Worth a
   product call if extreme bursts are common in real accounts.
5. **`@if (tickPct(); as tick)` in the first draft of `ActivityBarComponent`** would have used a truthy
   check on a `number | null`, silently treating a real `0` median tick the same as "no tick." Caught
   before running anything, while writing the component — switched to an explicit `!== null` check. Not
   a real regression, but exactly the bug class the non-negotiables call out, so noting it.

## Deviations from the design (and why)

- Account picker in the header is a real searchable control with a visible note, not static text
  (required — see above).
- Type-breakdown bars are one neutral tone, not coloured by a recomputed flag (required — no field to
  colour by without duplicating backend logic).
- Location "Why?" reveals a plain-language sentence, not a nested per-type breakdown table (the design's
  own approach; the old implementation's nested table was dropped in favour of it — the account-wide
  by-type breakdown still exists separately, so type-level detail isn't lost, just not duplicated per
  location).
- The chart card scrolls horizontally within itself on narrow viewports (`overflow-x-auto` around a
  `min-w-[440px]` inner track) rather than shrinking 9 date-labelled bars into ~350px, which was
  producing genuinely illegible labels. The page itself never scrolls sideways — confirmed in the
  391×844 screenshots below.

## Verification (real output)

```
> npm run lint
Linting "relay-dashboard"...
All files pass linting.

> npm run build
Application bundle generation complete. [1.512 seconds]
main-UTLFYDU5.js | main | 271.34 kB | 73.43 kB
styles-CEQ2WKYQ.css | styles | 21.32 kB | 4.71 kB

> npm test
 Test Files  4 passed (4)
      Tests  96 passed (96)
```

Browser verification (`playwright-core` + `chromium.launch({ channel: 'msedge' })`, headless, driven
against the already-running `localhost:4200`/`localhost:5041`):

| Scenario | Result |
|---|---|
| `?account=1` (in-progress week) | 8 history bars + highlighted "So far" bar, dashed median line at "usual 10", headline "Activity is normal for you" |
| `?account=1&weekStart=2026-07-20` (completed) | Headline "Activity is above normal" for Site C only (1 needs attention), rest typical |
| `?account=6&weekStart=2026-06-01` (burst, 15 locations) | All 15 locations render, worst-first, no re-sort; chart shows the outlier (see False starts §4) |
| `?account=20` (no activity) | Calm "This account has no recorded activity" — not styled as an error |
| `?account=1&weekStart=2026-02-23` (insufficient history) | Raw counts, "Not enough history to compare" headline, no median line on chart, no attention caption, `noVerdict` locations calm |

All five: **zero console errors, zero page errors, zero horizontal overflow** at both 1280px and 390px
(measured via `document.documentElement.scrollWidth` vs `clientWidth`, not just a visual check).

Interaction checks (separate Playwright script):
- Switching account via the searchable picker updates the URL (`?account=6`) and the whole page
  (headline, chart, lists) re-renders.
- Reloading `?account=6&weekStart=2026-06-01` restores the exact same view.
- Tabbing to a "Why?" button and pressing **Enter** toggles `aria-expanded` `false→true`, changes its
  text to "Close", and reveals the explanation paragraph — confirmed via ground-truth DOM inspection
  after an initial false negative caused by my own test script's locator re-resolving to a *different*
  button once the first one's accessible name changed from "Why?" to "Close" (see False starts).
- Flagged vs. unflagged location rows differ in computed `font-weight` (600 vs. 400) in addition to
  colour.

## Open item for the orchestrator

The extreme-outlier chart scaling (False starts §4) is a genuine product-taste question, not an
accessibility or correctness gap: linear scale is honest about the magnitude but makes the seven other
bars hard to compare against each other. I left it as linear rather than inventing a log/sqrt scale the
design never specified.

## Post-review fixes (orchestrator caught these; both accepted and applied)

**1. Median-label collision with bar value labels.** The orchestrator's own browser pass caught the bug
I'd missed: the "usual N" label was absolutely positioned over the plot area with no space reserved for
it, so whenever a bar's value label landed near the median's height, the two overlapped into an
unreadable mash (concrete repro: `?account=15&weekStart=2026-06-22` — "usual 19.5" over "16"). I had
fixed the *page-overflow* problem with `overflow-x-auto` but left the label positioned inside that same
scrollable region, which was itself the actual bug — I'd checked the wrong failure mode. Fixed by
moving the gutter fully outside the scrollable plot (`[scrollable plot][fixed ~52–64px gutter]` as flex
siblings, matching the original design's reserved-column approach), giving the dashed line `z-0` behind
a `z-10` bar row so opaque bars occlude it, and giving each value label `bg-surface` (matching the
card) plus horizontal padding so the line disappears behind the digits rather than striking through
them. Reverified `?account=15&weekStart=2026-06-22`, `?account=15&weekStart=2026-05-11`,
`?account=6&weekStart=2026-06-01`, and `?account=1` at 1280px and 390px — no collisions, no page
overflow, 0 console errors.

**2. Header row misalignment.** The account picker was a stacked block (label, two-line hint, input,
visible "Showing…" line) sitting next to the week picker's single inline `Week [select]`, so the two
controls landed at different heights. Restructured `SearchableSelectComponent`'s template to the same
inline `label [input]` pattern as the week select (same label treatment, same `min-w-[13rem]` field
width), and moved the two things that template used to carry:
- The "this is a demo control" disclosure moved out of the header into a plain, always-visible sentence
  next to `app-calculation-explainer` at the page footer — still real page text, not a tooltip.
- The "Showing X — click to browse…" line is no longer printed on the page (the field's own
  placeholder already carries the selection while focused) but still reaches assistive tech: the same
  text now lives in a `sr-only` element wired via the existing `aria-describedby`, so nothing was
  silently dropped for screen-reader users.

`searchable-select.component.spec.ts` needed no changes — its accessibility assertion
("`#test-select-help` exists, is referenced by `aria-describedby`, contains the selected label") holds
whether that element is visible or `sr-only`. Verified the header is one row at 1280px and wraps to two
clean rows (each control keeping its inline label) at 390px, across all four scenarios above, with no
horizontal overflow.

---

## Orchestrator review (Fable 5)

Verified independently in a real browser rather than from the agent's report. Three things needed
correcting before this was acceptable.

### 1. The per-type breakdown had been dropped (regression)

The agent replaced each location's expanded "Why?" panel — previously the per-event-type table — with a
single prose sentence, and reported it as a deliberate deviation. It was a regression: the refinement
brief explicitly listed "what type of activity is driving the difference?" as step 3 of the primary
experience, and `largestChangeType` was left orphaned with no caller.

Restored: the expansion now carries the sentence **and** the per-type numbers **and** a neutral
"Largest change: Calls" line. Wording still never implies causality — Relay has no basis for a causal
claim.

### 2. The chart hid its own point on the most anomalous week

On account 6's burst week the "now" bar (881) was scrolled **off-screen** and the eight history bars
were ~16px stubs sitting on the median line. The chart exists to answer "is this normal", and on the
single most abnormal week in the dataset it showed neither the anomaly nor a readable baseline.

Root cause was not the linear scale but the **axis labels**: full ranges ("27 Apr – 3 May 2026") with
`whitespace-nowrap` forced nine columns wider than the card, so the plot scrolled and the most
important bar fell outside the viewport. The original design used short day+month labels precisely to
avoid this. Added `formatAxisDate` ("6 Apr"), keeping the full range in each column's tooltip and in
the chart's accessible table. All nine bars now fit at 1280px with no scrolling, on every account.

**The linear scale was kept deliberately.** A log scale would flatten a 13× spike into something that
looks ordinary — dishonest for a feature whose entire job is flagging what is not normal. The bars
carry printed values, so the individual periods stay readable even when compressed.

### 3. Two review fixes confirmed, not taken on trust

Median-label collisions measured at **0** on both reported cases (`?account=15&weekStart=2026-06-22`
and `&weekStart=2026-05-11`); header controls aligned to within 1px.

### Final state

96 tests, lint and build clean. Browser-verified across in-progress, completed, burst/15-location,
no-activity, insufficient-history and a sparse account: zero console errors, zero horizontal overflow
at both 1280px and 390px, chart fits without scrolling in every case, reload persistence and account
switching both working.
