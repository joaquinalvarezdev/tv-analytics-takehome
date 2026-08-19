# CLAUDE.md

## Communication

- Keep communication concise and technical.
- Surface ambiguity instead of silently making product decisions.
- Challenge weak assumptions when they materially affect correctness or scope.

## Agent workflow

- Opus 5 is the primary orchestrator/reviewer.
- Sonnet 5 agents should be used for focused implementation tasks.
- Parallelize independent work when doing so reduces elapsed time without creating unnecessary coordination or merge conflicts.
- Break non-trivial implementation into small, clearly scoped tasks.
- The orchestrator owns architecture, integration, review, and final verification.

### Task planning

- `PLAN.md` is the authoritative pre-implementation plan for DASH-247. Do not rewrite it after implementation begins unless explicitly instructed.
- For a substantial implementation phase with multiple parallel agents, create a small task checklist so implementers can take independent work.
- Do not create `TASKS.md` or other planning artifacts for trivial changes merely for process compliance.
- Tasks should have clear ownership, dependencies, acceptance criteria, and verification commands where relevant.

## AI interaction log

The challenge requires an honest AI interaction log under `ai-log/`.

- Preserve meaningful prompts and responses, especially planning, architectural decisions, reviews, corrections, and redirects.
- Record when agent output was accepted, rejected, or modified and why.
- Do not fill the log with repetitive tool output or routine implementation chatter.
- Logging must not block implementation agents.
- The orchestrator should periodically capture meaningful decisions and produce a concise reflection/index before submission.
- Never sanitize away mistakes or disagreements that are useful evidence of the development process.
- Never include secrets, credentials, or unrelated private workspace context.

## Scope

- This is a 4–6 hour take-home. Correctness and judgment matter more than breadth.
- Prefer the smallest correct implementation.
- Do not add speculative features because agents make them cheap to implement.
- Do not introduce frameworks, architectural layers, or dependencies without a concrete benefit.

## Verification

- Agents must run the relevant build/tests after meaningful changes.
- Do not claim that something works unless it has been verified.
- The orchestrator performs final cross-stack verification before submission.

## Delegation policy

The orchestrator may delegate implementation, exploration, testing, and isolated reviews.

The orchestrator should retain ownership of:
- product interpretation
- cross-stack API contracts
- architectural changes
- accepting/rejecting deviations from PLAN.md
- integration decisions
- final review