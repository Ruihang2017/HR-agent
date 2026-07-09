# Shortlist — AI Hiring Assistant POC

AI agent that takes an Australian small-business owner from "I need to hire someone" to a ranked, identity-blind shortlist plus interview kits — with fairness and legal guardrails at every step. Skills-practice / portfolio project heading toward a client demo and possible pilot.

**Read first:** `PRD.md` (requirements, F-numbers referenced throughout) and `docs/superpowers/specs/2026-07-06-shortlist-poc-design.md` (approved design). The implementation plan lives in `docs/plans/`.

## Build order (deliberate, differs from PRD milestones)

1. **Phase 1** — core agent workflow end-to-end, guardrails as stub slots
2. **Phase 2** — real guardrails, harnessing, security (bias harness, RAG-grounded linter/filter, layered redaction, audit export, encryption)
3. **Phase 3** — demo polish, pilot-readiness docs

## Architecture

Monorepo: `backend/` (Python 3.12+, FastAPI, SQLAlchemy + SQLite) and `frontend/` (Vite + React + TS + Tailwind).

The AI layer is a **code-orchestrated pipeline**, not an agent loop. Code controls the stage sequence; the model never controls flow:

```
intake (bounded Q&A, max 5) → jd_gen + rubric → lint → parse → redact
  → score (one call per criterion) → human review UI → kit_gen → question_filter
```

- Each stage in `backend/pipeline/` is a typed function `(PydanticModel, ctx) -> PydanticModel` wrapping one focused OpenAI call.
- Guardrail stages (`lint`, `redact`, `question_filter`) are **slots** in `backend/guardrails/` — Phase 1 ships stubs (regex-only redaction, pass-through linter/filter); Phase 2 swaps real implementations behind the same interfaces. Do not bypass or inline a slot.
- Data model (PRD §8): `Job → Rubric → Application → ScoreReport → DecisionEvent`, plus `InterviewKit` and append-only `AuditEvent`.

## LLM layer rules (backend/llm/)

- All model calls go through the single `call_structured()` wrapper in `shortlist/llm/client.py` — it persists stage, model, prompt_version, redacted inputs, output, and token usage as an `AuditEvent`. Never call the OpenAI SDK directly from a pipeline stage. The API key is read from `backend/.env` (`OPENAI_API_KEY`).
- **Structured outputs only:** `client.beta.chat.completions.parse()` with a Pydantic model passed as `response_format`; read the result from `response.choices[0].message.parsed`. No hand-parsing JSON from text. Validation errors: retry once, then flag "needs manual review".
- **Model tiering** (per-stage in config): `gpt-4o-mini` for parsing/redaction assistance; `gpt-4o` for JD/rubric generation, scoring, kits, linter/filter reasoning. Model IDs are config-driven — override via `SHORTLIST_MODEL_FAST` / `SHORTLIST_MODEL_STRONG`.
- **Scoring consistency (F3.4)** comes from per-criterion calls, strict schemas, and frozen versioned prompts (plus the golden-set regression test) — not sampling luck. We pass no `temperature`/`top_p`, which keeps the wrapper portable across model families (including reasoning models that reject them); a low temperature is available as a config lever for non-reasoning models if a run ever needs it.
- Prompts live in the versioned prompt registry, not inline in stage code. Changing a prompt bumps its version; scoring-prompt changes must pass the golden-set regression.
- Prompt caching: OpenAI caches long, stable prompt prefixes automatically (no `cache_control` needed). Keep the system prompt + rubric first and byte-identical across candidates of a job, and put per-candidate content after them, so those cache hits land.
- Resume content is **untrusted input** (prompt-injection surface). Keep it delimited in prompts; never let it into system prompts.

## Product invariants (never violate, any phase)

- No candidate is ever rejected, ranked out, or advanced without an explicit human action. No bulk auto-actions. Must-have failures go to a "did not meet stated requirements" section — visible, never auto-rejected (F3.3, F4.2).
- Every AI output and every human decision is logged to the append-only audit trail (F4.3).
- Compliance outputs cite the grounding corpus or refuse and link to fairwork.gov.au — never improvise legal guidance (F6.1). Always carry the "general information, not legal advice" disclaimer.
- Award pointers name the likely award only — never compute rates or classifications (PRD §3).
- Parse/score failures surface as "needs manual review" — never a silent zero (NFR honesty-in-failure).

## Conventions

- Tests: pytest in `backend/tests/`. Each phase's definition-of-done is executable. The bias harness (matched-pair score parity) is the portfolio centrepiece — keep it and its report artifact green and committed.
- Windows dev machine; prefer cross-platform tooling in scripts.
- Synthetic data only until a pilot is agreed — no real candidate PII in the repo, fixtures, or tests.
