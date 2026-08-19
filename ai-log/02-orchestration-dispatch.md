# AI log — 02: Implementation phase 1, orchestration & dispatch (2026-08-19)

**Tooling:** Claude Code. Orchestrator = Fable 5 (architecture, contracts, review, integration). Implementers =
two Sonnet agents. Division of labour: the orchestrator wrote the specs below and made every product/architecture
decision in them; the agents wrote the code and ran the verification.

Human instruction that opened this phase: act as orchestrator, do not implement everything yourself, break the work
into focused tasks, delegate to Sonnet agents, parallelise only genuinely independent work, do not start the
frontend, and surface material architectural decisions or deviations from `PLAN.md`.

## 1. Orchestrator work before dispatch

Read root/backend/frontend `CLAUDE.md`, `PLAN.md`, `docs/TAKE_HOME_PROMPT.md`, `schema.sql`, `docker-compose.yaml`,
the backend scaffold, and the head of `seed.sql`. Then established the environment facts myself rather than making
the agents rediscover them (and burn budget on it):

- `dotnet build` on the untouched scaffold succeeds; `dotnet-ef` 8.0.30 is installed globally.
- `docker compose up -d` → SQL Server 2022 container up on 1433. (A stopped `postgres:16` orphan container from an
  earlier scaffold commit is present; left alone.)

## 2. Decisions the orchestrator made at dispatch time (beyond `PLAN.md`)

`PLAN.md` is left as written. These are decisions it did not cover, or small contract adjustments it flagged as
"draft, may get small shape adjustments during review":

1. **`FirstEventUtc` added to the domain input.** `PLAN.md` says "up to the 8 complete weeks immediately preceding"
   with a 4-week minimum, but never defines what makes a preceding week *available*. Taken literally, 8 calendar
   weeks always exist, so an account with two weeks of history would get a median polluted by six structural
   zeroes — and would pass the 4-week gate while being exactly the case that gate exists to catch. Ruled: baseline
   weeks are bounded below by the local week of the account's first event. That fact is not derivable from a
   bounded query window, so it becomes an explicit input, and the repository must supply `MIN(occurred_at)` per
   account. This is the one contract change of the phase with real semantic weight.
2. **`NoVerdict` status + nullable baseline.** `PLAN.md`'s draft shape has a non-nullable `status`. Forcing
   `typical` on an account with insufficient history would be a fabricated verdict. Added
   `ActivityStatus.NoVerdict` and made `BaselineMedian`/`DeltaPct` nullable so "we don't know" is representable.
3. **Dropped the duplicated location-level `status`.** The draft contract carried both `location.status` and
   `location.total.{...}`. One status, on the comparison object. Less to keep consistent, nothing lost.
4. **Query range is widened ±1 day and is not the semantic boundary.** Local-day bucketing via
   `ConvertTimeFromUtc` is the rule; the UTC range only bounds the SQL query. Computing local-midnight→UTC
   boundaries and comparing instants is the classic DST-week bug, so the spec forbids that path outright.
5. **Location set = reported week ∪ baseline weeks.** A location that went to zero this week would silently vanish
   from a reported-week-only grouping — that is precisely the "which location needs attention" case the ticket is
   about.
6. **Worst-first sort defined explicitly:** `Below` (most negative first), then `Above` (largest first), then
   `Typical`/`NoVerdict` by current volume, name-tiebroken for determinism.
7. **`seed.sql` linked into the build output** via a csproj `Content` link rather than copied into the API project
   — the dataset stays a single verbatim file in the repo.
8. **One index, `(account_id, occurred_at)`**, justified by the only query shape the feature has. No speculative
   indexes.
9. **Task 2 runs in an isolated git worktree.** Both tasks compile the same projects; concurrent MSBuild on shared
   `bin`/`obj` produces file-lock failures that would look like real bugs. The file sets are disjoint, so the
   orchestrator merges. This is the only reason for the isolation — not a code boundary.

Both agents were told explicitly: if a rule in the spec turns out to be wrong or ambiguous, stop and report rather
than bending the code or the test to match.

## 3. Verbatim dispatch prompt — Task 1 (backend foundation, Sonnet)

