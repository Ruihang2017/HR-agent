# Shortlist — AI Hiring Assistant (POC)

From "I need to hire someone" to a ranked, identity-blind shortlist with
interview kits — with fairness and legal guardrails at every step.
See `PRD.md` for requirements and `docs/` for the design spec and plans.

**Status: Phase 1** — core agent workflow end-to-end. Guardrails (discrimination
linter, layered redaction, unlawful-question filter, bias harness) are stub
slots, clearly labelled in the UI; they become real in Phase 2.

## Project docs

| Doc | What it holds |
|---|---|
| [`PRD.md`](PRD.md) | The source of truth: requirements, current state, architecture, decisions, phased plan |
| [`DECISIONS.md`](DECISIONS.md) | Dated log of major decisions + rationale |
| [`docs/handover/`](docs/handover/) | One handover per major implementation or phase |
| [`docs/`](docs/) | Design spec and phase plans |
| [`CLAUDE.md`](CLAUDE.md) | Working agreement for contributors (human or AI) |

## Run it

Prereqs: Python 3.12+, [uv](https://docs.astral.sh/uv/), Node 20+, an OpenAI API key.

```bash
# backend
cd backend
uv sync
cp .env.example .env               # then edit .env: OPENAI_API_KEY=sk-...  (Windows: copy .env.example .env)
uv run uvicorn shortlist.app.main:app --port 8000

# frontend (second terminal)
cd frontend
npm install
npm run dev                         # http://localhost:5173
```

Demo flow: **New job** → describe the role in plain language → answer up to 5
intake questions → review the generated JD + scoring rubric → **Seed 50 + screen**
(synthetic resumes; parsing runs on gpt-4o-mini to keep costs down; OpenAI
caches the stable scoring prefix automatically) → review the ranked, identity-blind shortlist →
shortlist/hold/reject with notes (every click audited) → generate interview kits.

## Tests

```bash
cd backend
uv run pytest -v      # no network needed - the OpenAI client is faked
```

## Architecture (short version)

Code-orchestrated pipeline — the model never controls flow:

    intake → JD+rubric → lint* → parse → redact* → score (per criterion)
          → human review gate → kit → question filter*

`*` = guardrail slots (stubs in Phase 1, real in Phase 2). Every model call is
audit-logged with model + prompt version. Scoring runs on the redacted resume
only; identity is revealed only at the human-review stage.
