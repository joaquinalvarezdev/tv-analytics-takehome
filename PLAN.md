# PLAN.md — DASH-247: "Is this normal for us?"

Pre-implementation plan. Written after ticket + seed-data analysis and a decision review, before any feature code. Left as-written per the take-home rules.

## Context

Relay's dashboard shows raw totals per location and nothing else. DASH-247 asks the dashboard to answer *"is this normal for us?"* at a glance, with multi-location customers mattering and a customer-admin-on-Monday-morning persona. Out of scope per product: alerting/notifications, ML/forecasting.

## Current repository state (before implementation)

- `backend/Relay.Api` — default .NET 8 minimal-API template (weather forecast). No feature code, no EF Core, no migrations yet.
- `backend/Relay.Api.Tests` — xUnit template with the default empty test.
- `frontend/` — contains only `CLAUDE.md`. No Angular workspace exists yet.
- `docker-compose.yaml` — SQL Server 2022 container, present and unused so far.
- `schema.sql` / `seed.sql` (~12.6k events, 20 accounts) provided; not yet loaded anywhere.

## Verified data facts (measured against seed.sql, not assumed)

- 12,626 events from 2026-02-01 10:57 UTC to 2026-07-27 22:20 UTC. The last event day is a **Monday** (Jul 27), with events through the evening. 25 complete Mon–Sun weeks precede it, plus a partial Sunday (Feb 1) at the start.
  - Note: "Monday morning" is the ticket's persona, **not** a data fact — the data only establishes that it ends on a Monday.
- Real today (2026-08-19) is ~3 weeks past the data. Anchoring "this week" to the wall clock would render an empty dashboard.
- Account 20 (Quiet Harbor Spa) has **zero events**.
- Account 6 (Metro Collision, 15 locations) has a **burst day**: 805 events on 2026-06-03 vs ~12/day normal (~66×). Any mean-based baseline is distorted for every trailing window containing that day.
- **12 exact duplicate rows** (distinct `id`, identical values otherwise). There is no natural key, so a planted duplicate is indistinguishable from a genuine repeat event.
- NULLs: 313/7,780 calls (4%) have NULL `duration_seconds`; 398 events (3.2%) have NULL `outcome`.
- 74 events fall at 00:00–05:59 UTC → they belong to the *previous local day* for US-timezone accounts. Timezones include America/Phoenix (no DST) and UTC. US DST spring-forward (2026-03-08) is inside the range, so one local week is 167 hours.
- Weekends run at ~35% of weekday volume — strong day-of-week seasonality; partial-week vs full-week comparisons are structurally misleading.
- Volume is skewed and sparse: 6.6–104 events/week per account; at location × event-type granularity, some cells average ~1 event/week.

## Product assumptions (ours — chosen, not data-derived; the knobs to tune with real product input)

All of these will be named constants in one place:

