# Relay — DASH-247: "Is this normal for us?"

A dashboard slice that tells a customer admin whether their current activity is normal **for them**,
and which of their locations needs attention.

- **Stack:** .NET 8 minimal API + EF Core + SQL Server (Docker) · Angular (standalone, signals) + Tailwind
- **Plan:** [`PLAN.md`](PLAN.md) — written before implementation, deliberately left as-written
- **AI interaction log:** [`ai-log/`](ai-log/) — index, reflection, verbatim agent briefs, and the corrections that mattered
- **Task checklist:** [`TASKS.md`](TASKS.md)

---

## Running it

### Option A — everything in Docker (only Docker required)

```bash
docker compose up          # first run builds the images
```

| | URL |
|---|---|
| Dashboard | http://localhost:8080 |
| API / Swagger | http://localhost:8081/swagger |

### Option B — local dev loop (Docker + .NET 8 SDK + Node 20+)

```bash
docker compose up -d sqlserver           # database only

cd backend && dotnet run --project Relay.Api    # http://localhost:5041 (Swagger at /swagger)

cd frontend && npm ci && npm start              # http://localhost:4200
```

The dev server proxies `/api` to the API, so the SPA uses relative URLs and there is no CORS or base-URL
setup in either mode.

In both cases the API applies its EF migration and imports `seed.sql` on startup. Seeding is idempotent — it
skips entirely if `accounts` already has rows — so restarting is safe. SQL Server needs 20–40s before it
accepts connections; the compose healthcheck makes the API wait rather than race it.

> **Port note:** compose maps host port **14330** → container 1433, not the usual 1433. A locally installed
> SQL Server instance very commonly owns 1433, and the resulting failure is an opaque login error rather than
> an obvious port clash. The containerized app uses 8080/8081 so it can run alongside the dev servers on
> 4200/5041.

### Running the tests

```bash
cd backend  && dotnet test    # domain: aggregation, timezone/DST, baselines, empty data
cd frontend && npm test       # headless; formatting, state mapping, query-param persistence
```

Lint and build the frontend with `npm run lint` and `npm run build`.

---

## What I built, and why

### Interpreting the ticket

The ticket asks for "is this normal for us?" at a glance, mentions that multi-location customers matter, and
names a customer admin looking **Monday morning**. Deciding what "normal" means was the main judgement call.

**Normal is self-referential.** An account is compared against its own recent history — not against industry
benchmarks or other accounts. Cross-account benchmarking is a different (and much larger) product question,
and the ticket's phrasing — "normal *for us*" — points away from it. This is documented as an open question
for product rather than silently assumed.

**The comparison is like-for-like in time.** The dashboard compares the **elapsed portion of the selected
week** against **the same elapsed window in each preceding week**. On Monday afternoon you are compared with
your previous eight Mondays *up to the same time of day* — not with eight complete weeks.

This matters more than it sounds. Weekend volume runs at roughly 35% of weekday volume in this dataset, so
comparing a partial week against full weeks is structurally misleading and would report "below normal" every
Monday. Truncating at the same local time of day removes a further bias worth **6.6% on average and 16.1% at
worst** — measured against the seed data — which is large next to a 25% flagging threshold.

A completed week is simply the case where the elapsed portion is the whole week, so there is one code path
and one response shape rather than a special "week to date" mode.

### The baseline

Up to the **8 preceding comparable windows**, summarised by their **median**.

The median rather than the mean because this data has a genuine outlier: account 6 has an 805-event day
against a norm of about 12 (roughly 66×). A mean-based baseline is distorted for every window containing that
day; the median absorbs it. The burst is deliberately **not** excluded — when the burst week is itself the
reported week, "way above normal" is the feature working correctly.

**Only fully-observed weeks count.** A window is eligible only if its week begins on or after the account's
first observed day. The dataset's first event is a Sunday, so a naive rule credits the preceding Monday's
week as a full baseline week off a *single observed day*. That depressed account 6's median from 70 to 62
(−11%) and flipped verdicts at the minimum-history gate. Weeks after observation begins that happen to be
empty still count as a legitimate `0` — "unobserved" and "observed and quiet" are different things.

**At least 4 comparable windows** are required before any verdict is given; below that the UI shows raw
counts and says so.

### Classification, and its honest limits

Activity is flagged `above` or `below` only when it differs from the baseline by **at least 25%** *and* by
**at least 3 events**. Otherwise it is `typical`.

