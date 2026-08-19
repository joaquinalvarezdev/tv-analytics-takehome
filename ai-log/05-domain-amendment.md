# AI log — 05: Domain amendment (partial-week comparison, zero-baseline NoVerdict) (2026-08-19)

Sonnet implementation agent amending the already-merged, already-tested `WeeklySummary` domain logic
(23/23 passing baseline) per the orchestrator's spec. Boundary: `backend/Relay.Api/Features/WeeklySummary/**`,
`backend/Relay.Api.Tests/**`, this file. No other files touched.

## What changed and why

### 1. `ReportingCalendar.ToLocal`

Added `ToLocal(DateTime utcInstant, TimeZoneInfo tz) -> DateTime` (local wall clock, not just the date).
`ToLocalDay` now delegates to it (`DateOnly.FromDateTime(ToLocal(...))`). Mechanical, no behaviour change
to any existing caller.

### 2. Partial-week comparison replaces the raw, unclassified week-to-date block

**The ticket-fit argument.** DASH-247 asks "is this normal for us?" for a customer admin looking Monday
morning. The old design refused to classify the in-progress week and bolted on a separate, unclassified
`WeekToDate` block — under-answering the actual question the ticket asks. The fix: always compare the
*elapsed portion* of the selected week against the *same elapsed window* in each baseline week. A completed
week is the case where the elapsed portion is the whole week (`cutoff = (7, TimeOnly.MinValue)`), so this is
a generalization, not a special case bolted alongside the old logic.

**Why time-of-day, not just date.** The dataset anchor is Monday 22:20 UTC = 15:20–18:20 local depending on
timezone. Per the orchestrator's spec, measured against seed data: 6.6% of Monday events on average (16.1%
worst case) occur after that local time. Truncating baseline Mondays by date only (not time) would count
those trailing-Monday events in full in every baseline week while the current week's Monday is genuinely
cut off — inflating every baseline and biasing the dashboard toward false "below normal" verdicts. Test
`InProgressWeek_TruncatesBaselineWeekEventsByTimeOfDay_NotJustByDate` is built specifically to fail if the
comparison degrades to date-only: it places one event before and one after the cutoff clock time on the
*same* baseline-week day, and asserts the post-cutoff one is excluded (median would be 2m instead of 1m if
date-only).

**Why calendar (dayIndex, timeOfDay) comparison, not elapsed time.** A local week can be 167h (spring-forward)
or 169h (fall-back) across a DST transition. Elapsed-hours-from-week-start math silently mis-buckets events
near a transition. Comparing lexicographically on `(dayIndex, timeOfDay)` — both computed from local
wall-clock values via `TimeZoneInfo.ConvertTimeFromUtc` — is immune by construction, since it never computes
or compares a duration. `DstSpringForwardWeek_PartialWindow_BucketsCorrectly` reports the 2026-03-02 week
(the 167h week) in-progress with the anchor on the post-transition Sunday, and checks an event just before
vs. just after the cutoff clock time on the transition day itself buckets correctly. This is the regression
guard against a future refactor "simplifying" this into `(anchorUtc - weekStartUtc)` arithmetic.