> You are implementing **Task 1 (Backend foundation)** of DASH-247 in `C:\Development\tv-analytics-takehome`. You are a Sonnet implementation agent; the orchestrator (Opus) owns architecture, the API contract, and final review.
>
> ## Read first (mandatory)
> - `CLAUDE.md` (root), `backend/CLAUDE.md`, `PLAN.md` — PLAN.md is authoritative. Do not rewrite PLAN.md.
> - `schema.sql`, `docker-compose.yaml`, and the first ~30 lines of `seed.sql`.
>
> ## Hard boundaries (another agent is working in parallel)
> You own ONLY:
> - `backend/Relay.Api/Data/**`
> - `backend/Relay.Api/Migrations/**`
> - `backend/Relay.Api/Program.cs`
> - `backend/Relay.Api/appsettings.json`, `appsettings.Development.json`
> - `backend/Relay.Api/Relay.Api.csproj`
> - `ai-log/02-backend-foundation.md` (new file, see below)
>
> You MUST NOT touch:
> - `backend/Relay.Api/Features/**` (another agent owns the WeeklySummary domain logic)
> - `backend/Relay.Api.Tests/**` (owned by the other agent)
> - `PLAN.md`, `README.md`, `schema.sql`, `seed.sql`, `docker-compose.yaml`
>
> ## Environment facts (already verified by the orchestrator — do not re-verify)
> - .NET SDKs installed: 8-compatible; projects target `net8.0`. `dotnet build` from `backend/` currently succeeds.
> - `dotnet-ef` global tool 8.0.30 is installed.
> - SQL Server 2022 container is already running: `docker compose up -d` done, container `tv-analytics-takehome-sqlserver-1`, port 1433, `sa` / `RelayLocal123!` (dev-only password already committed in docker-compose.yaml).
> - Shell: you are on Windows. The Bash tool runs Git Bash; the PowerShell tool runs Windows PowerShell 5.1. Prefer the Bash tool for multi-line/quoted commands.
>
> ## What to build
>
> ### 1. Entities (`backend/Relay.Api/Data/`)
> `Account` and `ActivityEvent`, mapped exactly to `schema.sql`:
> - `accounts`: `id` INT PK, `name` varchar(120), `industry` varchar(60), `timezone` varchar(60) (IANA id), `created_at` datetime2 (UTC).
> - `activity_events`: `id` INT PK, `account_id` INT FK → accounts, `location` varchar(80), `event_type` varchar(40), `occurred_at` datetime2 (UTC), `duration_seconds` INT NULL, `outcome` varchar(40) NULL.
>
> Requirements:
> - Table and column names must match `schema.sql` snake_case exactly (use explicit `ToTable`/`HasColumnName` or a consistent convention — be explicit, not clever).
> - IDs are supplied by the seed data → configure `ValueGeneratedNever()`. Do NOT use identity columns.
> - `schema.sql` uses `VARCHAR`, not `NVARCHAR` → configure `IsUnicode(false)` with the stated max lengths.
> - `occurred_at`/`created_at` → `datetime2`. Store as UTC; when materialising, `DateTime.Kind` should be `Utc` (SQL Server `datetime2` round-trips as `Unspecified` — handle this deliberately, e.g. a value converter, and say what you chose in your notes).
> - Add an index on `(account_id, occurred_at)`. Justification: every reporting query filters by account and a UTC time range. Do not add other speculative indexes.
> - Use nullable reference types correctly.
>
> ### 2. `RelayDbContext` in `backend/Relay.Api/Data/`
> Fluent configuration (either inline in `OnModelCreating` or `IEntityTypeConfiguration` classes — your call, keep it proportional). No generic repository framework.
>
> ### 3. Connection string
> Database name `RelayAnalytics`. Put the dev connection string in `appsettings.Development.json` under `ConnectionStrings:RelayDb`:
> `Server=localhost,1433;Database=RelayAnalytics;User Id=sa;Password=RelayLocal123!;TrustServerCertificate=True;Encrypt=False`
> Keep `appsettings.json` free of the password (the compose password is already public in the repo, but the shape should still be dev-override-based).
>
> ### 4. `InitialCreate` migration
> Generate a **real** EF migration (`dotnet ef migrations add InitialCreate --project Relay.Api --startup-project Relay.Api`). Do not hand-write it. Verify it applies against the running container.
>
> ### 5. Idempotent seed importer (`backend/Relay.Api/Data/SeedImporter.cs`)
> - Parses `seed.sql` INSERT statements directly (no `sqlcmd` dependency) and bulk-inserts.
> - Idempotent: if `accounts` already has rows, skip entirely and log that it skipped.
> - Handle: `NULL` literals for `duration_seconds` / `outcome`, single-quote escaping (`''`) inside string literals, and `'yyyy-MM-dd HH:mm:ss'` timestamps parsed as **UTC** (`DateTimeKind.Utc`, invariant culture).
> - **Do NOT deduplicate.** The dataset deliberately contains 12 rows that are identical except for `id`. Preserving them is a product decision recorded in PLAN.md. Do not "clean" or normalise anything.
> - Performance: ~12.6k rows. Disable change tracking (`ChangeTracker.AutoDetectChangesEnabled = false`) and insert in batches. It should complete in seconds, not minutes.
> - Make `seed.sql` available at runtime without duplicating it in git: add to `Relay.Api.csproj`
>   `<Content Include="..\..\seed.sql" Link="seed.sql" CopyToOutputDirectory="PreserveNewest" />`
>   and resolve the path from `AppContext.BaseDirectory`.
> - Fail loudly (throw with a clear message) if the file is missing or a line fails to parse — silent partial seeding is worse than a crash.
>
> ### 6. `Program.cs`
> - Register `RelayDbContext` with the SQL Server provider.
> - On startup: apply migrations (`Database.Migrate()`), then run the seed importer.
> - Remove the `WeatherForecast` template endpoint and its record — it is template noise.
> - Keep Swagger wired up. Do NOT add feature endpoints; a later task owns the API layer.
>
> ## Verification (required — do not claim success without output)
> 1. `cd backend && dotnet build` → clean.
> 2. Run the API once so migrations + seeding execute (`dotnet run --project Relay.Api`, then stop it). The container may need ~20–40s after start before it accepts connections; retry rather than concluding it is broken.
> 3. Verify the loaded data with SQL. `sqlcmd` lives inside the container:
>    `docker exec tv-analytics-takehome-sqlserver-1 /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P 'RelayLocal123!' -C -d RelayAnalytics -Q "SELECT COUNT(*) FROM accounts; SELECT COUNT(*) FROM activity_events;"`
>    Expected: **20 accounts**, **12626 activity_events**.
> 4. Also verify: `SELECT MIN(occurred_at), MAX(occurred_at) FROM activity_events;` → expected max `2026-07-27 22:20:xx`, min `2026-02-01 10:57:44`.
> 5. Re-run the API a second time and confirm seeding is skipped and counts are unchanged (idempotency proof).
> 6. Confirm the 12 duplicates survived:
>    `SELECT COUNT(*) FROM (SELECT account_id, location, event_type, occurred_at, COUNT(*) c FROM activity_events GROUP BY account_id, location, event_type, occurred_at HAVING COUNT(*) > 1) x;`
>    Report whatever number you get; do not "fix" it.
>
> ## Notes file
> Write `ai-log/02-backend-foundation.md`: what you built, any decision you had to make that PLAN.md did not specify, anything in the task spec you think is wrong, and the **actual verification command output** (counts, min/max). Be honest about anything that failed on the first attempt — that is useful evidence, not something to hide.
>
> ## Report back
> Return a concise summary: files created, decisions made, verification output, and anything you believe the orchestrator must decide. Do not pad. If you hit something that contradicts PLAN.md or this spec, stop and report it rather than silently choosing.

