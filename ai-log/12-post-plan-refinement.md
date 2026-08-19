# AI log — 12: Post-plan refinement discovered during review (2026-08-19)

**This is not a change to `PLAN.md`.** `PLAN.md` remains the original pre-implementation plan and was not
edited. This entry records a refinement requested during review of the working implementation, after the
backend and dashboard had already shipped.

The request had two parts: expose the individual historical periods behind the 8-week median, and make it
obvious which locations deserve attention and what activity type moved most. The existing definition of
"normal" was explicitly to be preserved — no week-over-week comparison, no redesign.

## Analysis before touching code (requested explicitly)

The instruction was to inspect first and report the smallest set of changes, calling out anything the
architecture already supported. Three of the four asks needed **no backend change at all**:

| Ask | Already supported? |
|---|---|
| Prioritisation order `below` → `above` → `typical` → `noVerdict` | **Yes.** The domain already sorts locations worst-first and `LocationsTableComponent` renders in API order without re-sorting. The frontend only needed to *surface* a summary by filtering that ordered list. |
| Driver / activity-type explanation | **Yes.** `LocationSummaryResponse.ByType` already carries `current` and `baselineMedian` per type. Picking the largest mover is a presentation read of returned numbers, not reporting-window maths, so it stayed frontend-side as a pure tested function. |
| `noVerdict` as a calm data state | **Yes.** `describeStatus` already distinguished `baselineMedian === null` ("Not enough history") from `=== 0` ("No usual level for this period"), both neutrally styled. |
| Individual baseline windows | **No.** Genuinely absent — see below. |

So the API expanded by exactly one field.

## The one addition, and how the invariant was made structural

The per-window totals were being computed inside `WeeklySummaryService` and then thrown away. The frontend
could not derive them without reimplementing window math, which is forbidden.

The requirement was that displayed history must be *the exact samples the median used*, never an independent
recomputation. Rather than compute the list twice and trust two code paths to agree, the samples are now
materialised once and **the median is computed from the very list that is returned**:

```csharp
var comparisonHistory = baselineWeekStarts
    .Select(w => new BaselineWindow(w, ThroughDateFor(w, cutoff), WindowedWeek(w).Count))
    .ToList();
var totalBaselineWeekly = comparisonHistory.Select(h => h.Total).ToList();
var totals = Classify(reportedWeekEvents.Count, totalBaselineWeekly, dataStatus);
```

Divergence is now impossible by construction rather than by discipline. `ThroughDateFor` was extracted so the
reported week and every historical window derive their display date from one rule, and each window inherits
the **same cutoff**, so a partial current week is compared against equivalently partial historical windows.

Two judgement calls beyond the brief:
- **Account-level history only**, not per location. The requested UX is account-level; per-location history
  would multiply the payload by 15 for the largest account with nothing asking for it.
- **History is returned even when `dataStatus` is not `ok`.** Showing the one-to-three windows that do exist
  is more honest than showing nothing; the median row is simply omitted.

## Verified against the seed data, not just against tests

Completed week (account 1, week of 2026-07-20) — the eight returned totals match the independent Python
oracle's values exactly, reversed into most-recent-first order, and the median recomputes from them:

```
2026-07-13 -> 2026-07-19 : 50      reported median : 46.5
2026-07-06 -> 2026-07-12 : 43      recomputed      : 46.5
2026-06-29 -> 2026-07-05 : 62
2026-06-22 -> 2026-06-28 : 39      current: 53  status: typical
...
```

In-progress week (account 1, week of 2026-07-27) — every historical window is Monday-only
(`throughDate == weekStart`), confirming equivalent elapsed windows rather than full past weeks:

```
2026-07-20 -> 2026-07-20 : 8       reported median : 10
2026-07-13 -> 2026-07-13 : 12      recomputed      : 10
...                                current: 9   status: typical
```

Insufficient history (account 1, week of 2026-02-23): `baselineWeeksUsed: 3`, three windows returned,
`baselineMedian: null`. Zero-activity account 20: history empty.

Backend tests: **35 passing** (26 existing, 9 added covering window identity, explicit zero windows, partial
vs complete equivalence, median reproducibility, `noVerdict` locations surviving, and per-type totals
reconciling with the location total).

## A mistake I made, and caught

My first edit to `Contracts.cs` inserted the new `HistoricalComparisonResponse` record *between*
`WeeklySummaryResponse`'s doc comment block and the record itself. The orphaned `<param name="ThroughDate">`
then bound to the new record — so the generated OpenAPI described a historical window with the *weekly
summary's* through-date semantics, and `WeeklySummaryResponse.throughDate` lost its documentation entirely.

Compilation was clean and all 35 tests passed; nothing failed. It surfaced only because I read the generated
schema after regenerating the client and noticed the description did not match what I had written. Worth
recording because the tests could never have caught it: the defect lived entirely in the API documentation
that the frontend's generated client consumes.
