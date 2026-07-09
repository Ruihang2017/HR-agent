# CLAUDE.md — Working agreement

Process contract for anyone working in this repo, human or AI agent. This file holds
**rules of engagement**, not project knowledge. The project's knowledge lives in the
documents referenced below — start there.

## 1. `PRD.md` is the source of truth
- `PRD.md` (repo root) defines what this product must do. **Read it before starting any
  task.** Requirements written as invariants or hard constraints are binding — treat them
  as non-negotiable, not as defaults you may trade away.
- **Never modify `PRD.md` unless the user explicitly asks you to.** If a task reveals the
  PRD is wrong, stale, or contradicted by the code, **stop and raise it** — describe the
  conflict and propose the edit, then let the user decide. Don't self-edit the source of truth.

## 2. Don't self-edit this file
- **Never modify this `CLAUDE.md` unless the user explicitly asks you to.** Propose changes;
  don't apply them unprompted.

## 3. Keep `README.md` true — after every major task
- `README.md` must always describe how to install, configure, run, and test the app **as it
  currently is**. After any major task, update it as part of the same change. A task is not
  "done" while the README still describes the old world.

## 4. Log major decisions in `DECISIONS.md`
- `DECISIONS.md` (repo root) is the append-mostly record of every major decision and its
  rationale, so a future developer can always trace *why*. After a major task that involved
  a real choice, add a dated entry: **decision, context, alternatives considered, rationale,
  status.** When a later decision overrides an earlier one, add a new entry that supersedes
  it — don't silently rewrite history.

## 5. Write a handover per major implementation or phase
- Every major implementation or phase produces **one independent handover file** in
  `docs/handover/`. See `docs/handover/README.md` for the convention and template. It records
  what was built, how it was verified, what's still open, and how to pick the work up —
  written for someone who wasn't there.

## What counts as "major"
A phase, a new subsystem, a dependency/provider migration, a data-model or public-API change,
or anything that alters how the app is run, configured, or deployed. Small fixes and refactors
skip the decision log and handover — but still keep the README honest.

## Where things live
| File / dir | Holds |
|---|---|
| `PRD.md` | Requirements — the source of truth |
| `README.md` | How to install / configure / run / test, right now |
| `DECISIONS.md` | Dated log of major decisions + rationale |
| `docs/handover/` | One handover per major implementation or phase |
| `docs/` | Design specs, plans, deep references — read the relevant one before implementing |
