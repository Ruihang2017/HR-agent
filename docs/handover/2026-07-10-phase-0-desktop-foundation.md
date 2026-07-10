# Handover — Phase 0: Desktop foundation

- **Date:** 2026-07-10
- **Author:** horace.hou
- **Status:** Complete (merged to `main` via PR #1, `eb93114`)
- **Related:** PRD v2.8 section 10 Phase 0; spec
  `docs/superpowers/specs/2026-07-10-phase-0-desktop-foundation-design.md`; plan
  `docs/superpowers/plans/2026-07-10-phase-0-desktop-foundation.md`; decisions D-14, D-21…D-24

## Summary
The Jobpin desktop skeleton is real: an installable Electron app that, on first run, creates the
boss's `~/jobpin-data` workspace, opens/migrates a SQLite database containing all 13 PRD tables,
starts an embedded Hono server on a private localhost port, and shows a live status window —
fully offline-capable, shipped as a Windows NSIS installer. Every Phase 0 acceptance criterion
passed, including the full packaged-build checklist run manually by the owner.

## Scope
PRD Phase 0 exactly (spec tasks 1–3): shell, server, schema, scaffold, packaging. No AI, no
hiring features, no real UI — those start at Phase 1.

## What was built
- **Toolchain:** single-package TypeScript (strict) project; electron-vite (dev/build with HMR),
  electron-builder (NSIS), Vitest. Node pinned via `.nvmrc` (22).
- **`src/server/` (Electron-free, fully unit-tested):**
  - `paths.ts` — `~/jobpin-data` resolution (D-21) with `JOBPIN_DATA_DIR` test/dev override
  - `scaffold.ts` — first-run tree creation; idempotent; **never overwrites user files**
  - `db.ts` — better-sqlite3 open (WAL, `foreign_keys=ON`, `busy_timeout`), transactional
    migration runner (gapless-id validation, loud failure on a DB newer than the app)
  - `migrations/0001_init.ts` — all 13 PRD tables, an index on every FK column, and
    **ranking-snapshot immutability triggers** (UPDATE/DELETE on `rankings`/`ranking_items`
    aborts — PRD invariant 11.1-5 enforced at the DB layer; Phase 5 relaxes by migration)
  - `app.ts` / `serve.ts` — Hono app (`/health`, `/version`, CORS) served on `127.0.0.1:0`
- **Electron wiring:** single-instance lock; spec startup sequence with honesty-in-failure error
  dialogs (plain-language dialog + clean exit, never half-initialized); hardened webPreferences
  (contextIsolation, sandbox, no nodeIntegration); 3-method preload bridge (`window.jobpin`);
  React status window with live health, schema version, and an "Open folder" button.
- **Packaging:** `electron-builder.yml` (NSIS, `oneClick: false`, better-sqlite3 asarUnpack);
  `docs/phase0-install-checklist.md`; README "Run it" section.

## How to run & verify
See `README.md` (dev: `npm run dev`; tests: `npm test` — **never `npx vitest`**, see below;
installer: `npm run dist`). Packaged verification: `docs/phase0-install-checklist.md`.

## Verification & results
- **20/20 Vitest tests** + typecheck clean. Tests run under `ELECTRON_RUN_AS_NODE=1 electron`
  so they exercise the exact Electron-ABI better-sqlite3 binary that ships.
- Dev run verified visually (green health, scaffold + `jobpin.db` on disk, Open folder).
- Packaged build verified by silent install + launch (Electron-ABI native module confirmed in
  the installed app; existing `values.md` marker preserved across relaunch).
- **Owner manually ran all 8 checklist items — all passing**, including the offline relaunch and
  uninstall-survival (`jobpin-data` outlives uninstall).

## Decisions
- **D-21** data location `~/jobpin-data` (OneDrive-safe) · **D-22** foundation stack (Approach A)
  — both from the design session.
- **D-23** (implementation): `postinstall` uses **@electron/rebuild** (`electron-rebuild -f -w
  better-sqlite3`) instead of `electron-builder install-app-deps` — standing choice.
- **D-24** (implementation, temporary): `dist` carries `NODE_OPTIONS=--experimental-require-module`
  so electron-builder runs on the dev machine's Node 22.11; remove once Node ≥ 22.12.

## Known gaps & follow-ups
- **Unsigned installer** — SmartScreen warns; buy a code-signing certificate before any
  client-facing distribution (D-14 pre-distribution to-do).
- **Node 22.11 workaround (D-24)** — upgrade the dev machine to current Node LTS, then drop the
  `NODE_OPTIONS` flag from the `dist` script and the README note.
- Default Electron icon (placeholder); real branding is Phase 1+ polish.
- No CI, no auto-update, no code coverage — deliberate Phase 0 deferrals.
- `candidates.status` vocabulary and interview `boss_decision` vocabulary are Phase 1/2 design
  items (columns exist with defaults only).

## Files & areas touched
`src/main/`, `src/preload/`, `src/renderer/`, `src/server/`, `tests/` (5 files),
`electron-builder.yml`, `electron.vite.config.ts`, `vitest.config.ts`, `tsconfig*`,
`package.json` (+lock), `.nvmrc`, `.gitignore`, `resources/`, `docs/phase0-install-checklist.md`,
`README.md`. 9 commits, merged as PR #1 (`eb93114`).

## Pick-up notes
Next is **Phase 1 — Job workspace & candidate intake** (PRD section 10, spec tasks 4–6): job
creation UI → per-job folder generation, JD upload, resume upload/paste + text extraction,
unranked candidate list. Its brief flags two design items to settle early: filesystem-safe job
folder naming (unicode/duplicates) and the PDF/DOCX extraction library. Start with a
brainstorming/design session as for Phase 0. The `src/server/` module boundary and the
relative-`*_path` convention are load-bearing — keep them.