## 4. Verbatim dispatch prompt — Task 2 (WeeklySummary domain logic, Sonnet, isolated worktree)

> You are implementing **Task 2 (WeeklySummary domain logic + tests)** of DASH-247. You are a Sonnet implementation agent; the orchestrator (Opus) owns architecture, the API contract, and final review.
>
> You are running in an **isolated git worktree** of `C:\Development\tv-analytics-takehome`. Work only inside your worktree. Another agent is concurrently building the EF/DB layer in the main tree — you must stay out of its files.
>
> ## Read first (mandatory)
> - `CLAUDE.md` (root), `backend/CLAUDE.md`, `PLAN.md` — PLAN.md is authoritative. Do not rewrite PLAN.md.
>
> ## Hard boundaries
> You own ONLY:
> - `backend/Relay.Api/Features/WeeklySummary/**` (new)
> - `backend/Relay.Api.Tests/**` (including deleting the template `UnitTest1.cs`)
> - `ai-log/03-weekly-summary-domain.md` (new file)
>
> You MUST NOT touch: `backend/Relay.Api/Program.cs`, `backend/Relay.Api/Relay.Api.csproj`, `backend/Relay.Api/Data/**`, `appsettings*.json`, `PLAN.md`, `README.md`, `seed.sql`, `schema.sql`.
>
> ## Core constraint
> This code is **pure domain logic with zero EF/database dependency**. It takes plain records in and returns plain records out. No `DbContext`, no LINQ-to-SQL, no async, no I/O. It must be fully unit-testable with hand-built inputs. Add **no new NuGet packages** (xUnit + plain `Assert` is sufficient; do not add FluentAssertions).
>
> ## The contract (orchestrator-owned — implement exactly this shape)
>
> Namespace `Relay.Api.Features.WeeklySummary`.
>
> ```csharp
> public sealed record ActivityEventRecord(string Location, string EventType, DateTime OccurredAtUtc);
>
> public sealed record WeeklySummaryInput(
>     TimeZoneInfo TimeZone,
>     DateOnly WeekStart,            // Monday, account-local
>     DateTime AnchorUtc,            // dataset-wide MAX(occurred_at), treated as "now"
>     DateTime? FirstEventUtc,       // account's earliest event; null => account has no events at all
>     IReadOnlyList<ActivityEventRecord> Events);
>
> public enum ActivityStatus { Below, Typical, Above, NoVerdict }
> public enum DataStatus { Ok, InsufficientHistory, NoActivity }
>
> public sealed record MetricComparison(int Current, decimal? BaselineMedian, decimal? DeltaPct, ActivityStatus Status);
> public sealed record TypeBreakdown(string EventType, int Current, decimal? BaselineMedian);
> public sealed record LocationSummary(string Location, MetricComparison Total, IReadOnlyList<TypeBreakdown> ByType);
> public sealed record LocationCount(string Location, int Count);
> public sealed record WeekToDateBlock(DateOnly WeekStart, DateOnly ThroughDate, int Total, IReadOnlyList<LocationCount> ByLocation);
>
> public sealed record WeeklySummaryResult(
>     DateOnly WeekStart,
>     DateOnly WeekEnd,              // inclusive Sunday
>     DataStatus DataStatus,
>     int BaselineWeeksUsed,
>     MetricComparison Totals,
>     IReadOnlyList<TypeBreakdown> ByType,
>     IReadOnlyList<LocationSummary> Locations,   // sorted worst-first, see rules
>     WeekToDateBlock? WeekToDate);
> ```
>
> Entry point: `public sealed class WeeklySummaryService { public WeeklySummaryResult Build(WeeklySummaryInput input); }`
> (No interface unless a test genuinely needs one — it does not.)
>
> ### Tunable constants — one place, e.g. `ReportingRules`
> - `BaselineWeeks = 8` (trailing complete weeks)
> - `MinimumBaselineWeeks = 4`
> - `DeviationThreshold = 0.25m`
> - `AbsoluteFloorEvents = 3`
> - Canonical event types: `call_received`, `lead_created`, `appointment_set`
>
> ### `ReportingCalendar` (pure, static, separately testable)
> - `DateOnly ToLocalDay(DateTime utcInstant, TimeZoneInfo tz)`
> - `DateOnly WeekStartOf(DateOnly localDay)` → the Monday of that local week
> - `DateOnly CurrentWeekStart(DateTime anchorUtc, TimeZoneInfo tz)`
> - `DateOnly LastCompleteWeekStart(DateTime anchorUtc, TimeZoneInfo tz)` (= CurrentWeekStart − 7d)
> - `(DateTime FromUtcInclusive, DateTime ToUtcExclusive) UtcQueryRange(DateOnly localStartInclusive, DateOnly localEndExclusive, TimeZoneInfo tz)` — used later by the repository to bound its SQL query.
>
> **Bucketing rule (correctness-critical):** an event belongs to the account-local calendar day of its UTC instant. Convert UTC→local with `TimeZoneInfo.ConvertTimeFromUtc` and take the date. Do NOT try to compute local-midnight→UTC boundaries and compare instants — that path is where DST bugs live. For `UtcQueryRange`, deliberately **widen the range by one day on each side** and document that the service re-filters precisely by local day; the range is a query bound, not the semantic boundary. `TimeZoneInfo.FindSystemTimeZoneById` accepts IANA ids on .NET 8 — use IANA ids (`America/Chicago`, `America/Phoenix`, `UTC`) in tests.
>
> ## Semantics (product decisions — implement exactly; do not improvise)
>
> 1. **Reported week** = `[WeekStart, WeekStart+7)` in local days. `WeekEnd` returned is the inclusive Sunday (`WeekStart+6`).
> 2. **Baseline weeks** = the complete weeks immediately preceding `WeekStart`, at most `BaselineWeeks`, and never earlier than the local week containing `FirstEventUtc`. `BaselineWeeksUsed` = that count. A baseline week with zero events counts as a legitimate `0` (a quiet week is signal), but weeks before the account's first event are *not* baseline weeks at all.
> 3. **DataStatus**: `NoActivity` if `FirstEventUtc` is null (account has no events at all — e.g. seed account 20). Else `InsufficientHistory` if `BaselineWeeksUsed < MinimumBaselineWeeks`. Else `Ok`.
>    - When not `Ok`: still return the reported week's **raw current counts** (totals, byType, locations), but `BaselineMedian` and `DeltaPct` must be `null` and every `Status` must be `NoVerdict`. Never fabricate a verdict.
> 4. **Median**: standard median over the baseline weeks' weekly values; even count → mean of the two middle values (hence `decimal`).
> 5. **Classification** (only when `DataStatus == Ok`), applied to a current value vs its baseline median:
>    - If `median == 0`: `DeltaPct = null`; `Above` if `current >= AbsoluteFloorEvents`, otherwise `Typical`.
>    - Else `DeltaPct = (current - median) / median`. Flag `Above`/`Below` only when **both** `|DeltaPct| >= DeviationThreshold` **and** `|current - median| >= AbsoluteFloorEvents`. Otherwise `Typical`.
>    - Worked examples that must hold: 4→3 is NOT flagged (fails the floor); 40→28 IS flagged `Below`.
> 6. **Account-level baseline is computed independently** from account-wide weekly totals — `median(weekly account total)`. It is explicitly **not** the sum of per-location medians. Same for each `ByType` entry: `median(weekly count of that type)`.
> 7. **Per-location status is on total activity only.** `ByType` rows inside a location are current-vs-median detail with no independent verdict — set their `BaselineMedian`, but they carry no status field by design (per PLAN.md: per-type statuses would be noise at this sparsity).
> 8. **Location set** = the union of locations appearing in the reported week **or** in any baseline week. A location that was busy in the baseline and had **zero** events this week must still appear with `Current = 0` — that is precisely the "which location needs attention" case.
> 9. **Sort order (worst-first)**: `Below` first (most negative `DeltaPct` first), then `Above` (largest `DeltaPct` first), then `Typical`/`NoVerdict` (largest `Current` first). Ties broken by location name for determinism.
> 10. **`ByType` ordering**: canonical order `call_received`, `lead_created`, `appointment_set`, then any unexpected type alphabetically. Always emit all three canonical types even when the count is 0. Unknown event types still count toward totals — do not drop data.
> 11. **Week-to-date block**: present **only** when `WeekStart == LastCompleteWeekStart(AnchorUtc, TimeZone)`. It covers the in-progress week `[CurrentWeekStart, anchor local day]`, reports `Total` and per-location raw counts, and carries **no** statuses or baselines. Otherwise `null`.
>     - Precondition to document in XML docs: when the WTD block is expected, `Events` must extend through the anchor.
> 12. **Duplicates are counted as real events.** No deduplication anywhere.
> 13. The service must **tolerate extra events** outside the baseline/reported window in `Events` and filter them out itself.
>
> ## Tests (`backend/Relay.Api.Tests/Features/WeeklySummary/`)
> Delete the template `UnitTest1.cs`. Optimise for confidence, not coverage. Build small readable helpers/builders for constructing events — no giant literal arrays. Cover exactly the PLAN.md list:
> - A 02:00 UTC event lands on the **previous** `America/Chicago` local day, and therefore in the previous local week when it falls on a Monday.
> - Week boundaries: local Monday 00:00 inclusive, next local Monday 00:00 exclusive.
> - The DST week `2026-03-02 .. 2026-03-08` (US spring-forward on 2026-03-08; that local week is 167h) buckets correctly.
> - Anchor → current/last-complete week derivation across `America/Chicago`, `America/Phoenix` (no DST) and `UTC`, including an account with zero events under the global anchor.
> - A burst week inside the baseline window does not move the median (median robustness); the same burst week **as the reported week** classifies `Above`.
> - Zero-baseline tiers (`median == 0` with current below/at the floor).
> - `InsufficientHistory` (< 4 preceding complete weeks of history) returns raw counts and `NoVerdict`.
> - `NoActivity` (`FirstEventUtc == null`).
> - Duplicate events are counted twice.
> - Threshold × floor interaction: 4→3 not flagged, 40→28 flagged.
> - Week-to-date block present only for the last complete week; raw counts, no statuses.
> - A location present in the baseline but absent from the reported week still appears, with `Current = 0` and a `Below` verdict when the rules say so.
> - Account-level baseline ≠ sum of per-location medians (construct a case where they genuinely differ — this is a real correctness trap).
>
> ## Verification (required — do not claim success without output)
> From `backend/` in your worktree: `dotnet build` then `dotnet test`. Paste the real summary line. Every test must pass. If a test you wrote reveals that a rule above is wrong or ambiguous, **stop and report it** rather than bending the test to match the code.
>
> ## Notes file
> Write `ai-log/03-weekly-summary-domain.md`: design decisions you had to make beyond this spec, anything in the spec you think is wrong or under-specified, bugs your own tests caught, and the real `dotnet test` output. Be honest about false starts — they are useful evidence, not something to hide.
>
> ## Report back
> Concise summary: files created, any deviation from this spec and why, the test output, and anything the orchestrator must decide. Do not pad.

