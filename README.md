# Jobpin — Local-First Hiring Workbench

A boss-only hiring assistant that runs on the boss's own computer:
Electron desktop app + embedded Node.js local server + SQLite + local files.
AI analysis calls cloud model APIs (OpenAI / DeepSeek / Claude) through a
switchable gateway; model access comes with the subscription (Free tier, or
Pro at A$20/month) — the boss picks a model from the in-app catalog and never
handles API keys. The app calls providers directly via issued tokens, so
resumes never transit vendor servers, and all hiring data stays local. One
role (the boss). The AI analyses and ranks candidates with evidence and
confidence; the boss makes every decision.

**Status:** Phase 0 (desktop foundation) implemented — Electron shell, local
server, SQLite schema (13 tables), `jobpin-data` scaffold, Windows NSIS
installer. Phase 1 (job workspace & candidate intake) is next: PRD section 10.
The pre-reset product ("Shortlist") is preserved in git history at `db5e511`.

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

Prereqs: Node 22+ (see `.nvmrc`), npm. Windows is the supported dev/ship OS (D-14).

    npm install        # postinstall rebuilds better-sqlite3 for Electron's ABI
    npm run dev        # launch the app (dev mode, HMR)
    npm test           # unit tests (runs Vitest under Electron's node - do NOT use npx vitest)
    npm run typecheck
    npm run dist       # build the Windows NSIS installer into dist/

First launch creates `%USERPROFILE%\jobpin-data\` (your data, all local) and
`jobpin.db` inside it with the full schema. Packaged-build verification:
`docs/phase0-install-checklist.md`.

Note: on Node 22.11 the `dist` script needs the bundled
`NODE_OPTIONS=--experimental-require-module` (already in the script);
upgrading to Node ≥ 22.12 makes it unnecessary.
