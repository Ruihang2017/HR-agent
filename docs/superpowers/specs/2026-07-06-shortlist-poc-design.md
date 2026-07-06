# Shortlist POC — Design Spec

**Date:** 2026-07-06
**Status:** Approved
**Source requirements:** [PRD.md](../../../PRD.md) (v0.1)

## 0. Summary & decisions

A POC of "Shortlist," the AI hiring assistant for Australian small business described in PRD.md. The build order deliberately differs from the PRD's milestones: the goal is a working end-to-end AI agent workflow first, then agent harnessing / guardrails / security, then a client demo (and possibly a pilot).

Decisions made during design (with the user):

| Decision | Choice | Rationale |
|---|---|---|
| Stack | Python + FastAPI + SQLAlchemy/SQLite backend; Vite + React + TS + Tailwind frontend | Python is the natural home for LLM pipeline work and eval harnesses; the review screen (F4) needs a real UI for a client demo |
| Agent architecture | Code-orchestrated pipeline; each stage is a typed function wrapping one focused Claude call with Pydantic-validated structured output | Maximum auditability and testability; matches PRD's "determinism where it counts" and per-call audit requirements. Agentic-loop frameworks were rejected as fighting the audit/determinism invariants |
| Phasing | Full pipeline with **stub guardrail slots** in Phase 1; real guardrail implementations swap into the slots in Phase 2 | End-to-end demo fast, without re-architecture when guardrails land (redaction sits inside the scoring path, so the slot must exist from day one) |
| Pilot scope | Local demo first; pilot hardening (auth, hosting, hosted-form abuse protection) deferred until a pilot is agreed | Security phase covers essentials that make the story credible: prompt-injection defence, audit log, PII handling, encryption at rest |

## 1. Architecture & repo layout

Monorepo, two apps plus shared data:

```
HR-agent/
├── backend/                  # Python 3.12+, FastAPI, SQLAlchemy + SQLite
│   ├── app/                  #   API routers, dependency wiring
│   ├── pipeline/             #   one module per stage: intake, jd_gen, lint,
│   │                         #   parse, redact, score, kit_gen, question_filter
│   ├── llm/                  #   Anthropic client wrapper, versioned prompt
│   │                         #   registry, call audit logger
│   ├── guardrails/           #   linter / redaction / filter implementations
│   │                         #   (phase 1: stubs; phase 2: real) + RAG corpus
│   ├── models/               #   Pydantic schemas + SQLAlchemy tables
│   └── tests/                #   unit, scoring-consistency regression, bias harness
├── frontend/                 # Vite + React + TS + Tailwind (review screens)
├── data/                     # synthetic resumes, grounding corpus docs, seeds
├── docs/                     # PRD, spec, plan, demo script
└── CLAUDE.md
```

### Pipeline shape

Code orchestrates the stage sequence; the model never controls flow.

```
Sam input ─▶ [Intake agent: bounded Q&A loop, max 5 questions]
              │
              ▼
        JD + Rubric JSON ─▶ [Linter slot]
              │
 resumes ─▶ [Parse] ─▶ [Redact slot]
              │
              ▼
        [Score: one call per criterion] ─▶ ScoreReport
              │
              ▼
        Review UI (human decision gate) ─▶ [Kit gen + Question-filter slot]
```

Each stage is a typed function `(input: PydanticModel, ctx) -> PydanticModel`. The only loop is intake: the model returns a structured "ask another question" / "finalize" decision, capped at 5 iterations in code (F1.1).

## 2. LLM layer

- **SDK:** official `anthropic` Python SDK. All calls go through a single `llm.call()` wrapper.
- **Models, tiered per PRD §7 cost envelope** (per-stage, in config, swappable):
  - `claude-haiku-4-5` — resume parsing, redaction assistance
  - `claude-opus-4-8` — JD + rubric generation, scoring, interview kits, linter/filter reasoning
- **Structured outputs everywhere:** `client.messages.parse()` with Pydantic models (rubric, parsed resume, per-criterion score, kit, linter flags). No hand-rolled JSON parsing; schema violations fail loudly.
- **Consistency (F3.4) — PRD correction:** the PRD assumes a "low temperature" knob; `temperature` is removed on `claude-opus-4-8` (API returns 400). Consistency is achieved instead by: per-criterion scoring calls (never one holistic call), strict output schemas, frozen versioned prompts, and a regression test asserting must-have outcomes identical and weighted scores within ±0.5 on a golden resume set.
- **Prompt caching:** the system prompt + rubric form the cached prefix for a scoring run; identical across all candidates for a job, so ~90% input-cost reduction from the second resume onward. Combined with Haiku on parsing, this keeps a 50-resume run in the cents range.
- **Audit-first wrapper:** every model call persists `{stage, model, prompt_version, inputs (redacted), output, token usage, timestamp}` as an `AuditEvent` (append-only). F4.3 and the auditability NFR are structural, not retrofitted.
- **Resume file handling:** extract text locally (pdfplumber for PDF, python-docx for DOCX); fall back to Claude native PDF input for scanned/unparseable files. Parse failures flag the candidate "needs manual review" — never a silent zero score (F2.2, NFR honesty-in-failure).

