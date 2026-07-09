# Handover — Project reset: Shortlist → Jobpin

- **Date:** 2026-07-09
- **Author:** horace.hou
- **Status:** Complete
- **Related:** `JOBPIN_TECHNICAL_SPEC.md` (new upstream authority); `PRD.md` v2.0;
  `DECISIONS.md` 2026-07-09 reset entry

## Summary
The Shortlist implementation was removed in full and the project restarted as **Jobpin**, a
local-first boss-only desktop hiring workbench, per the client's updated technical spec. The repo
now contains only governance docs, the spec, and the rewritten PRD — no product code.

## Scope
Everything. This is a full reset, not a refactor: new product definition, new stack, new data
model, new phase plan. Nothing from the Shortlist codebase carries forward.

## What was done
1. **Snapshot first:** the complete pre-reset state (Phase 1 web POC, OpenAI migration, docs
   governance, PRD v1.0) was committed as **`db5e511`** — everything removed below is recoverable
   from git history at that commit.
2. **Removed:** `backend/` (Python/FastAPI/SQLAlchemy, 36-test suite), `frontend/` (React web
   app), `data/` (synthetic resumes), `docs/superpowers/` (Shortlist design spec + plans),
   `.superpowers/` (task briefs), and the three Shortlist-era handover files.
3. **Kept (base infrastructure):** `CLAUDE.md` (unchanged), `README.md` (rewritten),
   `DECISIONS.md` (cleared, reset entry added), `docs/handover/README.md` (convention),
   `.gitignore`. The OpenAI key from `backend/.env` was preserved at the repo root as `.env`
   (gitignored) in case a cloud fallback is ever approved (PRD OQ-3).
4. **Rewritten `PRD.md` (v2.0):** derived entirely from `JOBPIN_TECHNICAL_SPEC.md`, with
   spec-section traceability on every requirement. Hierarchy: **spec > PRD > code.**

## The new product in one paragraph
Electron desktop app + embedded Node.js local server + SQLite + `jobpin-data/` local files +
a local LLM ("Hermes modified build"). Single role (the boss). AI analyses resumes against
JD/values/inject with evidence + confidence, ranks candidates with immutable ranking snapshots,
generates interview questions, records interviews, proposes memory updates the boss must approve,
and generates email/onboarding templates that are never auto-sent. No cloud; optional Gmail is
post-MVP. Sensitive attributes are flag-and-excluded ("must not be used for decisions"), not used
and not redacted.

## Verification & results
- Working tree after reset contains only: `.env` (ignored), `.gitignore`, `CLAUDE.md`,
  `DECISIONS.md`, `JOBPIN_TECHNICAL_SPEC.md`, `PRD.md`, `README.md`, `docs/handover/README.md`,
  plus this file.
- PRD v2.0 cross-checked against every spec section (§1–§11); MVP cut matches spec §9 exactly;
  the spec's 14-task build order maps to PRD Phases 0–5.

## Decisions
`DECISIONS.md` reset entry (the reset itself + hierarchy change); PRD §10 D-1…D-6 (stack per
spec, React over Vue, MVP cut, flag-and-exclude, invariants).

## Known gaps & follow-ups
- **CLAUDE.md not yet updated** for the new hierarchy: its rule 1 names `PRD.md` as the source of
  truth but doesn't mention the spec sitting above it. Proposed one-line amendment awaits the
  owner's explicit approval (CLAUDE.md is never self-edited).
- **OQ-1 is the gating unknown:** the exact Hermes model artifact, license, distribution, and
  minimum hardware must come from the client before Phase 2 (and it constrains Phase 0
  packaging). Ask early.
- OQ-5 (UI/template language: Chinese/English/bilingual) should be answered before Phase 1 UI
  work.
- The reset is **uncommitted** at handover time — the owner reviews and commits.

## Files & areas touched
Deleted: `backend/`, `frontend/`, `data/`, `docs/superpowers/`, `.superpowers/`, three old
handovers. Rewritten: `PRD.md`, `README.md`, `DECISIONS.md`. Added: this file, root `.env`
(ignored). Unchanged: `CLAUDE.md`, `.gitignore`, `docs/handover/README.md`,
`JOBPIN_TECHNICAL_SPEC.md`.

## Pick-up notes
Start at **PRD §11 Phase 0** (Electron shell, local server, SQLite schema, `jobpin-data/`
scaffold) — it has no dependencies. In parallel, chase **OQ-1** (Hermes artifact) and **OQ-5**
(language) with the client; OQ-1 gates Phase 2. Each phase section in PRD §11 is a
self-contained brief for a design session.