## 5. Implementation clarification to `PLAN.md` (human correction, mid-implementation)

Sent to the running domain agent as a correction to semantics rule #2, before its work was merged. `PLAN.md` is
left as written; this is a clarification of a rule it under-specified, recorded here rather than retrofitted into
the plan.

**Original orchestrator rule (wrong):** baseline weeks are bounded below by "the local week *containing*
`FirstEventUtc`".

**The human caught the flaw:** if the first event occurs midweek, the week containing it is only *partially
observed*. Its weekly total is a structural undercount, so it both drags the median down and can wrongly satisfy
the 4-week minimum-history gate. `PLAN.md` never distinguished "unobserved" from "observed and quiet"; my rule
collapsed the two.

**Corrected rule:** eligible historical weeks are complete account-local Mon–Sun weeks that **begin on or after
observation starts**. `firstEligibleWeekStart` = the earliest Monday `>=` the first event's local day. The week
containing the first event counts only when that event's local day *is* that week's Monday — i.e. only when the
week is demonstrably fully observed. Weeks after observation begins that happen to be empty still count as a
legitimate `0`; that distinction is the entire point.

**Verified impact (measured against `seed.sql` with the independent oracle, not assumed).** The dataset's first
event is Sunday 2026-02-01, so the week starting Mon 2026-01-26 contains exactly one observed day. Eight of the
twenty accounts (1, 4, 5, 6, 7, 12, 14, 18) begin on that Sunday; accounts 16 and 17 begin Tue 2026-02-03, so
their Feb-2 week is missing its Monday.

