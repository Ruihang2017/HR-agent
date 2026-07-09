# Decisions

A dated, append-mostly log of the **major** decisions on this project and *why*, so any
developer can trace the reasoning and know what may be safely reversed. Newest first.

When a decision changes, add a **new** entry that supersedes the old one — mark the old one
`Superseded` and link forward. Don't rewrite history in place.

Format per entry: **Decision · Context · Alternatives · Rationale · Status**.

---

### 2026-07-09 — PRD v1.0: comprehensive single-source-of-truth rewrite
**Decision:** Rewrite `PRD.md` (v0.1 draft → v1.0 canonical) as a fully self-contained SSOT:
product definition, verified current state, architecture, decisions log, phase-by-phase plan
(workstream briefs), cross-cutting conventions, consolidated open questions, glossary. Introduce
stable identifiers — `D-n` (decisions), `WS-x.y` (phase workstreams), `OQ-n` (open questions) —
and **preserve §1–§8 topic numbering and all F-numbers from v0.1** because code docstrings,
tests, the roadmap, and handovers cite them; §9+ is restructured with an old→new mapping in the
document header.
**Context:** The v0.1 PRD predated implementation and had drifted from the code (e.g. the hosted
application form F2.1 is unimplemented and was unscheduled; the linter/filter/redaction are
labelled stubs; the provider is now OpenAI). Future Claude Code sessions need one document that
reflects reality and scopes the remaining work.
**Alternatives:** Keep the PRD as pure requirements and scatter state/plan across roadmap +
handovers (rejected — future sessions would need to reconcile four documents); renumber sections
freely (rejected — orphans `PRD §8` / `F3.3`-style references across the repo).
**Rationale:** One canonical navigation point; divergences documented explicitly instead of
silently patched; each Phase 2/3 workstream written as a self-contained brief so per-phase design
sessions can start from a single section. PRD §11 summarises this log as D-1…D-10; this file
remains the running append log.
**Status:** Active. See `docs/handover/2026-07-09-docs-governance-and-prd-v1.md`.

### 2026-07-09 — Documentation governance: generic CLAUDE.md, DECISIONS.md, docs/handover/
**Decision:** Reframe `CLAUDE.md` as a project-agnostic working agreement (process rules only),
and introduce two artifacts: this `DECISIONS.md` (decision log) and `docs/handover/` (one
handover file per major implementation or phase). The rules: `PRD.md` is the source of truth
and is not edited without an explicit ask; `CLAUDE.md` is likewise not self-edited; `README.md`
is updated after every major task.
**Context:** Project knowledge and process rules were mixed into `CLAUDE.md`, and there was no
durable record of *why* choices were made or a consistent way to hand work off between sessions.
**Alternatives:** Keep project specifics in `CLAUDE.md` (rejected — couples process to one
project and bloats the always-loaded context); track decisions only in git history (rejected —
commit messages capture *what*, not the weighed *why*).
**Rationale:** Separates durable process (CLAUDE.md) from requirements (PRD), rationale
(DECISIONS), and implementation state (handovers) — each with one clear home.
**Status:** Active.

### 2026-07-09 — LLM provider: OpenAI (migrated off Anthropic)
**Decision:** Use the **OpenAI API** for all model calls. Structured outputs via
`client.beta.chat.completions.parse()` with Pydantic schemas passed as `response_format`.
Model tiering: `gpt-4o-mini` (parse/redact) and `gpt-4o` (intake, JD/rubric, scoring, kits,
guardrail reasoning), both config-overridable. The key is read from `backend/.env`
(`OPENAI_API_KEY`); `.env` is gitignored, with `backend/.env.example` as the committed template.
No `temperature`/`top_p` is sent — consistency (F3.4) comes from per-criterion calls, strict
schemas, and frozen versioned prompts, and omitting sampling params keeps the wrapper portable
across model families (including reasoning models that reject them). OpenAI caches stable prompt
prefixes automatically, so the earlier manual `cache_control` breakpoint was removed.
**Context:** User directive to switch providers. Phase 1 had been built on the Anthropic SDK
(`messages.parse()`, `claude-*` models, a manual cache breakpoint).
**Alternatives:** Stay on Anthropic (rejected per directive); keep the Anthropic-era
no-temperature rule as a hard constraint (relaxed — low temperature is now available as a
config lever for non-reasoning models if ever needed).
**Rationale:** User preference; OpenAI's structured-output parse maps cleanly onto the existing
`call_structured()` wrapper with no change to pipeline stages.
**Open risk:** Tests use a fake client, so the real strict-mode structured-output path is
unverified. A few schemas carry numeric/length bounds (`weight` ge/le, `score` 0–5,
`min_length=1` on rubric/kit lists) that OpenAI strict mode may reject on the first live call —
run a live smoke test with a real key and harden schemas if needed.
**Status:** Active. Supersedes the implicit Anthropic provider choice from Phase 1.
See `docs/handover/2026-07-09-openai-migration.md`.

