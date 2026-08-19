# 03 — WeeklySummary domain logic + tests

Sonnet implementation agent, working in an isolated git worktree, scope limited to
`backend/Relay.Api/Features/WeeklySummary/**` and `backend/Relay.Api.Tests/**`.

## What was built

- `Features/WeeklySummary/Models.cs` — the exact record/enum contract handed down by the
  orchestrator (`ActivityEventRecord`, `WeeklySummaryInput`, `ActivityStatus`, `DataStatus`,
  `MetricComparison`, `TypeBreakdown`, `LocationSummary`, `LocationCount`, `WeekToDateBlock`,
  `WeeklySummaryResult`).
- `Features/WeeklySummary/ReportingRules.cs` — tunable constants (`BaselineWeeks = 8`,
  `MinimumBaselineWeeks = 4`, `DeviationThreshold = 0.25m`, `AbsoluteFloorEvents = 3`, canonical
  event types).
- `Features/WeeklySummary/ReportingCalendar.cs` — pure UTC→local day/week math, plus
  `UtcQueryRange` for the (separate) repository agent's SQL bound.
- `Features/WeeklySummary/WeeklySummaryService.cs` — the classification engine.
- `Relay.Api.Tests/Features/WeeklySummary/ReportingCalendarTests.cs` (5 tests) and
  `WeeklySummaryServiceTests.cs` (18 tests). Deleted the template `UnitTest1.cs`.
- No new NuGet packages; no changes to `Program.cs`, `.csproj` files, `Data/**`, or `PLAN.md`.

## Design decisions beyond the literal spec

1. **`Build()` validates `WeekStart` is a Monday** and throws `ArgumentException` otherwise. Not
   explicitly requested, but the whole domain model assumes it; failing fast here is cheap and
   gives the API layer (owned by another agent) a natural place to catch and translate to a 400,
   consistent with PLAN.md's `400 invalid or non-Monday-aligned weekStart`.

2. **Sort-key tie-break for a zero-baseline "Above" location** (rule 9 in the spec). The spec says
   "Above (largest DeltaPct first)" but a zero-baseline Above has no `DeltaPct` (it's null by
   rule 5) — so there's nothing to rank by. Decision: zero-baseline Above entries sort *after* all
   percentage-driven Above entries (they have no magnitude signal to justify ranking above a real
   percentage), tie-broken by current count descending among themselves. This is a genuine gap in
   the spec, not a mistake I'm papering over — flagging it in case the orchestrator wants a
   different tie-break.

3. **Week-to-date `ByLocation` ordering** isn't specified. Chose count-descending, location-name
   tie-break, for consistency with the "worst/most-notable first" feel of the rest of the report.
   Low-stakes; easy to change.

4. **`TypeBreakdown` ordering scope**: applied the "canonical types always emitted, extras
   alphabetical" rule both at the account level and inside each `LocationSummary.ByType`, since the
   spec states the rule once but the shape has two places it could apply. Symmetric application
   seemed like the only sane reading — an account-level type present with 0 count but omitted at
   the location level (or vice versa) would be a confusing inconsistency.

## Mid-implementation correction from the orchestrator

