# Handover notes

One **independent handover file per major implementation or phase**. A handover is written for
someone who wasn't there: it says what was built, how it was verified, what's still open, and how
to pick the work up. It complements — doesn't duplicate — the other docs:

- `PRD.md` says *what to build*, `DECISIONS.md` says *why we chose X*, a handover says
  *what actually shipped in this unit of work and where it stands*.

## When to write one
Create a handover when you finish a phase, a new subsystem, a dependency/provider migration, a
data-model or public-API change, or anything that changes how the app runs. Small fixes don't need
one (but still keep the `README.md` honest — see `CLAUDE.md`).

## Naming
`YYYY-MM-DD-short-slug.md`, dated to when the work completed (e.g.
`2026-07-07-phase-1-core-workflow.md`). One file, never edited away — later work gets its own file.

## Template
Copy the block below into a new file and fill it in. Delete sections that genuinely don't apply.

```markdown
# Handover — <title>

- **Date:** YYYY-MM-DD
- **Author:** <name>
- **Status:** Complete | Partial | Blocked
- **Related:** PRD <F-numbers>, `DECISIONS.md` <entry dates>, `docs/…` <plan/spec>

## Summary
One or two sentences: what this unit of work delivered.

## Scope
What this covers — and explicitly what it does *not*.

## What was built
- Bullet the concrete deliverables (modules, endpoints, screens, migrations, docs).

## How to run & verify
Point to `README.md` for the canonical steps; note anything specific to this work.

## Verification & results
Tests run and their outcome; manual testing done; any numbers worth recording.

## Decisions
Link the `DECISIONS.md` entries this work created or relied on.

## Known gaps & follow-ups
Carry-overs, latent defects, deferred items, and anything the next person must watch for.

## Files & areas touched
The main files/directories changed, so a reviewer knows where to look.

## Pick-up notes
Concrete next steps for whoever continues this thread.
```
