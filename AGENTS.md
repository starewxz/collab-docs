# Agent Entry Point

This repo has a token-efficient AI knowledge base in `docs/ai/`. Read it before scanning source code.

## Before coding

Read, in order:
1. `docs/ai/00-context.md` — what this project is, stack, current stage
2. `docs/ai/01-architecture.md` — how backend/frontend/auth are structured
3. `docs/ai/02-current-state.md` — what's actually implemented (authoritative, verified against code)
4. `docs/ai/06-rules.md` — rules you must follow

Then, for whatever you're actually doing:
- API detail → `docs/ai/03-api.md`
- DB schema → `docs/ai/04-database.md`
- Frontend detail → `docs/ai/05-frontend.md`
- What's next / roadmap → `docs/ai/07-roadmap.md`
- Why something is built the way it is → `docs/ai/08-decisions.md`

## For your current task

Read `docs/ai/09-handoff.md` first — it names the current stage and exactly what to reuse vs. avoid.

Only inspect source files after you understand the context from these docs. Don't scan the whole repo — the docs tell you which files matter.

## After completing a stage

Update:
- `docs/ai/02-current-state.md` (always)
- `docs/ai/07-roadmap.md` (always)
- `docs/ai/09-handoff.md` (always)
- `docs/ai/08-decisions.md` (only if you made a new architectural decision)

Don't rewrite files that didn't change. Don't duplicate facts across files — each fact has one canonical home (see the list above).

## Hard rules

- Source code is authoritative over these docs — if you find a contradiction, trust the code and fix the doc.
- Don't commit unless explicitly asked.
- Don't start a future roadmap stage unless explicitly asked.
- Full rule list: `docs/ai/06-rules.md`.
