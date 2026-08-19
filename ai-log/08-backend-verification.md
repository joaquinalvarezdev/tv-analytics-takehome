# AI log — 08: Orchestrator verification of the backend slice (2026-08-19)

Independent verification by the orchestrator (Fable 5) of the work delivered by the three Sonnet agents
(`03-backend-foundation`, `04-weekly-summary-domain`, `05-domain-amendment`, `07-api-layer`). Nothing here was
taken on the agents' word.

## Method: an independent oracle, not the agents' own code

Checking aggregation with the same code that produced it proves only self-consistency. So the aggregates were
re-derived by a **separate implementation in a different language** — Python + `zoneinfo`, parsing `seed.sql`
directly, written by the orchestrator and never shown to the implementing agents. It reimplements the same
product rules from the spec: local-day bucketing, Monday-aligned weeks, fully-observed-week eligibility,
zero-filled baseline windows, equivalent-window truncation at the anchor's local time-of-day, median baseline,
and the threshold/floor classification.

Then every field of five live API responses was deep-compared against it — including nested per-location and
per-event-type rows, with numeric tolerance for the decimal/float boundary.

| Case | What it exercises |
|---|---|
| `/api/accounts/1/weekly-summary` | in-progress week; partial-window comparison |
| `?weekStart=2026-07-20` (acct 1) | completed week |
| acct 6 `?weekStart=2026-06-01` | the 805-event burst day; 15 locations × 3 event types |
| acct 16 `?weekStart=2026-07-20` | sparse account, +23.1% — just under the 25% threshold, correctly unflagged |
| acct 20 | `noActivity` |

**Result: 0 differences across all five, every nested field.** Error semantics verified separately: 404 unknown
account; 400 for a non-Monday, a future week, and an unparseable date.

## Zero-fill audit (prompted by a human challenge)

The human challenged whether baseline medians were computed only over windows that *have* events — which would
silently omit zero-count windows and bias the baseline upward. Re-verified with a fresh implementation drawing
samples from the **window list** rather than from any grouping of the event table, asserting
`len(samples) == len(eligible windows)` on every window set: **397 window sets checked, 0 mismatched.**

That audit also corrected an orchestrator claim. "Zero baseline medians never occur" held only for *full-week*
windows (0 / 1 446 location-weeks; minimum median actually 2). Under the amended partial-window comparison they
occur in **13.62% of location-windows** — so the branch is load-bearing, not dead code. This is why the invented
`>= 3` zero-baseline rule was removed rather than kept: it would have authored the verdict on roughly one in
seven visible rows every Monday morning.

## Fixed during review

- **OpenAPI `required` lists were absent**, so every field would have generated as optional TypeScript, pushing
  the frontend into `?.` chains and non-null assertions on values the API always sends — exactly what
  `frontend/CLAUDE.md` forbids. Added a schema filter marking non-nullable properties required. The nullable
  ones (`firstSelectableWeekStart`, `baselineMedian`, `deltaRatio`) are deliberately excluded so their
  *meaningful* null survives into the client. Re-ran the oracle diff afterwards: still 0 differences.

## A false alarm worth recording

Swagger descriptions appeared corrupted (`â€"` where an em dash belonged), which looked like a UTF-8/ANSI
mishandling of the XML documentation file. It was **not**: the byte was verified as a proper `U+2014`, and the
corruption existed only in the orchestrator's own console output, because Python's `open()` defaults to the
Windows locale encoding rather than UTF-8. Checking before "fixing" avoided breaking working code and filing a
defect that did not exist.

## Environment issue resolved

Host port 1433 is owned by a pre-existing native `SQL Server (SQLEXPRESS)` service on this machine, so host
connections never reached the container. Compose now maps host **14330** → container 1433. Verified end to end:
migrations apply, the seed importer logs a skip on the second run, and the API serves real data from the host.

## State at this point

`dotnet build` clean; **26/26** domain tests pass; both endpoints verified against the oracle; frontend scaffold
lints, builds, and passes 15 headless tests. Remaining: the dashboard UI against the generated OpenAPI client,
then README and the final reflection.