The absolute floor exists because this data is sparse — at location × week granularity some cells average
about one event. Without it, a 4 → 3 drop flags as "25% below normal". Across all location-weeks in the seed
data the floor suppresses 376 of 846 threshold-only flags (44.4%), all of them low-absolute-difference
classifications. To be precise about what that number is and is not: the dataset carries **no ground-truth
labels**, so this measures how many low-volume classifications the floor removes — not how many of them were
genuinely wrong.

**These two thresholds are product defaults, not derived truths.** They live as named constants in
`ReportingRules.cs` and would be the first thing to calibrate with product and account-management input.
Every row also ships its current count and baseline median, so the reader is never dependent on our threshold
to see what actually happened — the rule shapes emphasis, not access to the numbers.

**Where there is no baseline, no verdict is given.** If the baseline median is 0, the API returns
`noVerdict` and the raw count rather than declaring "above normal". An earlier draft flagged "above" whenever
the count cleared the 3-event floor; that was an invented product rule doing 100% of the work in exactly the
case where nothing supports a judgement, so it was removed. This is not a rare path: zero medians never occur
for full-week windows in this dataset, but they occur in **13.6% of location-windows** under partial-window
comparison — roughly one location row in seven on a Monday morning.

### Handling the messy parts honestly

| Reality in the data | What the code does |
|---|---|
| 12 exact duplicate rows (distinct ids, otherwise identical) | Counted as real events. There is no natural key, and two identical calls can legitimately occur; deduplication is an ingestion-time concern, not a reporting one. |
| An 805-event burst day (≈66× normal) | Kept. The median baseline absorbs it. |
| Account 20 has zero events | First-class `noActivity` state, distinct from "empty result". |
| 74 events fall at 00:00–05:59 UTC | Bucketed by **account-local** calendar day, so they land on the previous local day for US timezones. |
| DST spring-forward (2026-03-08) sits inside the range | Windows compare on calendar `(dayIndex, timeOfDay)`, never elapsed hours — a local week is 167h or 169h across a transition. |
| `duration_seconds` 4% null, `outcome` 3.2% null | Unused in v1 (see *Deferred*). Not silently coerced. |
| Data ends 2026-07-27, weeks before "today" | See *The reporting anchor*. |

### The reporting anchor

The seed data ends 2026-07-27, several weeks in the past. Anchoring "this week" to the wall clock would
render an empty dashboard.

So "now" is defined as one **dataset-wide anchor** = `MAX(occurred_at)` across all accounts, converted into
each account's timezone. Dataset-wide rather than per-account deliberately: a per-account anchor would leave
account 20 (zero events) with no anchor at all, and would quietly re-anchor a quiet account to a stale week —
but "no news this week" is exactly the signal this feature exists to surface.

This is a stand-in for the production wall clock, and the UI states the anchor date plainly rather than
implying the data is live.

---

## Notable stack decisions

**EF Core rather than raw SQL.** The aggregation is done in C#, not in SQL, and the reason is timezones. Every
boundary in this feature is an account-local one, and SQL Server's `AT TIME ZONE` needs Windows timezone names
while the data carries IANA ids. Mapping between them is not worth the budget at this scale — a single
account's query window is at most ~1k rows. So the repository issues one bounded, indexed range query and a
pure C# service does the bucketing. That service has no EF dependency at all, which is what makes the
timezone and DST rules directly unit-testable.

**A thin repository, not a generic one.** One class with a handful of purpose-built queries. No generic
repository framework, no CQRS, no MediatR — the feature does not have the complexity to earn them.

**Explicit response DTOs.** EF entities never reach the wire. The domain records are mapped at the API
boundary, which is also where `deltaPct` becomes `deltaRatio` — the value is a fraction (`0.25` = +25%), and
the name change exists so a client cannot render it as "0.25%".

**A generated OpenAPI client on the frontend.** No hand-written DTOs, no parallel HTTP client. Enums are
emitted as camelCase **string** enums and non-nullable properties are marked `required`, so the generated
TypeScript is properly typed instead of everything arriving optional and forcing `?.` chains.

**Signals, no state library.** The dashboard's state is two values and one request. `account` and `weekStart`
live in the **URL query string**, which makes the view survive a reload, shareable by link, and navigable with
the back button. That is the required user-controlled persisted input, chosen because it is the option that
does real work rather than the one that is easiest to bolt on.

**The dashboard makes the baseline visible.** The comparison history is an always-visible bar chart with a
dashed median line, and every event-type and location row carries a bar with a median tick — so "is this
normal" is answered by something you can see, not only by a percentage you have to trust. The layout was
designed by hand in Claude Design and reimplemented here against the real API; the chart is plain CSS, with
no charting dependency. The scale stays linear even on the 13× burst week, because a log scale would flatten
an extreme anomaly into something ordinary — dishonest for a feature whose job is flagging what is not normal.

