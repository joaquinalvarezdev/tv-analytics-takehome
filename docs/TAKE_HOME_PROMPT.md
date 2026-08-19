# Senior Full-Stack Engineer (Agentic AI) — Take-Home Prompt (Shareable / Candidate-Facing)

Thanks for continuing with the process. This exercise is designed to look like the real work you'd be doing in this role: you'll receive a short product background, a lightly-specified ticket, and a seed dataset — and you'll decide what to build, plan it, and implement it the way the team you'd be joining actually works: **agent-first**.

We care far more about **senior engineering and product judgment** than about completeness. A smaller, correct, well-reasoned slice beats a broad one that's half-broken.

### ⏱ Scope & time

- **Budget your effort to 4–6 hours of focused work.** This is a deliberate cap, not a target to exceed. Part of what we're evaluating is how you prioritize under a real constraint.
- Agent leverage doesn't raise the bar on breadth — a correct, well-reasoned slice still beats a broad one. If your agents make you fast, spend the surplus on verification and edge cases, not more features.
- If you run out of time, **stop and document** what you'd do next in the README rather than rushing a broken feature.

### 🤖 AI use

**We expect you to work agent-first — this is how the team you'd join works.** Engineers on this team pick up a ticket, build an AI-assisted implementation plan, and implement with AI coding agents (Claude Code, Copilot, Cursor, etc.) by default. We are not testing whether you can write code without AI. Doing this challenge without AI tooling is not a bonus — it tells us nothing we need to know. What we're interested in is *how you direct, review, and verify* agent output.

Because of that, two artifacts are **required deliverables** (details under "What to submit"):

1. **An implementation plan (`PLAN.md`)** written *before* you implement. Raw and unpolished is fine — better, even. We expect the plan to visibly precede the bulk of implementation in your AI log (planning conversations early, code generation after). We expect to see you plan with (or before) the agent, not just generate code.
2. **An AI interaction log** with as much raw detail as possible: actual prompts and model responses, where you **accepted, rejected, or redirected** the AI and why, and a short reflection naming **specific moments** where you caught the AI being wrong or chose to override it. Please also include one honest line on **which tools/models you used and for what** (authoring vs. reviewing vs. not at all). We don't score which tools you used — we look at whether the division of labor was deliberate. A missing, sanitized, or obviously one-shot AI log is a serious negative signal — messier and honest beats tidy.

**Optional, but strong signal:** if you write agent-context artifacts for this task — a `CLAUDE.md`, `.cursorrules`, custom commands/skills, a system prompt — **commit them**. Reusable agent instructions are exactly the kind of thing this team builds.

### 🏢 Product background

**Relay** is a fictional B2B SaaS that helps service businesses track inbound customer activity — calls, leads, appointments — across their locations. Customers range from single-site shops to groups with 15+ locations. Each customer gets a **reporting dashboard**: today it shows raw totals per location and not much else.

Two things the team keeps hearing:

- Account managers say customers ask *"is this number normal for us?"* and can't answer it from the dashboard.
- The support team says customers with multiple locations struggle to spot which location needs attention.

The team works spec-driven and AI-first: engineers get tickets like the one below, build a plan, and implement with AI agents by default.

### 🎫 The ticket

> **DASH-247 — Help customers understand whether their recent activity is normal**

Customers looking at their dashboard can't tell whether this week's numbers are good, bad, or typical for them. Product wants the dashboard to help a customer answer *"is this normal for us?"* at a glance, without exporting data or calling their account manager.

**Notes from product:** probably involves comparing against some baseline, multi-location customers matter, a customer admin should be able to look at this Monday morning and act on it.

**Out of scope per product:** alerting/notifications, ML/forecasting.
> 

The ticket is deliberately light — that's realistic, not an oversight. Deciding what it actually means (what "normal" is, what window, what view) is part of the exercise. Your interpretation and scoping decisions are **evaluated criteria**, not just tolerated variance.