**Original PLAN.md/spec rule (#2):** baseline weeks are "never earlier than the local week
containing `FirstEventUtc`." I implemented this literally first: `firstEventWeekStart =
WeekStartOf(ToLocalDay(FirstEventUtc))`, and any preceding week `>= firstEventWeekStart` was
eligible.

**Why it was wrong:** if the first event lands mid-week (e.g. Wednesday, or — the actual seed-data
shape — Sunday), the week *containing* it is only partially observed. Crediting it as a full
baseline week structurally undercounts that week's true total, which (a) drags the median down and
(b) can wrongly satisfy the 4-week minimum-history gate on the strength of a one-day week. The
orchestrator caught this and verified it concretely against `seed.sql`: 8 of the 20 accounts first
appear on Sunday 2026-02-01, and for reported week 2026-02-23 the old rule silently counted the
Jan-26 sliver-week as legitimate baseline, flipping the account from `InsufficientHistory` to `Ok`
on the strength of one observed day.

**Corrected rule:** a week is baseline-eligible only if it is *fully* observed — its own Monday
must be on or after the account's first observed local day. Implemented as
`FirstEligibleWeekStart`: if the first event's local day is itself a Monday, that week is eligible;
otherwise the *next* Monday is the first eligible week, and the partial week is excluded entirely
(not partially credited).

**Bug my own fix introduced, caught by the existing `NoActivity` test:** my first pass at the
corrected filter was `Where(w => firstEligibleWeekStart is null || w >= firstEligibleWeekStart.Value)`
— copy-pasted from the old null-handling pattern. But when `FirstEventUtc` is null (no events at
all), "eligible weeks = everything" is backwards: nothing has been observed, so nothing should be
eligible. `dotnet test` caught this immediately —
`NoActivity_AccountWithNoEvents_ReturnsNoActivityAndEmptyLocations` failed with
`BaselineWeeksUsed` = 8 instead of the expected 0. Fixed by short-circuiting to an empty list when
`firstEligibleWeekStart is null`, rather than treating null as "no lower bound." This is exactly
the kind of thing the corrected rule was supposed to prevent (crediting weeks that were never
actually observed), so it's a good sign the regression tests below are doing real work.

**Tests added per the correction** (in `WeeklySummaryServiceTests.cs`):
- `FirstEvent_OnLocalWednesday_ExcludesTheWeekContainingIt` — partial week dropped, `BaselineWeeksUsed == 2`.
- `FirstEvent_OnLocalMonday_IncludesTheWeekContainingIt` — same target week, fully observed, `BaselineWeeksUsed == 3`. (The Wednesday/Monday pair against the same week is a deliberate minimal contrast.)
- `FirstEvent_OnLocalSunday_ExcludesThePrecedingMondaysWeek` — the real seed-data shape.
- `GateFlip_FirstEventSundayFeb1_ReportedWeekFeb23_IsInsufficientHistoryNotOk` — the orchestrator's
  concrete regression case: `BaselineWeeksUsed == 3`, `DataStatus.InsufficientHistory`,
  `Totals.Status == NoVerdict`. Named to make it obvious this is the regression guard.
- `ObservedButEmptyBaselineWeeks_StillCountTowardBaselineAndMedian` — guards the flip side: an
  account with a Monday-aligned first event and two genuinely empty (but observed) weeks in its
  4-week baseline must still count `BaselineWeeksUsed == 4` and the zeros must still pull the
  median down (`5m`, not `10m` if the zeros were wrongly dropped).

Two pre-existing tests had to be adjusted because they built `FirstEventUtc` at Wednesday-noon
(via the `MidWeekUtc` helper, originally chosen just for "safely mid-day, no boundary risk") and
implicitly relied on the *old* rule to land on a specific `BaselineWeeksUsed` count:
`InsufficientHistory_FewerThanFourBaselineWeeks...` and `AccountLevelBaseline_IsNotSumOf...`. Both
were changed to use a Monday-aligned first event instead (added a `LocalInstantUtc` helper
alongside `MidWeekUtc`), so their intended baseline-week counts (2 and 4 respectively) are
preserved under the corrected rule. This is exactly the "false start" the task instructions asked
to be honest about: the mid-week timestamp was a reasonable default for "anywhere safely inside
the week" before the correction, and became a landmine once week-eligibility became
timestamp-sensitive.

## `dotnet test` output (final, from `backend/`)

```
Serie de pruebas para .../Relay.Api.Tests.dll (.NETCoreApp,Version=v8.0)
Versión 18.0.1 (x64) de VSTest

Iniciando la ejecución de pruebas, espere...
1 archivos de prueba en total coincidieron con el patrón especificado.

Correctas! - Con error:     0, Superado:    23, Omitido:     0, Total:    23, Duración: 77 ms - Relay.Api.Tests.dll (net8.0)
```

(23 = 5 `ReportingCalendarTests` + 18 `WeeklySummaryServiceTests`. `dotnet build` is clean, 0
warnings, 0 errors.)

## Nothing else in the spec struck me as wrong or ambiguous

Aside from the two items flagged above (zero-baseline Above sort tie-break, WTD `ByLocation`
order), the semantics rules were unambiguous enough to implement directly, and every worked
example in the spec (4→3 not flagged, 40→28 flagged, burst-week median robustness, account-level
baseline ≠ sum of per-location medians) checks out against the implementation as written.
