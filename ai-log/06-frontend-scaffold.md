# 06 — Frontend scaffold (Task 4, scaffold half)

Sonnet implementation agent. Scope: `frontend/**` only, plus this file. Did
**not** touch `backend/**`, `PLAN.md`, `README.md`, `docker-compose.yaml`.
Explicitly did **not** write any API client, HTTP service, or DTO/model
interfaces — that is the next task's job, from a generated OpenAPI client.

## Versions chosen, and why

- **Angular 21.2.21** (CLI + core), not the newly-released Angular 22.
  `@angular/cli@latest` resolves to 22.1.4, which hard-fails its own Node
  engine check on this machine (Node v24.10.0; Angular 22 requires
  `>=22.22.3 || >=24.15.0 || >=26.0.0`). Angular 21 runs clean on this Node
  version with no warnings. Verified both `ng new` and `ng build`/`ng
  test`/`ng lint` work end-to-end on 21 before committing to it. This is an
  environment-driven version pin, not a product decision — worth revisiting
  once Node is upgraded or the grading machine has a newer Node.
- **`@angular-eslint/schematics@21.4.0`** — matched to Angular CLI 21
  (`@angular-eslint@22.x` requires Angular CLI `>=22`, confirmed via `npm
  view ... peerDependencies` before installing).
- **Tailwind CSS v4.3.3** via `@tailwindcss/postcss` + a `.postcssrc.json`
  (v4's supported integration path — no separate `tailwind.config.js`/
  `content` globs needed, v4 scans automatically). `src/styles.css` is just
  `@import "tailwindcss";`. Verified real utility classes (`.max-w-2xl`,
  `.text-slate-900`) land in the compiled `dist/.../styles-*.css`, not just
  the Tailwind preflight reset.
- **Vitest**, not Karma — this is Angular 21's default test builder
  (`@angular/build:unit-test`), not a choice I made. It runs headless via
  jsdom and **exits on its own** (single-shot, not watch mode) by default,
  so `ng test` / `npm test` is already CI-safe with no extra flags.

## What was built

- Flat Angular workspace rooted at `frontend/` (`ng new relay-dashboard
  --directory=. --routing=true --style=css --strict`), app name
  `relay-dashboard`, standalone components (no NgModules — this is the v21
  default, not an opt-in). `frontend/CLAUDE.md` was moved aside during `ng
  new` (it refuses a non-empty directory) and restored immediately after.
- `src/app/dashboard/dashboard-query-params.service.ts` — the required
  injectable query-param state service. `account: Signal<number | null>`
  and `weekStart: Signal<string | null>`, both derived via `toSignal()`
  from `ActivatedRoute.queryParamMap`. `setAccount()` / `setWeekStart()`
  write back through `Router.navigate([], { queryParamsHandling: 'merge',
  replaceUrl: true })`. `parseAccountParam`/`parseWeekStartParam` are
  exported pure functions: absent, non-numeric, non-integer, non-positive,
  or (for weekStart) a `yyyy-MM-dd`-shaped-but-nonexistent date (e.g.
  `2026-02-30`, checked via UTC round-trip, not just regex) all degrade to
  `null` — never `NaN`, never a thrown error.
  - **Why signals, not a BehaviorSubject/service-with-getters pattern:**
    `toSignal` off the router's own observable keeps the service as thin
    glue rather than a second source of truth; components read `.account()`
    reactively in templates with no manual subscription/unsubscription, and
    `computed()` gives the parsing a free memoization boundary. This matches
    `frontend/CLAUDE.md`'s "prefer signals/RxJS/Angular primitives ... rather
    than a global state library."
  - **Why `queryParamsHandling: 'merge'`:** so `setAccount` never
    accidentally erases an already-set `weekStart` (and vice versa) — each
    setter only touches its own key.
  - **Why `replaceUrl: true`:** same-page param changes (switching the
    demo account, changing the week) shouldn't each push a new history
    entry; back/forward stays meaningful for actual navigation rather than
    stepping through every intermediate filter state.
- `src/app/dashboard/dashboard-shell.component.ts` — placeholder shell,
  `OnPush`, inline template. Renders current `account`/`weekStart` in a
  `<dl>`, with a real `<label for>` + `<input type="number">` for account
  and `<input type="date">` for weekStart — both keyboard-operable native
  controls, no custom widgets. Tailwind utility classes throughout (visible
  proof of wiring, see verification below).
- `src/app/app.routes.ts` — single route: `{ path: '', component:
  DashboardShellComponent }`. `src/app/app.ts` reduced to a bare
  `<router-outlet />` shell (deleted the generated `app.html`/`app.css`
  welcome-page boilerplate, ~20KB of default marketing markup).