**Questions during the challenge?** Email them via the recruiter — we treat good questions as signal, not weakness. If you'd rather not wait on an answer, document the question and the working assumption you proceeded on in `PLAN.md`. Either path is fine; silently guessing is the only wrong one.

### ✅ What to build

Your interpretation of the ticket is yours to make and defend, but every submission must contain this skeleton:

- **Backend:** at least one API endpoint that performs **real aggregation over the seed data** (not pass-through queries), serving your dashboard feature.
- **Frontend:** an SPA view that consumes it, with at least one piece of **user-controlled input** (filter, date range, location selector, toggle — your call) whose **state survives a page reload**.
- **Tests that run**, with a one-line note in the README on how to run them.
- **A relational database with a real schema and migrations** (your stack's standard tooling), loaded from the provided seed data.

**Stack (required):** build this in **.NET 8+ (C#)** on the backend and **Angular** on the frontend. This is the stack the team you'd be joining works in, and the exercise is evaluated in it — **submissions in another stack can't be evaluated for this role.** The database is flexible: any relational DB is fine (SQL Server is what the team runs, so it's a nice touch — but don't burn your time budget on DB setup). Tell us in the README about the notable choices you made within the stack (ORM vs. raw SQL, state management approach, etc.) and why.

Don't invent your own dataset — use the seed data provided (below) so your time goes into the feature, not data modeling. Handle the unglamorous parts of real data honestly: empty ranges, odd values, aggregate correctness.

### 🌱 Seed data

Schema + seed dataset (two tables: `accounts` and `activity_events`) are provided in a starter repository:

**https://github.com/Qualitara/tv-analytics-takehome**

**Clone it into a fresh repository of your own** (please don't fork — forks are publicly linked to the source repo). If you can't access GitHub for any reason, reply to the recruiter and we'll get you the files directly.

### 🚫 Explicitly out of scope

Skip these so they don't eat your budget. We won't penalize their absence:

- **Auth / login** — assume a single trusted customer admin; a hardcoded identity is fine.
- **Alerting / notifications and ML / forecasting** — per the ticket.
- **Production infra** — no Kubernetes or CI required. Local run is fine.
- **Visual polish** — function over form. Unstyled-but-clear beats pretty-but-broken.

### 📦 What to submit

Reply **directly to the recruiter's email** with a link to a **public GitHub repository** containing:

1. **The code** — backend, frontend, and migrations, in a repo we can clone and run.
2. **`README.md`** — how to run it locally (DB setup, env vars, commands); your interpretation of the ticket; key **assumptions** and **design decisions** with the **trade-offs** you weighed; what you **deliberately deferred** and why; what you'd do with another day.
3. **`PLAN.md`** — the implementation plan you built from the ticket *before* coding. Leave it as-written; don't retrofit it to match the final code.
4. **AI interaction log** (`ai-log/` directory or `AI_LOG.md`) — as described above, plus any committed agent-context artifacts.
5. **Tests** that run.

Please make sure the repo is **public** and that the README, PLAN.md, and AI log are committed before you reply.

### 🔎 How we evaluate

At a high level, we're looking at:

- **Product & spec judgment** — how you interpreted an underspecified ticket: what you asked or assumed, what you chose to build and *not* build, and why.
- **Agentic working discipline** — a plan that genuinely preceded the code, agent direction with precise context, and evidence you caught and corrected agent mistakes rather than rubber-stamping output.
- **Correctness & engineering judgment** — does it work, and are the decisions sound for a senior engineer? Aggregates that are *actually right* against the seed data matter more than feature count.
- **Data handling** — SQL/aggregation reasoning, and honest treatment of messy real-world data.
- **Test quality** — meaningful tests on the parts that matter, not coverage farming.
- **Communication** — a README and plan that let us reconstruct your reasoning without you in the room.

We don't expect perfection in 4–6 hours. We expect to see how a senior, agent-first engineer reasons, prioritizes, and ships a correct slice.

Good luck — we're looking forward to seeing how you think.