- *Baseline distortion* — for reported week 2026-03-02 the one-day sliver week entered the median as a real week:
  account 6's baseline median went 70 → 62 (−11%), account 1's 46.5 → 43. A depressed baseline makes ordinary
  early-March weeks read as "above normal" — the feature actively lying in the direction of false good news.
- *Verdict flip at the gate* — account 1, reported week 2026-02-23: old rule → 4 eligible weeks → `Ok` with a real
  verdict computed partly from a one-day week; corrected rule → 3 eligible weeks → `InsufficientHistory`, no
  verdict. The corrected answer is the honest one.

The correction was accepted in full — it is a genuine correctness bug, and the fact that it changes verdicts (not
just medians) is what makes it worth a mid-implementation redirect rather than a follow-up. Regression tests were
specified alongside it, including the gate-flip case and a guard ensuring a later refactor cannot "fix" the
undercount by dropping empty weeks wholesale.

## 6. Outcomes — orchestrator review of both deliveries

Both agents delivered within their boundaries; the worktree diff confirmed the domain agent touched only its own
files. Merged by copying the disjoint file sets, then rebuilt and retested in the integrated tree: **clean build,
23/23 tests pass**.

### Accepted

- **Backend foundation.** Schema verified by me against `INFORMATION_SCHEMA` rather than taken on trust:
  `varchar` (not `nvarchar`) at the exact lengths from `schema.sql`, `datetime2`, correct nullability,
  `ValueGeneratedNever` ids. Seeded state: 20 accounts, 12 626 events, `MIN/MAX(occurred_at)` =
  `2026-02-01 10:57:44` / `2026-07-27 22:20:34`, 12 duplicate groups preserved, 398 NULL outcomes and 5 159 NULL
  durations (= 313 NULL-duration calls + 4 846 non-call events, consistent with `PLAN.md`). Two judgement calls
  the agent made unprompted and defended in comments were both right: `DeleteBehavior.Restrict` to match
  `schema.sql`'s implicit NO ACTION instead of EF's Cascade default, and a read-side value converter tagging
  `datetime2` values as `DateTimeKind.Utc`.
