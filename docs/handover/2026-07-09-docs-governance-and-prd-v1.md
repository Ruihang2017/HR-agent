# Handover — Docs governance + PRD v1.0 (single source of truth)

- **Date:** 2026-07-09
- **Author:** horace.hou
- **Status:** Complete
- **Related:** `PRD.md` v1.0 (all sections); `DECISIONS.md` entries 2026-07-09 (governance, PRD
  v1.0); `CLAUDE.md` (working agreement)

## Summary
Restructured the project's documentation layer: `CLAUDE.md` became a project-agnostic working
agreement, `DECISIONS.md` and `docs/handover/` were introduced, and `PRD.md` was rewritten from a
v0.1 draft into the v1.0 canonical single source of truth — verified line-by-line against the
codebase, with all PRD-vs-code divergences documented explicitly.

## Scope
Documentation only. No product code, tests, or configuration changed in this unit of work.

## What was built
- **`CLAUDE.md`** — generic process contract: PRD is the source of truth (never self-edited);
  CLAUDE.md never self-edited; README kept current after every major task; major decisions logged
  in `DECISIONS.md`; one handover per major unit in `docs/handover/`.
- **`DECISIONS.md`** — running decision log, backfilled to project start (stack, pipeline
  architecture, human-gate invariant, LLM wrapper, model tiering, phasing, OpenAI migration,
  governance, PRD v1.0).
- **`docs/handover/`** — convention + template (`README.md`), backfilled handovers for Phase 1
  and the OpenAI migration, plus this file.
- **`PRD.md` v1.0** — the core deliverable. Key structural facts for future sessions:
  - §1–§8 keep v0.1 topic numbering; **all F-numbers unchanged** (repo-wide references depend on
    them). §9+ is new: §9 current state, §10 architecture, §11 decisions (D-1…D-10),
    §12 implementation plan, §13 cross-cutting concerns, §14 open questions (OQ-1…OQ-9),
    §15 glossary.
  - §12 contains self-contained workstream briefs: Phase 2 = WS-2.0…WS-2.12 (WS-2.0 live-provider
    preflight gates the rest), Phase 3 = WS-3.1…WS-3.7, with a dependency chain in §12.2.
  - Notable divergences now on record: hosted application form (F2.1) unbuilt **and previously
    unscheduled** → OQ-1; no audit read/export API (F4.3 → WS-2.8); manual-question filter
    function unexposed (F5.3 → WS-2.4); scanned-PDF fallback never built (OQ-5); JD tone not
    configurable (OQ-6); seeder formats not varied (F2.3 note); §9.4 is the latent-defect ledger
    with each item assigned to a workstream.

## Verification & results
- Every §9/§10 claim in the PRD was checked against source (all pipeline stages, routers, schemas,
  tables, prompts, guardrails, seeds, frontend pages, tests, configs read this session).
- Cross-reference consistency pass: F↔WS↔OQ↔D↔§9.4 references resolve; §12.2 dependency chain
  matches each workstream's stated dependencies.
- Test suite unchanged and green: 36 passed (offline, faked LLM client).

## Decisions
`DECISIONS.md` → 2026-07-09 "PRD v1.0" and "Documentation governance"; PRD §11 D-9/D-10.

## Known gaps & follow-ups
- `README.md` quickstart unchanged (still accurate); its docs table was touched to describe the
  PRD's broader scope.
- The design spec (`docs/superpowers/specs/…`) still reflects the Anthropic era — deliberately
  left as a historical artifact; PRD v1.0 header notes this (D-8).
- Uncommitted at handover time: the governance files + PRD v1.0 sit in the working tree for the
  owner's review/commit.

## Files & areas touched
`PRD.md`, `CLAUDE.md`, `DECISIONS.md`, `README.md` (docs table), `docs/handover/*`.

## Pick-up notes
Next substantive work is Phase 2. Start from PRD §12: run WS-2.0 (live-provider preflight) first;
WS-2.1 (grounding corpus) unlocks WS-2.2/2.4/2.11. Before any pilot conversation, resolve OQ-1
(hosted application form). Each WS section is written to be expanded by a standalone design
session without re-reading the whole PRD.