**The account picker is a demo control.** Authentication is out of scope, so it stands in for the signed-in
identity and is labelled as such in the UI. In production the account would be resolved from the authenticated
principal server-side; a client-supplied account id would be an authorization hole.

---

## API

| Endpoint | Purpose |
|---|---|
| `GET /api/accounts` | Accounts plus each one's current week and earliest selectable week. Demo identity switcher. |
| `GET /api/accounts/{id}/weekly-summary?weekStart=yyyy-MM-dd` | The classified comparison. Defaults to the current in-progress week. |

`400` for a non-Monday, unparseable, or future `weekStart`; `404` for an unknown account. Swagger UI at
`/swagger`.

The three data states are distinguished without magic numbers: `baselineMedian: null` means no baseline is
computable (`insufficientHistory` / `noActivity`), while `baselineMedian: 0` means the baseline is genuinely
zero. `deltaRatio` is null exactly when the division is undefined.

The response also carries **`comparisonHistory`** — the individual windows behind the median, so a reader can
inspect the samples instead of trusting a summary statistic. The median is computed *from the list that is
returned*, so the two cannot drift apart, and each window inherits the reported week's cutoff: a partial week
is compared against equivalently partial history, never whole weeks.

---

## How this was built (agent-first)

Developed in [Orca](https://onorca.dev), an agentic IDE, driving Claude Code. The orchestrating model owned
product interpretation, the API contract, architecture, integration, and final verification; Sonnet
implementation agents did the coding, each with a scoped brief and explicit file boundaries.

Where work was genuinely independent it ran in **parallel**, which is the main thing the tooling bought:
the domain logic and the EF/database layer were built at the same time, the second in an isolated **git
worktree**, because both compile the same .NET projects and would otherwise have raced on the same build
outputs. Parallelism was used only where it removed waiting, never where it would have created merge
conflicts or coordination overhead.

Aggregation correctness was not checked with the code that produced it. A **separate oracle** — an independent
Python implementation parsing `seed.sql` — recomputes the same summaries, and live API responses were
deep-compared against it field by field across five account/week cases including the burst week, a sparse
account sitting just under the threshold, and the zero-activity account: **0 differences**.

`ai-log/` carries the verbatim agent briefs, the corrections that were issued mid-implementation, and the
mistakes. It is not tidied up; the rejected first attempts are the useful part.

### Where the plan and the final code diverge

`PLAN.md` is left exactly as written before implementation, so it does **not** match the shipped design in one
significant way. The plan proposed showing the last completed week with a verdict plus a separate, raw,
unclassified "week to date" strip. Review found that under-answered the ticket — it declines to say anything
about *this* week, which is what the customer is actually asking. Comparing equivalent elapsed windows makes a
partial-week verdict honest, so the two views collapsed into one.

Two further changes came after the plan, both raised in review rather than foreseen: exposing the individual
baseline windows behind the median (`comparisonHistory`), and rebuilding the UI around a redesign so the
baseline is visible rather than hidden behind a disclosure. Neither changes what "normal" means. The plan is
not retrofitted to hide any of this; the reasoning is in `ai-log/` — see the
[index and reflection](ai-log/README.md).

---

## Deliberately deferred

Not attempted, and why — each is a real piece of work rather than an oversight:

- **Quality metrics from `outcome` / `duration_seconds`** (missed-call rate, no-show rate, average handle
  time). Genuinely valuable and the obvious next increment, but v1 answers "is the volume normal", and adding
  a second metric family means a second set of baseline and threshold decisions.
- **Day-level drill-down charts.** The table answers "which location and why" precisely; a trend chart is the
  natural follow-up once someone wants to see *when* within the week.
- **Cross-account / industry benchmarking.** A different product question, and an open one for product.
- **Real authentication**, caching, and CI. Out of scope per the prompt.
- **Alerting and ML/forecasting.** Explicitly out of scope per the ticket.

## With another day

1. **Calibrate the thresholds with real product input**, and consider replacing the fixed 25% with a
   dispersion-aware rule (for example flagging against the interquartile range of the baseline windows), so
   steady locations and volatile ones are not held to the same bar.
2. **Add the outcome-quality metric family** — missed-call rate is the most actionable number in this dataset
   that the current slice does not surface.
3. **Seed-backed integration tests** over the real dataset, promoting the external oracle's fixtures into the
   test suite so aggregate correctness is guarded in CI rather than verified once by hand.
4. **A trend sparkline per location** showing the baseline windows behind the verdict, so "why" is answerable
   at a glance instead of by expanding a row.
