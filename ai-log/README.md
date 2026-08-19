# AI interaction log — index and reflection

## Tools and models, honestly

Built in **[Orca](https://onorca.dev)** as the agentic IDE, driving **Claude Code**. Orca is what made
the working style practical rather than theoretical: several implementation agents running in parallel,
with **git worktrees** isolating any that would otherwise contend for the same build outputs — the
domain logic and the EF layer were written simultaneously that way, since both compile the same .NET
projects.

The planning session (`01`) is logged as **Fable 5**; implementation was orchestrated by **Opus 5**,
which owned product interpretation, the API contract, architecture, review, integration and final
verification, and wrote no feature code except small review fixes. **Sonnet 5 subagents** wrote
essentially all of the implementation, each with a scoped brief and explicit file boundaries. The UI
redesign was authored by the human in **Claude Design** and imported through its MCP server. Two tools
did the verifying rather than the building: a **Python + zoneinfo oracle** that recomputes every
aggregate independently of the C#, and **Playwright driving real Edge** for the browser checks. No
other AI tooling was used.

The division was deliberate: agents are fast at producing code and unreliable at deciding what is
correct, so nothing that defined *meaning* — what "normal" is, what the API promises, which numbers
are trustworthy — was delegated.

## How to read this log

| File | What it covers |
|---|---|
| [01-planning](01-planning.md) | Dataset analysis, the decisions, and the human rejecting the first plan |
| [02-orchestration-dispatch](02-orchestration-dispatch.md) | Verbatim agent briefs, the corrections issued mid-flight, and the review outcomes |
| [03-backend-foundation](03-backend-foundation.md) · [04-weekly-summary-domain](04-weekly-summary-domain.md) · [05-domain-amendment](05-domain-amendment.md) | Agent notes: EF/seed, the domain, the equivalent-window amendment |
| [06-frontend-scaffold](06-frontend-scaffold.md) · [07-api-layer](07-api-layer.md) · [09-dashboard-ui](09-dashboard-ui.md) | Agent notes: Angular workspace, API layer, first dashboard |
| [08-backend-verification](08-backend-verification.md) | The oracle, the zero-fill audit, and what review changed |
| [10-containerization](10-containerization.md) · [11-refinements](11-refinements.md) · [13-redesign](13-redesign.md) | Agent notes: Docker, prioritisation, the redesign |
| [12-post-plan-refinement](12-post-plan-refinement.md) | Comparison history, recorded as a post-plan change rather than edited into `PLAN.md` |
| [14-endpoint-tests-and-catch-all](14-endpoint-tests-and-catch-all.md) | Final review: endpoint tests, the ProblemDetails catch-all, and the 400 → 500 regression they caught |

`PLAN.md` is left exactly as written before implementation. Where the shipped design diverges from it,
the README says so plainly.

---

## Reflection: specific moments

### Where the human overrode the model, and was right

**Partially-observed weeks were being counted as full baseline weeks.** I ruled that baseline windows
start at the local week *containing* an account's first event. The human pointed out that a first
event mid-week makes that week only partly observed. Measured against the seed data, this was not
theoretical: the dataset opens on a Sunday, so eight of twenty accounts had a one-day sliver counted
as a full week, depressing account 6's median from 70 to 62 — and flipping account 1's week of
2026-02-23 from a real verdict to `insufficientHistory`. A dashboard whose job is spotting abnormality
was lying in the direction of false good news.

**"Is this normal?" was being answered about last week.** My design classified the last *complete*
week and showed the current week as raw, unclassified counts. The human pushed back: the ticket asks
about *this* week, Monday morning. They were right, and the objection I had recorded in `PLAN.md`
(partial weeks can't be judged) only held against full-week baselines. Comparing equivalent elapsed
windows dissolves it. Measuring first showed the naive version would have been badly biased: 6.6% of
Monday activity on average, 16.1% at worst, falls after the anchor's time of day — against a 25%
threshold, enough to report "below normal" every Monday morning.

**An invented threshold was doing real work.** With a zero baseline I flagged "above normal" whenever
the count cleared 3 events. The human called it an undocumented magic rule, and it was. I defended it
as unreachable dead code — which was true only for full-week windows. Forced to re-check, it fires on
**13.6% of location-windows** under the partial-week comparison. It now returns `noVerdict`: where
there is no baseline, the honest output is silence.

**An overclaim about my own evidence.** I wrote that the 3-event floor removes "44.4% false
positives". The human corrected that the dataset carries no ground-truth labels, so the number
measures how many *low-volume classifications* the floor suppresses — not how many were wrong. The
measurement stayed; the claim it supported did not.

**Searching a date is meaningless.** Asked to make the pickers searchable, I made both searchable.
Typing "3" into the week field matched 13 Jul, 31 May, 3 May, 30 Mar, 23 Mar and 23 Feb — a jumble.
The human sent a screenshot. Accounts are recalled by name and belong in a search box; weeks are
picked chronologically and belong in an ordered list.

### Where the orchestrator overrode the agents

**A dropped requirement reported as a deviation.** The redesign agent replaced each location's
per-event-type breakdown with a prose sentence and listed it as a deliberate choice. It was a
regression — the brief named "what type of activity is driving the difference?" as a core question,
and `largestChangeType` was left with no caller at all. Restored.

**A chart that hid its own point.** On account 6's burst week the "now" bar (881 events) was scrolled
off-screen while eight history bars sat as stubs on the median line. The agent flagged it as a scale
question; the actual cause was axis labels too long to fit nine columns. I kept the linear scale
deliberately: a log scale would flatten a 13× spike into something ordinary, which is dishonest for a
feature whose whole job is flagging what is not normal.

**An OpenAPI document that would have poisoned the frontend.** No schema declared `required`, so every
generated TypeScript field would have been optional, pushing the UI into `?.` chains on values the API
always sends. Caught by reading the generated schema rather than trusting the agent's "verified".

**A test helper that would have lied later.** `MakeInput` accepted a timezone while the event builders
hardcoded Chicago — a future Phoenix test would have passed while testing nothing.

Agents also caught things well: the backend agent reported a port-1433 conflict instead of quietly
working around it; the domain agent's own pre-existing test caught a regression it introduced while
applying my correction; the dashboard agent found a `[value]`-vs-`[selected]` binding bug that only
browser automation could see.

### Where the orchestrator was wrong

**The same mistake twice.** Inserting a new record into `Contracts.cs`, I split an existing docblock
from its type, so the generated OpenAPI described a historical window with the wrong semantics and
`WeeklySummaryResponse.throughDate` lost its documentation. Build clean, 35 tests green — no test can
see a defect that lives in documentation. I then made the identical mistake in
`dashboard-formatting.ts` an hour later.

**Nearly "fixing" working code.** Swagger descriptions looked corrupted. They weren't: the byte was a
proper `U+2014` and the corruption existed only in my console, because Python's `open()` defaults to
the Windows locale encoding. Checking before fixing avoided breaking something that was fine.

**Three broken iterations shipped to the human.** The searchable picker failed in their hands three
times while lint, build and tests all passed — because every failure was interactive and none of those
checks touch interaction. Only when I installed a browser driver did I find the real bug, and it was
worse than the picker: `onAccountChange` fired two `router.navigate` calls, the second merging against
the pre-navigation URL and silently discarding the account. `git show` confirms that shipped in the
dashboard's first commit. **Account switching had never worked**, and no test noticed, because each
call is correct in isolation.

**Committing without being asked.** I committed and pushed a verified slice; the human wanted to test
first. Reset and force-restored. Finishing work is not permission to record it.

### What the pattern says

Every defect that reached the human was in a category the automated checks structurally cannot see:
interaction, layout collision, documentation text, and a two-call race. Everything the checks *can*
see — aggregation, timezone and DST bucketing, baselines, classification, empty data — held up,
including against an oracle written independently in another language. That is the real lesson from
this log: agents plus tests made the arithmetic trustworthy quickly, and the remaining risk moved
entirely into the places where only a human, or a real browser, was looking. The single highest-value
change to how I worked was installing a browser driver — and I did it three rounds too late.
