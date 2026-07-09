# Jobpin — Local-First Hiring Workbench (pre-implementation)

A boss-only hiring assistant that runs on the boss's own computer:
Electron desktop app + embedded Node.js local server + SQLite + local files.
AI analysis calls cloud model APIs (OpenAI / DeepSeek / Claude) through a
switchable gateway; model access comes with the subscription (Free tier, or
Pro at A$20/month) — the boss picks a model from the in-app catalog and never
handles API keys. The app calls providers directly via issued tokens, so
resumes never transit vendor servers, and all hiring data stays local. One
role (the boss). The AI analyses and ranks candidates with evidence and
confidence; the boss makes every decision.

**Status:** the project was reset on 2026-07-09 to realign with the client's
technical spec. **There is no runnable application yet** — implementation
starts at PRD Phase 0. The previous product ("Shortlist") is preserved in git
history at commit `db5e511`.

## Project docs

| Doc | What it holds |
|---|---|
| [`PRD.md`](PRD.md) | The source of truth: requirements, architecture, phased plan (English, self-contained) |
| [`docs/meeting_minutes/`](docs/meeting_minutes/) | Archived client meeting outcomes — incl. the 2026-07-09 technical spec the PRD derives from |
| [`templates/`](templates/) | Developer-supplied, lawyer-reviewed AU template content (emails, onboarding, legal) |
| [`DECISIONS.md`](DECISIONS.md) | Decision index (D-1…) + dated log of major decisions and rationale |
| [`docs/handover/`](docs/handover/) | One handover per major implementation or phase |
| [`CLAUDE.md`](CLAUDE.md) | Working agreement for contributors (human or AI) |

## Planned shape (PRD section 9)

```
Electron (React) ── Node.js local server ── SQLite (index)
                          │                  jobpin-data/ (substance: MD/JSON/files)
                          └── model gateway ⇄ OpenAI / DeepSeek / Claude API
```

MVP journey: create job → import resumes → AI analysis + ranked list with
immutable ranking snapshots → interview questions → manual interview records →
re-ranking → invitation & onboarding email templates. All data stays local;
AI steps call the configured model API.

## Run it

Nothing to run yet. Phase 0 (Electron shell, local server, SQLite schema) is the
first implementation step — see PRD §11.