- **Domain logic.** Classification, the zero-baseline tier, worst-first ordering, and the corrected eligibility
  rule all read correctly. The `DeltaPct!.Value` dereference in the sort is genuinely safe — a zero baseline can
  only ever yield `Above` or `Typical`, never `Below` — and the agent commented exactly that invariant.
- **Both agents' flagged spec gaps**, resolved as they proposed: a zero-baseline `Above` location (no percentage
  to rank by) sorts after percentage-driven `Above` entries by current count; week-to-date `ByLocation` sorts by
  count descending, name tie-broken.

### The domain agent's own self-caught bug (worth recording)

While applying my mid-implementation correction, the agent introduced a regression in its own fix: the
null-`FirstEventUtc` path fell through to "all 8 weeks eligible" instead of zero. Its **pre-existing `NoActivity`
test caught it immediately** (expected 0, got 8). This is the argument for having specified that test up front —
the correction landed on top of a suite that could already detect a broken correction.

### Changed during review

- Removed an unused `tz` parameter from a test helper. `MakeInput` accepted a `TimeZoneInfo` while the
  event-building helpers hardcoded Chicago, so passing a zone would have silently built events in the wrong one —
  a false-passing test waiting to happen for whoever writes the next Phoenix/UTC service test. Time-zone behaviour
  is covered properly in `ReportingCalendarTests`.

