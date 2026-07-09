# Handover — Phase 1: core agent workflow, end-to-end

- **Date:** 2026-07-07
- **Author:** horace.hou
- **Status:** Complete
- **Related:** PRD F1–F5; `DECISIONS.md` (2026-07-06 stack/pipeline/invariant/wrapper/tiering,
  2026-07-07 Phase 1 scope); plan `docs/superpowers/plans/2026-07-06-phase-1-core-workflow.md`;
  spec `docs/superpowers/specs/2026-07-06-shortlist-poc-design.md`

## Summary
Delivered the full code-orchestrated hiring pipeline end-to-end — a plain-language role
description goes in, a ranked identity-blind shortlist plus interview kits come out across ~50
synthetic resumes — with every stage's structured output inspectable in the UI or DB. Compliance
guardrails ship as honest stubs behind stable interfaces.

## Scope
Covers the whole Phase 1 pipeline, data model, LLM wrapper, seeder, and review UI. Does **not**
cover real guardrails (RAG-grounded linter/filter, layered redaction), the bias harness, audit
export, encryption, or prompt-injection defences — all Phase 2.

## What was built
- **Backend** (`backend/shortlist/`): FastAPI app + SQLite via SQLAlchemy 2.0.
- **Data model** (`models/tables.py`): `Job → Rubric → Application → ScoreReport → DecisionEvent`,
  plus `InterviewKit` and append-only `AuditEvent` (PRD §8).
- **LLM layer** (`llm/`): single `call_structured()` wrapper (structured Pydantic outputs, one
  retry, per-call `AuditEvent`) + a versioned prompt registry.
- **Pipeline stages** (`pipeline/`): `extract` (txt/docx/pdf, graceful failure), `intake`
  (bounded Q&A, code-enforced 5-question cap), `jd_gen` (JD + rubric, lint slot), `parse`,
  `redact` (regex slot), `score` (one call per criterion + rationale), `kit_gen` (filter slot),
  and the `run` screening orchestrator.
- **Guardrail slots** (`guardrails/`): `RegexRedactor` (email/phone/year/DOB/name), pass-through
  linter and question-filter — all reporting `implemented: false` so the UI labels them honestly.
- **Seeder** (`seeds.py`): deterministic synthetic resumes (varied quality) plus one corrupt file
  to exercise the manual-review path.
- **Frontend** (`frontend/`): Vite + React + TS + Tailwind review UI — jobs list, intake chat,
  JD/rubric view, ranked shortlist, candidate detail (redacted + original), shortlist/hold/reject
  with notes, interview-kit view.

## How to run & verify
See `README.md` (backend via `uv`, frontend via `npm`). Demo path: New job → answer intake →
review JD/rubric → seed + screen → review ranked shortlist → decide → generate kit.

## Verification & results
- **36 backend tests pass** (`uv run pytest`), no network required — the model client is faked.
- Each definition-of-done is executable (tests per task in `backend/tests/`).
- Manual end-to-end pass done separately by the developer.

## Decisions
Established the code-orchestrated pipeline, the audit-first single LLM wrapper with structured
outputs, two-tier model routing, the human-decision-gate invariant, and guardrails-as-stub-slots.
See the 2026-07-06 and 2026-07-07 entries in `DECISIONS.md`.

## Known gaps & follow-ups
Carried into the Phase 2/3 roadmap (`docs/superpowers/plans/2026-07-06-shortlist-poc-roadmap.md`):
- **Kit all-blocked case:** `generate_kit` can raise `ValidationError` (`InterviewKitSchema`
  `min_length=1`) if a *real* filter ever blocks every question — dormant under the stub filter;
  decide rewrite-vs-drop semantics in Phase 2.
- **Cost claim unverified:** the "cents, not dollars" figure was never measured on a live run.
  (Note: the manual prompt-cache breakpoint was later removed in the 2026-07-09 OpenAI migration,
  which caches stable prefixes automatically — re-measure there.)
- **UI polish:** browser tab still titled "frontend"; initial-load pages can stick on "Loading…"
  if the backend hiccups; leftover Vite template assets.
- **Open spec question:** scanned-PDF handling — Phase 1 flags `needs_manual_review`; the spec's
  native-PDF fallback is deferred.
- Smaller carry-overs: intake-cap-override audit event, CriterionEval/IntakeDecision cross-field
  validators, seeder stale-file scoping.

## Files & areas touched
`backend/shortlist/**` (app, models, llm, guardrails, pipeline, seeds, config, db),
`backend/tests/**`, `frontend/**`.

## Pick-up notes
Phase 2 is next: write its detailed TDD plan (the roadmap has the task outline), starting with the
grounding corpus + real linter/filter and the bias harness (the portfolio centrepiece). Keep the
guardrail interfaces stable — swap implementations behind them, don't touch the pipeline stages.