### 2026-07-07 — Phase 1 scope: full workflow end-to-end, guardrails as stub slots
**Decision:** Ship the entire pipeline (intake → JD/rubric → parse → redact → score → human
review → kit) with the three compliance guardrails (`lint`, `redact`, `question_filter`)
implemented as honest **stubs behind stable interfaces** — regex-only redaction, pass-through
linter/filter that report `implemented: false` so the UI can label them. Real implementations
swap in during Phase 2 without touching pipeline stages.
**Context:** Fastest path to a demonstrable end-to-end agent; the hard compliance/harnessing
work (RAG grounding, bias harness, layered redaction) is large and shouldn't block the workflow.
**Alternatives:** Build real guardrails first (rejected — delays a working demo and risks over-
investing before the pipeline shape is proven).
**Rationale:** Prove the pipeline and its data model early; keep guardrails as swappable slots.
**Status:** Active. See `docs/handover/2026-07-07-phase-1-core-workflow.md`.

### 2026-07-06 — Delivery order differs from the PRD milestones
**Decision:** Build in three phases — (1) core agent workflow end-to-end, (2) real guardrails +
harnessing + security, (3) demo polish + pilot-readiness — rather than following the PRD's
feature-milestone order.
**Context:** The PRD lists milestones by feature area; a working skeleton first de-risks the
architecture and gives something to demo sooner.
**Alternatives:** Follow PRD milestone order (rejected — front-loads compliance depth before the
end-to-end shape exists).
**Rationale:** Working pipeline first, then harden, then polish.
**Status:** Active. Tracked in `docs/superpowers/plans/2026-07-06-shortlist-poc-roadmap.md`.

### 2026-07-06 — Human decision gate is a hard invariant
**Decision:** No candidate is ever rejected, ranked out, or advanced without an explicit human
action. No bulk or system-initiated actions. Must-have failures surface in a visible "did not
meet stated requirements" section — never auto-rejected. Every AI output and human decision is
appended to an audit trail.
**Context:** PRD F3.3 / F4.2 / F4.3 and alignment with Fair Work's position that AI may assist
but not solely determine hiring decisions.
**Alternatives:** Auto-filter obvious non-matches (rejected — violates the product's core
fairness/compliance stance).
**Rationale:** This is a load-bearing product and legal constraint, treated as an invariant, not
a feature.
**Status:** Active (permanent invariant).

### 2026-07-06 — Code-orchestrated pipeline, not an agent loop
**Decision:** Code controls the stage sequence; the model never controls flow. Each stage is a
typed function `(PydanticModel, ctx) -> PydanticModel` wrapping one focused model call.
**Context:** Hiring decisions demand determinism, inspectability, and a reproducible audit trail.
**Alternatives:** An autonomous tool-calling agent loop (rejected — opaque control flow, harder
to audit and to guarantee invariants).
**Rationale:** Predictable, testable, auditable; every stage's structured output is inspectable.
**Status:** Active.

### 2026-07-06 — Single audit-logging LLM wrapper with structured outputs
**Decision:** All model calls go through one `call_structured()` site that uses structured
(Pydantic) outputs and persists an `AuditEvent` (stage, model, prompt version, redacted inputs,
output, token usage) per call. Prompts live in a versioned registry, not inline. Validation
failures retry once, then flag "needs manual review" — never a silent zero.
**Context:** PRD NFRs on auditability, determinism-where-it-counts, and honesty-in-failure.
**Alternatives:** Ad-hoc SDK calls per stage with hand-parsed JSON (rejected — no audit trail,
fragile parsing, prompt drift).
**Rationale:** One choke point makes auditing, model tiering, and prompt versioning uniform.
**Status:** Active. (SDK-specific mechanics updated by the 2026-07-09 OpenAI decision.)

### 2026-07-06 — Two-tier model routing for the cost envelope
**Decision:** Route cheap/mechanical stages (parse, redact) to a small model and
generation/scoring stages to a stronger model, configured per-stage rather than hardcoded.
**Context:** PRD cost envelope — a 50-resume screening run should cost cents, not dollars.
**Alternatives:** One model for everything (rejected — either too costly or too weak).
**Rationale:** Match model strength to task difficulty to keep runs cheap without hurting quality.
**Status:** Active. Concrete models set by the 2026-07-09 OpenAI decision.

### 2026-07-06 — Stack: FastAPI + SQLAlchemy/SQLite; Vite + React + TS + Tailwind
**Decision:** Python 3.12 backend (FastAPI, SQLAlchemy 2.0, Pydantic v2, SQLite, `uv`); frontend
in Vite + React + TypeScript + Tailwind. Single-tenant, demo-quality.
**Context:** PRD open question on stack; optimise for fast iteration on prompts and schemas over
framework novelty.
**Alternatives:** Heavier frameworks / Postgres / a meta-framework (rejected as over-scoped for
a single-tenant POC).
**Rationale:** Lightweight, fast to iterate, easy to run locally on a Windows dev machine.
**Status:** Active.