### Infrastructure decision (orchestrator)

The backend agent reported, without working around it silently, that host port 1433 is owned by a pre-existing
native `SQL Server (SQLEXPRESS)` service, so host connections never reach the container. I verified this myself
(`sqlservr` PID 7128 bound to `0.0.0.0:1433`; Docker holds only the IPv6 bind) and **remapped the compose host
port to 14330** rather than documenting a caveat. The failure mode is an opaque login error rather than an
obvious port clash, and the evaluating team runs SQL Server — a reviewer plausibly hits the same conflict.
Container-side stays 1433. Verified end-to-end afterwards: `docker compose up -d`, API starts from the host
against `localhost,14330`, migrations report already-applied, and the importer logs
`Seed import skipped: accounts table is already populated.` (idempotency proven across a container recreation,
since the data survived in the named volume).

### Independent verification tooling

To avoid grading the agents' arithmetic with the agents' own code, I wrote a separate oracle (Python + `zoneinfo`)
that parses `seed.sql` and recomputes the summary independently. It confirmed the dataset facts and produced
reference outputs for account 1 (typical), account 6's burst week (881 vs median 66 → `above`, median visibly
undisturbed by the burst), account 16 (8 vs median 6.5 = +23.1%, correctly *not* flagged — just under the 25%
threshold), and account 20 (`no_activity`). These become the fixtures for checking the API layer in task 3.

Agent-authored notes, including their own accounts of false starts, are in `03-backend-foundation.md` and
`04-weekly-summary-domain.md`.
