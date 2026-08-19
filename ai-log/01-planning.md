# AI log — 01: Planning session (2026-08-19)

**Tooling:** Claude Code, model Fable 5, plan mode. Single orchestrator session — no implementation agents dispatched yet, no application code touched. Division of labor so far: the human set the process and made/corrected product decisions; the model did repo/dataset analysis and drafted the plan.

## 1. Kickoff prompt (human, condensed to the meaningful parts)

> You are helping me plan **DASH-247** for a 4–6 hour take-home. Stay in Plan Mode. Do not implement anything yet.
> Before proposing a plan, read the repository context [root/backend/frontend CLAUDE.md, docs, schema.sql, seed.sql, seed/, backend scaffold, docker-compose].
> **First task: analyze, do not write PLAN.md yet.** Identify the decisions that materially affect the implementation: what "normal for us" should mean; comparison period; how the Monday-morning use case affects the design; multi-location behavior; account timezone and reporting boundaries; outliers, duplicates, nulls, sparse data, empty periods; insufficient history / zero baseline; smallest useful vertical slice; what to deliberately defer.
> Do not silently fill ambiguities. For each meaningful ambiguity, distinguish: **fact derived from the supplied data / product assumption / engineering decision**. Challenge my assumptions if needed.
> I want to review, reject, or redirect your recommendations first.

## 2. Dataset analysis (model)

Read all docs/CLAUDE.md files and `seed/generate_seed.py`, then **verified the generator's claims by parsing all 12,626 rows of `seed.sql` directly** (PowerShell regex over the INSERT lines; routine output omitted). Verified findings:

- 12,626 events, 2026-02-01 10:57 UTC → 2026-07-27 22:20 UTC; last event day is **Monday Jul 27**; 25 complete Mon–Sun weeks.
- Real today (Aug 19) is ~3 weeks past the data → wall-clock anchoring yields an empty dashboard.
- Account 20: zero events. Account 6: 805-event burst on Jun 3 (~66× its ~12/day norm; other June days avg 12.2/day).
- 12 exact duplicate rows (distinct ids, identical values); no natural key.
- 313/7,780 calls (4%) NULL duration; 398 (3.2%) NULL outcomes.
- 74 events at 00:00–05:59 UTC (previous local day in US timezones); Phoenix (no DST) and UTC accounts present; US DST spring-forward Mar 8 in range.
- Weekends ~35% of weekday volume; per-account volume 6.6–104 events/week; location×type cells sparse (~1 appt/loc/wk on acct 6).

Model's reading of the planted traps: wall-clock anchoring, UTC-day bucketing, mean-based baseline poisoned by the burst, divide-by-zero on zero baselines, silent dedup, unhandled empty/sparse accounts.

## 3. First recommendations (model) and human decisions

Model proposed 11 decisions (baseline = trailing 8-week median; last-complete-local-week reporting; % threshold + absolute floor classification; per-location worst-first statuses on totals; TimeZoneInfo bucketing in C#; keep duplicates; keep burst; tiered empty states; counts-only metrics; account picker as dev switcher), then asked 4 questions. Human's answers:

| Question | Answer | Accepted/redirected |
|---|---|---|
| Classification approach | Median + % threshold + absolute floor | accepted recommendation |
| Metric scope | Counts only | accepted recommendation |
| Time window | **Also show week-to-date** (raw, "in progress, no verdict") | **redirected** — model had recommended last-complete-week only |
| Identity | Account picker as dev switcher | accepted recommendation |

## 4. Corrections (human rejected the first draft plan)

The model drafted a full plan and requested approval. The human **rejected it** with five corrections — all accepted as valid:

1. **"Monday morning" overclaim.** The model wrote that the dataset was "deliberately staged so 'today' is a Monday morning." Wrong: max timestamp is 22:20 UTC ≈ 6:20 PM EDT — evening. The data establishes only that it ends on a *Monday*; "Monday morning" is the ticket's persona. Fact vs. product framing were conflated; the plan now separates them.
2. **Week-to-date contradiction.** The human had chosen to include both week-to-date and last completed week, but the draft still listed "week-to-date view" under *deliberately deferred* while including it in the API shape. Internal inconsistency between an accepted decision and the scope list — reconciled: week-to-date is first-class (raw counts, no verdict, only shown for the latest week).
3. **Per-account anchor rejected.** The draft derived each account's "latest complete week" from that account's own max event timestamp. Human pointed out this breaks for Quiet Harbor Spa (zero events → no anchor). Model's revision, accepted: **one dataset-wide anchor = global `MAX(occurred_at)`**, converted per account timezone — also avoids mis-anchoring quiet accounts to stale weeks (their "no news" is signal).
4. **Thresholds reclassified.** 8-week baseline, 4-week minimum history, 25% deviation, 3-event floor had been presented alongside data facts. They are **product assumptions chosen by us**, not derived from the data. Now listed explicitly as assumptions with rationale, implemented as named constants.
5. **Account picker framing.** Keep as demo/dev identity switcher and additionally document that production auth would scope the account server-side (identity from the authenticated principal, not a client-supplied ID).

## 5. Final wording pass (human, on approving the revised decisions)

Before PLAN.md was written: keep it a *pre-implementation* artifact (no describing planned work as done), keep the current-repo-state description accurate, preserve the fact/assumption/decision distinction, keep it practical and somewhat raw rather than over-polished.

## 6. Honest reflection so far

- The model's data analysis was solid and independently verified against `seed.sql` (not just the generator source) — that part was accepted as-is.
- The model **overclaimed intent from data** once ("staged for Monday morning") and **let a stale scope line contradict a fresh decision** (week-to-date in both the response shape and the deferred list). Both were human catches, not self-catches.
- The per-account anchor was a genuine design flaw the human caught by reasoning about the zero-event account — the model had identified account 20 as an edge case in analysis but failed to apply it to its own anchor design.
- The model initially recommended *against* the week-to-date view ("demos poorly on the seed data"); the human overrode for product reasons (a Monday-morning admin wants to see today's state, not just history). Recommendation rejected, rationale recorded.

Outcome of this session: approved decision set → `PLAN.md` written at repo root. No application code modified; implementation not started.