## 3. Data model

Straight from PRD §8:

`Job` (title, JD text, status) → one `Rubric` (criteria[], weights, version) → many `Application` (contact, original file, parsed schema, redacted text) → each has one `ScoreReport` (per-criterion results, overall, rationale, model+prompt versions) → many `DecisionEvent` (actor, action, note, timestamp). `Job` → many `InterviewKit` (candidate ref, questions[], filter results). `AuditEvent` is the append-only union of all model outputs and decision events.

SQLite via SQLAlchemy. Resume files on disk (encrypted at rest from Phase 2); parsed/redacted text in DB.

## 4. Guardrail slots

Interfaces are fixed in Phase 1 so Phase 2 swaps implementations without touching the pipeline.

| Slot | Phase 1 stub | Phase 2 real implementation |
|---|---|---|
| Redaction (F3.1) | Regex-only: names, emails, phones, DOB, graduation years | Layered regex + NER + Haiku model pass; proxy-variable list (suburbs, schools, clubs) |
| JD linter (F1.4) | Pass-through; logs "not implemented" | RAG-grounded flags with citations + suggested rewrites; accept/dismiss logged |
| Question filter (F5.3) | Pass-through | Prohibited-category list in config (code decides, model interprets) + grounded compliant rewrites |
| Grounding corpus (F6.1) | Not present | Small curated store: NES summary, FWO/AHRC guidance on recruitment discrimination and unlawful questions, FWO job-ad guidance. Cite-or-refuse: outputs outside the corpus link to fairwork.gov.au instead of improvising |
| Bias harness (F3.5) | Not present | Matched-pair pytest suite (identical resumes, different names/genders/ages) asserting score parity through the full pipeline; produces a report artifact committed to the repo — the portfolio centrepiece |

Hard product invariants (all phases): must-have failures never auto-reject (F3.3); no bulk auto-action or system-initiated rejection (F4.2); every candidate outcome requires an explicit human click, and every click is logged (F6.3).

## 5. Phases

### Phase 1 — Core agent workflow, end-to-end
Scaffold (backend + frontend), data model, LLM wrapper + prompt registry, all pipeline stages with stub guardrails, synthetic-resume seeder (~50 resumes, varied quality and format, including some that fail parsing), minimal API, React review screen (ranked shortlist → candidate detail → shortlist/hold/reject actions), interview kit generation and display.

**Done when:** a plain-language role description goes in and a ranked shortlist + interview kits come out, across 50 synthetic resumes, with every stage's structured output inspectable in the UI or DB.

### Phase 2 — Harnessing, guardrails, security
Real implementations for all five guardrail slots; scoring-consistency regression tests; human decision gates with nudge-don't-block UX (F4.4); audit log export (JSON first, PDF stretch); prompt-injection defence treating resume content as untrusted input; encryption at rest for resume files; single-action per-job data deletion; consistent "general information, not legal advice" disclaimer policy (F6.2); award pointer (F1.5, informational only).

**Done when:** the bias harness passes on matched pairs; a seeded set of risky JD phrases is caught by the linter with citations; unlawful questions (generated and manually added) are blocked with reasons and rewrites; a job's full decision trail exports as one record.

### Phase 3 — Demo & pilot-readiness
Demo dataset with a narrative arc (including a live naive-vs-blind screening comparison — PRD goal 3); demo script; README with architecture diagram, bias-harness results, and honest-limitations section; optional temporary deploy. Auth, multi-tenancy, and hosted-form abuse protection remain deferred until a pilot is agreed, and are documented as such.

**Done when:** the demo can be run end-to-end from a clean database in under 15 minutes, and the repo reads as a portfolio piece.

## 6. Testing & error handling

- pytest throughout; each phase's definition-of-done is executable.
- Golden-set scoring regression (Phase 2) pinned to prompt versions — a prompt change that shifts scores fails CI visibly.
- Bias harness as a pytest suite emitting a human-readable report artifact.
- Failure policy: parsing/scoring failures surface as "needs manual review" states, never silent defaults; structured-output validation errors are retried once, then flagged.

## 7. Out of scope (load-bearing, from PRD §3)

Candidate sourcing, award rate/classification calculation, payroll/onboarding/contracts, legal advice, automated hiring decisions, multi-tenant SaaS hardening.
