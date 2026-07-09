# Handover — LLM provider migration: Anthropic → OpenAI

- **Date:** 2026-07-09
- **Author:** horace.hou
- **Status:** Complete (pending live smoke test)
- **Related:** PRD §7 (cost envelope), §11 (stack); `DECISIONS.md` (2026-07-09 OpenAI provider);
  builds on the Phase 1 LLM wrapper

## Summary
Swapped the entire model layer from the Anthropic SDK to the OpenAI SDK behind the existing
`call_structured()` interface, so no pipeline stage changed. Added a `.env`-based key setup and
updated all docs to match.

## Scope
Covers the LLM client, config, dependency, test fakes, and provider-facing docs. Does **not**
change any pipeline stage, schema, or product behaviour — same inputs/outputs, different provider.

## What was built
- **`llm/client.py`:** rewritten to `client.beta.chat.completions.parse(..., response_format=Model)`,
  reading `response.choices[0].message.parsed` and usage from `prompt_tokens`/`completion_tokens`.
  System prompt goes first as a message (OpenAI auto-caches stable prefixes); the manual
  `cache_control` breakpoint was removed. No `temperature`/`top_p` sent.
- **`config.py`:** added `openai_api_key` (reads `OPENAI_API_KEY` from `backend/.env` via a pydantic
  alias, no shell export needed); model tiers now `gpt-4o-mini` (fast) / `gpt-4o` (strong),
  overridable via `SHORTLIST_MODEL_FAST` / `SHORTLIST_MODEL_STRONG`.
- **Secrets:** `backend/.env` (gitignored) for the real key; `backend/.env.example` committed as the
  template.
- **Dependency:** `anthropic` → `openai` (2.44.0) in `pyproject.toml` / `uv.lock`.
- **Tests:** `conftest.py` fake now mimics OpenAI's response shape; `test_llm_client.py` /
  `test_score.py` assert on the new call kwargs (model, `messages`, no sampling params).
- **Docs:** `README.md`, `PRD.md` (§7 tiers, §11 stack decided), and `CLAUDE.md`'s former LLM
  section updated for OpenAI.

## How to run & verify
See `README.md`. Copy `backend/.env.example` → `backend/.env`, paste `OPENAI_API_KEY=sk-…`, then
run the backend as usual.

## Verification & results
- **36 backend tests pass** (`uv run pytest`), no network needed.
- Confirmed the installed OpenAI 2.44.0 SDK exposes `beta.chat.completions.parse`.
- Confirmed `settings` loads `gpt-4o-mini` / `gpt-4o` and reads the key from `backend/.env`.

## Decisions
See `DECISIONS.md` → 2026-07-09 "LLM provider: OpenAI". It supersedes the implicit Anthropic
choice from Phase 1 and records the no-sampling-params rationale and the automatic-caching change.

## Known gaps & follow-ups
- **Live strict-schema validation pending.** Tests use a fake client, so the real OpenAI
  structured-output path is unexercised. OpenAI strict mode supports only a subset of JSON Schema;
  some schemas carry bounds (`Criterion.weight` ge/le, `CriterionEval.score` 0–5, `min_length=1`
  on rubric/kit lists) that may be rejected on the first live call. **Run a one-candidate live
  smoke test with a real key and harden schemas if a 400 appears.**
- **Re-measure cost** on a live run now that caching is automatic (closes a Phase 1 carry-over).

## Files & areas touched
`backend/pyproject.toml`, `backend/uv.lock`, `backend/shortlist/config.py`,
`backend/shortlist/llm/client.py`, `backend/tests/{conftest,test_llm_client,test_score}.py`,
`backend/.env`, `backend/.env.example`, `README.md`, `PRD.md`, `CLAUDE.md`.

## Pick-up notes
Do the live smoke test first. If OpenAI rejects a bounded field, the cheapest fix is to relax the
Pydantic `Field(...)` constraints that map to unsupported JSON-Schema keywords and enforce those
bounds in code after parsing (keeps strict mode happy without losing validation).