- **Baseline window: trailing 8 complete weeks.** Recent enough to track a business, long enough for a stable median.
- **Minimum history for a verdict: 4 complete weeks.** Below that, medians of tiny samples mislead; show raw numbers instead.
- **Deviation threshold: 25%** of baseline to flag above/below. At-a-glance signal without flapping.
- **Absolute floor: 3 events.** On sparse locations a 4→3 drop is noise, not news; both conditions must hold to flag.
- Weeks start **Monday** in the account's IANA timezone; an event belongs to its account-local calendar day.
- "Normal" is **self-referential** (the account's own history), not industry or cross-account benchmarks. Open question for the recruiter; proceeding on this working assumption.
- **Duplicates are counted as real events.** No natural key exists to justify dedup, and two identical calls can legitimately occur. Dedup would be an ingestion-time concern.
- The **burst day is not excluded**. The median baseline absorbs it; when the burst week is itself the reported week, "way above normal" is the feature working.
- v1 metrics are **counts only** (call_received / lead_created / appointment_set / total). `duration_seconds` and `outcome` are deliberately unused — deferred, not overlooked.

## Product decisions (what the feature is)

1. **Two first-class views on one dashboard page:**
   - **Current week-to-date** — raw counts per location, explicitly badged "in progress — no verdict". Partial weeks don't get verdicts (weekend seasonality makes them dishonest).
   - **Last completed week** (or any user-selected completed week) — the classified comparison: below / typical / above per location, worst-first.
2. **Classification:** for any selected completed week, compare that week's activity against the median of up to the 8 complete weeks immediately preceding it. At least 4 preceding complete weeks are required for a verdict. Flag `above` / `below` only when |Δ| ≥ 25% of baseline **and** |current − baseline| ≥ 3 events. Zero baseline: current ≥ floor → `above` with a "no meaningful baseline" note; otherwise `typical` (quiet).
3. **Per-location status on total activity** (sparsity makes per-type statuses noise); per-event-type breakdown shown as detail rows (current vs median) without independent badges. Account-level rollup on top.The account-level baseline is calculated independently from account-wide weekly totals: median(total activity for each preceding comparison week). It is not calculated by summing per-location medians.
4. **Explicit data states:** `no_activity` (account has no events at all — e.g. account 20), `insufficient_history` (< 4 complete baseline weeks — raw counts, no verdict), normal path otherwise. The UI must render loading / error / empty / insufficient-history / zero-activity distinctly.
5. **Account picker is a demo/dev identity switcher only**, labeled as such in the UI and README. In production, authentication would scope the account server-side (identity from the authenticated principal, not a client-supplied ID). The picker exists so a reviewer can inspect all 20 accounts' states. Auth itself is out of scope per the prompt.

## Engineering decisions

- **Reporting anchor:** one **dataset-wide anchor = global `MAX(occurred_at)`** (2026-07-27 22:20 UTC), computed once and treated as "now", converted per account timezone to derive that account's current week and last completed week. Works uniformly for zero-activity accounts (per-account max would leave account 20 with no anchor and would mis-anchor quiet accounts to stale weeks — "no news" is signal). Deterministic stand-in for the production wall clock; documented as such.
- **Timezone handling:** convert UTC → account-local in **C# via `TimeZoneInfo`** (IANA IDs work on .NET 8). The repository will query a bounded UTC range; a pure service will bucket into local days/weeks. DST-correct and unit-testable. SQL Server `AT TIME ZONE` needs Windows tz names — an IANA mapping isn't worth the budget at this scale (≤ ~1k rows per account per window).
- **Stack per repo CLAUDE.md:** EF Core + SQL Server (existing docker-compose), real EF migration for the schema (`TIMESTAMP` → `datetime2`), feature-oriented layout (`Features/WeeklySummary/`), explicit DTOs (no EF entity leakage), accurate Swagger — the frontend will consume a generated OpenAPI client.
- **Seeding:** an idempotent importer will parse `seed.sql` insert lines and bulk-insert on startup when the tables are empty (no sqlcmd dependency). `seed.sql` used verbatim — never regenerated.
- **Frontend:** new Angular workspace (standalone components, strict TS) + Tailwind + generated OpenAPI client. Signals for local state; no state library. **`account` + `weekStart` live in URL query params** → reload persistence + shareability (this is the required user-controlled persisted input, chosen deliberately).

## API contract (orchestrator-owned; draft, may get small shape adjustments during review)

- `GET /api/accounts` → `[{ id, name, timezone, currentWeekStart, lastCompleteWeekStart }]`
  (week starts derived server-side from the global anchor + account tz so the frontend never reimplements the derivation)
- `GET /api/accounts/{id}/weekly-summary?weekStart=yyyy-MM-dd` (optional; default = last complete week) →

```
{
  accountId, timezone, weekStart, weekEnd,
  dataStatus: "ok" | "insufficient_history" | "no_activity",
  baselineWeeksUsed,
  totals: { current, baselineMedian, deltaPct?, status },
  byType: [{ eventType, current, baselineMedian }],
  locations: [                       // sorted worst-first
    { location, status, total: { current, baselineMedian, deltaPct? }, byType: [...] }
  ],
  weekToDate?: {                     // only when the selected week is the last complete week
    weekStart, throughDate, total, byLocation: [{ location, count }]
  }
}
```

- 404 unknown account; 400 invalid or non-Monday-aligned `weekStart`.

## Tests (confidence over coverage; the pure service is the target)

Backend xUnit on `WeeklySummaryService`:
- local-day boundary: a 02:00 UTC event lands on the previous America/Chicago local day/week
- week boundaries: Monday 00:00 local inclusive, next Monday exclusive
- DST week (Mar 2–8, 2026, 167h local) buckets correctly
- anchor → current/last-complete week derivation per timezone, incl. a zero-event account under the global anchor
- burst week inside the baseline window does not shift the median; burst week as the reported week → `above`
- zero-baseline tiers; `insufficient_history`; `no_activity`
- duplicates counted twice; Phoenix/UTC sanity
- threshold + absolute-floor interaction (e.g. 4→3 not flagged; 40→28 flagged)
- week-to-date block present only for the last complete week; raw counts, no statuses

Plus a seed-backed spot check (account 20 → `no_activity`; one hand-computed account/week vs service output). Frontend: a few meaningful tests (summary mapping / status rendering, query-param state), lint + build. How to run tests goes in the README.

## Implementation sequence (with agent delegation per root CLAUDE.md)

0. This plan + `ai-log/01-planning.md` entry for the planning session. *(orchestrator — done as part of planning)*
1. **Backend foundation** — entities, DbContext, `InitialCreate` migration, seed importer, verify against dockerized SQL Server. *(sonnet agent)*
2. **Domain service TDD** — `WeeklySummaryService` + the test list above. *(sonnet agent; parallel with 1 — pure logic, no EF dependency)*
3. **API layer** — repository, endpoints, DTOs, Swagger. *(sonnet agent, after 1+2; orchestrator reviews the contract)*
4. **Frontend** — scaffold + Tailwind + generated client + dashboard view + states + URL persistence. *(sonnet agent; scaffold may start in parallel once the OpenAPI contract is fixed)*
5. **Final cross-stack verification + README + ai-log reflection.** *(orchestrator)*

## Deliberately deferred (would do with another day)

Outcome/duration quality metrics (missed-call rate, no-show rate), day-level drill-down charts, industry/cross-account benchmarks, caching, real auth, CI/infra. Alerting and ML/forecasting are out of scope per the ticket.

## Open questions (documented working assumptions rather than blockers)

- Should "normal" ever be industry-relative or cross-location? Working assumption: no — own history only.
- Threshold/floor/window values above are product assumptions; would validate with product/AM feedback.

## Verification / definition of done

- `docker compose up -d` + documented commands: migrations apply, seed loads once, API + SPA run locally.
- All backend and frontend tests pass; run commands in README.
- Aggregates spot-verified against direct SQL for ≥ 2 accounts/weeks (incl. account 6's burst week and one sparse account).
- Reload persistence, week-to-date strip, and all empty/insufficient/error states manually verified.