**Implementation.** `ComputeCutoff(anchorUtc, tz, weekStart)` returns `(DayIndex, TimeOnly)`: `(7, MinValue)`
for a completed week, or `(anchor's local day-index within the reported week, anchor's local time-of-day)`
for the in-progress week. This cutoff is computed **once**, from the relationship between the *reported*
week and the anchor — then applied identically to the reported week and to every baseline week via
`IsInWindow(event, tz, thatWeek'sMonday, cutoff)`. The symmetry (same cutoff tuple, re-anchored to each
week's own Monday) is what makes the comparison honest; this is the entire point of the change and is
called out explicitly in code comments so it isn't accidentally broken by a future edit that special-cases
the reported week.

One correction I made to my own first draft: `DateOnly` does not support the `-` operator between two
`DateOnly` values in .NET 8 (it only supports `AddDays`/comparison) — the build failed on
`(DateOnly - DateOnly).Days`. Fixed by using `.DayNumber` (an `int`) and subtracting those instead. Caught
immediately by `dotnet build`, not a silent bug, but recording it because it's a real false start.

### 3. `WeekToDateBlock`/`LocationCount` removed; `ThroughDate` added

Per spec: deleted both records and the `WeekToDate` property. Added `DateOnly ThroughDate` to
`WeeklySummaryResult`, computed as `weekEnd` when `cutoff.DayIndex >= 7` (completed week) or
`weekStart.AddDays(cutoff.DayIndex)` (in-progress week — the anchor's local day). XML-doc'd explicitly as a
**display value only**: the precise cutoff (day index + time-of-day) is intentionally not exposed, so no
consumer can reimplement window math against it.

Field order as specified: `WeekStart, WeekEnd, ThroughDate, DataStatus, BaselineWeeksUsed, Totals, ByType,
Locations`.

### 4. Zero-baseline verdict fabrication removed

Deleted the `median == 0m` branch that returned `Above` (if `current >= AbsoluteFloorEvents`) or `Typical`
otherwise. Replaced with `new MetricComparison(current, 0m, null, ActivityStatus.NoVerdict)` — unchanged for
the "totally new account, no history at all" case (that was always `NoActivity`/`InsufficientHistory` at the
`DataStatus` level, orthogonal to this), but *load-bearing* for the new partial-window comparison: per the
spec, a zero baseline median never occurred in the old full-week-only world (0/1,446 location-weeks) but
occurs in 13.62% of location-windows once partial weeks are compared against equivalently-truncated
baselines (e.g., a location whose activity all happens in the afternoon has a genuinely-zero baseline median
for a Monday-morning cutoff, even though its full-week baseline is nonzero). The old `current >= 3 -> Above`
rule was a product threshold invented with no basis in the ticket, applied in exactly the case where there's
no baseline to be "above" *of*. Replacing it with `NoVerdict` (keeping `BaselineMedian = 0m`, distinguishable
from `null`) is honest: it says "current count observed, no comparable history for it" instead of asserting
a judgement the data can't support.

`AbsoluteFloorEvents` is untouched in the normal (`median > 0`) path, as instructed.

One consequence I traced through but that isn't itself a code change: `SortKey`'s `Above` branch previously
had a null-`DeltaPct` fallback (`decimal.MaxValue, -Current`) for the old zero-baseline-`Above` case. That
case is now impossible — `Above` only ever comes from a non-zero median — so I simplified that branch to
`(1, -t.DeltaPct!.Value, 0m)` and updated the stale XML-doc remark that referenced the old dead case. No
test previously exercised that null-delta sort branch (nothing in the 23 preserved tests reaches `Above`
from a zero baseline, since the deleted `ZeroBaseline_CurrentAtFloor_IsAbove` test was the only thing that
could have), so this is a pure cleanup with no coverage regression.

### 5. Future-week rejection

Added a second guard in `Build`, after the existing non-Monday check: throws `ArgumentException` when
`WeekStart > ReportingCalendar.CurrentWeekStart(AnchorUtc, TimeZone)`. `FutureWeekStart_ThrowsArgumentException`
covers it. Not implemented: the API-layer 400 mapping — spec explicitly scopes that to a later task.

## Tests

Deleted (per spec, obsolete): `WeekToDate_PresentOnlyForLastCompleteWeek_WithRawCounts`,
`WeekToDate_NullForWeeksOtherThanTheLastCompleteWeek`, `ZeroBaseline_CurrentBelowFloor_IsTypical`,
`ZeroBaseline_CurrentAtFloor_IsAbove`.

Added 7: `ZeroBaseline_ReturnsNoVerdict_NotAFabricatedTier`,
`InProgressWeek_ComparesEquivalentTruncatedWindows_NotFullBaselineWeeks`,
`InProgressWeek_TruncatesBaselineWeekEventsByTimeOfDay_NotJustByDate`,
`CompletedWeek_IncludesEveryEvent_AndThroughDateIsWeekEnd`, `ThroughDate_IsAnchorLocalDay_ForInProgressWeek`,
`DstSpringForwardWeek_PartialWindow_BucketsCorrectly`, `FutureWeekStart_ThrowsArgumentException`.

**Bug my own tests caught before the run:** in my first draft of the two `InProgressWeek_*` fixtures I used
`EarlyFirstEvent` (2020) with baseline data populated for only 4 of the 8 possible baseline weeks. Since
`BaselineWeeks = 8` and `EarlyFirstEvent` makes all 8 weeks eligible, the other 4 (unpopulated) weeks would
have entered as legitimate zeros — median of `[4,4,4,4,0,0,0,0] = 2`, not the `4` the test asserted. Caught
this by hand-tracing the fixture before running (not by a failing test — I fixed it pre-run), but it's the
same class of mistake the orchestrator's own mid-implementation correction (§5 of `02-orchestration-dispatch.md`)
guards against: baseline-week population and eligibility windows have to be reasoned about together. Fixed
by setting `firstEventUtc` exactly on the Monday of `weekStart-28`, bounding eligible baseline weeks to
exactly the 4 populated ones, matching the pattern already used by `AccountLevelBaseline_IsNotSumOfPerLocationMedians`.

The remaining 19 tests were **not modified** and pass unchanged, as expected — their anchors sit ~90 days
past the reported week (`MakeInput`'s `anchorUtc = MidWeekUtc(weekStart.AddDays(90), tz)`), so
`weekStart != CurrentWeekStart(anchorUtc, tz)` always holds and `cutoff = (7, MinValue)` for all of them,
i.e., full-week semantics identical to before this change.

## Disagreements / things I'd flag to the orchestrator

None that required stopping. The spec was unambiguous everywhere I needed it, including the one place I
expected friction (interaction between the eligibility-window fix from `02-orchestration-dispatch.md` §5 and
the new partial-window cutoff) — they compose cleanly because eligibility is about *which weeks* are baseline
candidates (unchanged) and the cutoff is about *how much of each candidate week* counts (new), and both are
computed relative to the same `weekStart`/`AnchorUtc` inputs without touching each other's logic.

The one thing genuinely worth the orchestrator's attention: the `SortKey` simplification in Change 4's
aftermath (dead branch removal + stale-comment fix) is a small deviation beyond the letter of the spec, which
only asked to delete the `Classify` branch. I made the call because leaving the dead branch would have meant
either an inaccurate code comment or an untested unreachable path — but it's a design judgement, not a pure
mechanical instruction, so flagging it explicitly rather than burying it in the diff.

## Verification (real output)

```
$ cd backend && dotnet build
  Relay.Api -> C:\Development\tv-analytics-takehome\backend\Relay.Api\bin\Debug\net8.0\Relay.Api.dll
  Relay.Api.Tests -> C:\Development\tv-analytics-takehome\backend\Relay.Api.Tests\bin\Debug\net8.0\Relay.Api.Tests.dll
Compilación correcta.
    0 Advertencia(s)
    0 Errores

$ dotnet test
Correctas! - Con error:     0, Superado:    26, Omitido:     0, Total:    26, Duración: 101 ms - Relay.Api.Tests.dll (net8.0)
```

26/26 pass: 19 preserved + 7 new (4 deleted, per spec).