- Tests: `dashboard-query-params.service.spec.ts` — 14 cases covering the
  three things the task asked for (absent param, invalid param, round-trip
  write→read) plus a merge-doesn't-clobber case and a clear-to-null case.
  The round trip is tested against a fake `Router`/`ActivatedRoute` pair
  where the fake `navigate()` spy actually pushes the merged params back
  onto the `ActivatedRoute`'s `queryParamMap` subject — so the assertion
  that `service.account()` reflects a value after `setAccount()` is a real
  behavioural check, not just "was navigate called with the right args."
  `app.spec.ts` trimmed to the single generator "should create" test (the
  generated title-text assertion no longer applies since the welcome
  template was deleted); no new trivial "component should create" tests
  were added beyond that, per the task's instruction.
- `frontend/.gitignore`: left as the file `ng new` generates. Verified the
  root `.gitignore` already covers `node_modules/`, `dist/`, `.angular/`
  via `**/` patterns before deciding not to hand-author a redundant one —
  the generated file's remaining entries (IDE files, `/coverage`,
  `.DS_Store`, etc.) aren't duplicated at the root, so it earns its place
  without violating "don't add a redundant file."

## What fought me

- `toSignal<ParamMap>(this.route.queryParamMap, { initialValue: ... })`
  with an **explicit** generic argument failed to typecheck (`ng build`,
  TS2769 — none of the `toSignal` overloads matched once `ParamMap` was
  pinned explicitly, because the overload resolution for the `initialValue`
  option couldn't reconcile the pinned `T` against `NoInfer<...>`). Dropping
  the explicit `<ParamMap>` and letting it infer from the observable +
  `initialValue` fixed it immediately. Left unpinned; inference is correct
  and the compiler catches drift if `queryParamMap`'s type ever changes.
- `ng new` needs an empty target directory and `frontend/` already had
  `CLAUDE.md`. Worked around by moving it to the scratchpad and back rather
  than passing any flag to suppress the check (found none that does).
- Confirming the right Angular major took a few throwaway `npx
  @angular/cli@<major> version` calls (19/20/21/22) against this Node
  version before settling — recorded above so it isn't repeated.

## Verification (real output)

Commands a reviewer runs, from `frontend/`:

```
npm run lint    # -> ng lint
npm run build   # -> ng build
npm test        # -> ng test (headless, non-interactive, exits on its own)
```

`ng lint`:

```
Linting "relay-dashboard"...
All files pass linting.
```

`ng build`:

```
Application bundle generation complete. [1.154 seconds]
Initial total | 200.49 kB | 54.79 kB (estimated transfer)
Output location: frontend/dist/relay-dashboard
```

`ng test` (exit code confirmed `0` via `echo $?` after the run, not just
eyeballed):

```
Test Files  2 passed (2)
     Tests  15 passed (15)
   Start at 13:07:25
   Duration 1.03s
```

Tailwind wiring, confirmed by grepping the *compiled* output, not just the
source:

```
$ grep -o "max-w-2xl" dist/relay-dashboard/browser/styles-*.css
max-w-2xl
$ grep -c "\.text-slate-900" dist/relay-dashboard/browser/styles-*.css
1
```

Manual smoke check via `ng serve` (background, port 4399, killed after):
`GET /?account=6&weekStart=2026-06-01` → `200` (Angular dev server's
history-API fallback serves `index.html` for the query-param URL, i.e. a
hard reload on that URL will boot the SPA which then reads the params from
`ActivatedRoute` as normal — the actual parsing/round-trip behaviour is
what the 15 unit tests exercise directly, since a curl-only check can't
execute client-side JS to observe the rendered signal values). Also
confirmed `styles.css` served by the dev server contains the same Tailwind
utility.

## Deviations from the task spec

None. Scope was respected: no API client/DTOs written, no state library, no
component library, no dependencies beyond Angular/Tailwind/ESLint tooling.

## Flag for the orchestrator

- **Node/Angular version mismatch on this machine.** Angular 22 (current
  `@angular/cli@latest`) will not run here without a Node upgrade. If the
  grading machine has Node ≥24.15, upgrading to Angular 22 is a mechanical
  `ng update` later; not done here to avoid burning take-home time on a
  major-version bump with no functional benefit for a scaffold.
- The account picker is currently a bare `<input type="number">`, not a
  `<select>` of named accounts (PLAN.md's "demo/dev identity switcher").
  Deliberate — account names come from `GET /api/accounts`, which doesn't
  exist yet in this task's scope. Follow-up task (generated client +
  dashboard data) should replace it with a real `<select>`.
