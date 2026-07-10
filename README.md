# Jobpin — Local-First Hiring Workbench

A boss-only hiring assistant that runs on the boss's own computer: Electron desktop app,
embedded local server, SQLite + local files. The AI analyses and ranks candidates with evidence
and confidence; the boss makes every decision. Full definition, scope, and status: **[`PRD.md`](PRD.md)**
(the source of truth — see its header for current project status).

## Directory structure

```
PRD.md                     product spec (WHAT) — read this first; status in its header
CONTEXT.md                 glossary — one canonical term per concept
DECISIONS.md               decision index (D-1…) + dated log (WHY)
CLAUDE.md                  working agreement for contributors, human or AI (process rules)
src/                       the app: main / preload / renderer / server (Electron + TS)
tests/                     Vitest suite (run via `npm test` only — see Run it)
templates/                 developer-supplied, lawyer-reviewed AU template content
docs/
  handover/                one handover per phase / major unit of work
  meeting_minutes/         archived client meeting outcomes (verbatim, superseded by PRD)
  superpowers/specs/       per-phase design docs (HOW)
  superpowers/plans/       per-phase implementation plans
  phase0-install-checklist.md   packaged-build verification
  reference/               external reference material (e.g. the doc-system spec)
site/                      docs portal (VitePress) — auto-deploys to Netlify on push to main
```

## Document map (which doc, when)

| Doc | What it is | When to read |
|---|---|---|
| [`PRD.md`](PRD.md) | Product spec — the source of truth | **First**, and before any product change |
| [`CONTEXT.md`](CONTEXT.md) | Glossary | Any time a term is unclear |
| [`DECISIONS.md`](DECISIONS.md) | Decision registry: index D-1… + dated entries | "Why is it this way?" |
| [`docs/superpowers/specs/`](docs/superpowers/specs/) | Design docs (HOW) | Building or reviewing a specific part |
| [`docs/handover/`](docs/handover/) | Phase handovers | Picking up work mid-stream |
| [`docs/meeting_minutes/`](docs/meeting_minutes/) | Client input, archived verbatim | Tracing a requirement to its origin |
| [`CLAUDE.md`](CLAUDE.md) | Process rules / working agreement | Before contributing |

## Reading paths by role

- **Product / client:** `PRD.md` → the docs portal (same content, searchable, with a feedback form)
- **Engineering:** `PRD.md` sections 8–11 → the relevant design spec in `docs/superpowers/specs/` → `DECISIONS.md` for any "why"
- **AI collaborator (new session):** `CLAUDE.md` → `PRD.md` → `CONTEXT.md` → latest handover in `docs/handover/`

**Decision registry:** the index table at the top of [`DECISIONS.md`](DECISIONS.md).
**Open questions:** none open — every question raised to date is resolved into a decision (resolution notes live in the `DECISIONS.md` entries).

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
