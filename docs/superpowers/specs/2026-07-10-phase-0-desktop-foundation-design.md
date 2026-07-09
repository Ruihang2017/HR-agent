# Phase 0 — Desktop Foundation: Design Spec

**Date:** 2026-07-10
**Status:** Approved (owner, 2026-07-10)
**Source requirements:** `PRD.md` v2.8, section 10 Phase 0 (spec tasks 1–3)
**Governing decisions:** D-2/D-3 (stack), D-14 (Windows-first), D-21 (data location), D-22 (foundation stack — Approach A)

## 1. Summary

The launchable skeleton every later phase builds on: an Electron desktop app (React + TypeScript)
that on startup creates the boss's `~/jobpin-data` workspace, opens/migrates a SQLite database
containing all 13 PRD tables, starts an embedded Hono HTTP server on a private localhost port,
and shows a minimal status window proving it all works — offline, packaged as a Windows NSIS
installer.

Phase 0 contains **no AI, no hiring features, and no real UI**. Its acceptance bar (PRD Phase 0):
fresh install → app opens; server responds on localhost; DB file exists with all 13 tables;
`jobpin-data/company/` scaffold created; everything works offline.

## 2. Repository layout

App code lives at the repo root (one product, one repo), scaffolded with electron-vite:

```
jobpin/  (repo root)
├── src/
│   ├── main/          # Electron main process
│   │   ├── index.ts       # lifecycle: single-instance lock, scaffold, DB, server, window
│   │   └── ipc.ts         # ipcMain handlers (server port, app info)
│   ├── preload/
│   │   └── index.ts       # contextBridge API (section 4)
│   ├── renderer/          # React status shell (section 7)
│   └── server/            # Everything below is Electron-free and unit-testable:
│       ├── app.ts         # Hono app factory (routes: /health, /version)
│       ├── db.ts          # better-sqlite3 open + pragmas + migration runner
│       ├── migrations/    # TS modules exporting SQL strings (0001_init.ts, …)
│       └── paths.ts       # single source of truth for all jobpin-data paths
├── resources/         # app icon (placeholder in Phase 0)
├── electron.vite.config.ts
├── electron-builder.yml
├── package.json · tsconfig.json (+ project references per process)
└── docs/ · templates/ · PRD.md · …   (existing repo docs, untouched)
```

Design rule: **`src/server/` must not import Electron.** It receives its data directory from the
caller (main process in production, a temp dir in tests). This keeps the entire persistence and
HTTP layer unit-testable with plain Vitest and preserves the option to move it into a
`utilityProcess` later (rejected-for-now alternative in D-22) without rewriting it.

## 3. Startup sequence (main process)

1. **Single instance:** `app.requestSingleInstanceLock()`; a second launch focuses the existing
   window and exits.
2. **Paths:** resolve the data root via `paths.ts`: `JOBPIN_DATA_DIR` env override if set (tests,
   dev profiles), else `join(os.homedir(), 'jobpin-data')` (D-21).
3. **First-run scaffold:** create, if missing (never overwrite existing files):
   ```
   jobpin-data/
     company/
       company_memory.md        (empty)
       values.md                (empty)
       boss_preferences.json    (empty JSON object)
       legal_templates/
       onboarding_templates/
     jobs/
   ```
4. **Database:** open `jobpin-data/jobpin.db` (better-sqlite3); set pragmas
   `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`; run pending migrations (section 5).
5. **Server:** create the Hono app, serve it on `http.createServer` bound to `127.0.0.1:0`;
   capture the OS-assigned port. The server never binds a non-loopback interface.
6. **Window:** open the BrowserWindow (Electron security defaults hardened: `contextIsolation:
   true`, `nodeIntegration: false`, `sandbox: true`); the renderer obtains the port via the
   preload API and pings `/health`.

**Failure policy (honesty-in-failure, PRD 11.2):** any failure in steps 2–5 shows a
plain-language `dialog.showErrorBox` naming the failing path/step, then quits cleanly. No
half-initialized state, no silent fallback, no auto-retry loops.

## 4. IPC / preload contract

`contextBridge.exposeInMainWorld('jobpin', …)`:

```ts
interface JobpinBridge {
  getServerPort(): Promise<number>;                       // 'jobpin:server-port'
  getAppInfo(): Promise<{ version: string; dataDir: string }>; // 'jobpin:app-info'
  openDataFolder(): Promise<void>;                        // 'jobpin:open-data-folder' → shell.openPath
}
```

Nothing else crosses the bridge in Phase 0. All feature traffic goes renderer → HTTP →
`127.0.0.1:<port>` (the shape later phases extend).

## 5. Database & migrations

**Runner:** migrations are TS modules `{ id: number; name: string; sql: string }` applied in id
order, each inside a transaction, recorded in a bookkeeping table:

```sql
CREATE TABLE IF NOT EXISTS migrations (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL
);
```

Re-running is a no-op; a database "from the future" (higher migration id than the app knows —
i.e. the boss downgraded the app) fails loudly with a clear message rather than guessing. TS
modules (not `.sql` files) avoid asar file-path handling entirely.

**Migration `0001_init` creates all 13 PRD tables.** Conventions: `INTEGER PRIMARY KEY` ids;
ISO-8601 TEXT timestamps defaulting to `strftime('%Y-%m-%dT%H:%M:%fZ','now')`; an index on every
FK column; **no `ON DELETE CASCADE` anywhere** — deletion semantics belong to Phase 5 (D-17);
**every `*_path` column stores a path relative to the `jobpin-data/` root** — never absolute —
so a backed-up folder restores intact on any machine or username (F8.4).

The seven spec-defined tables *(PRD section 8.1; deviations noted)*:

```sql
jobs(id, name TEXT NOT NULL UNIQUE, folder_path TEXT NOT NULL,
     jd_path TEXT, inject_path TEXT, created_at, updated_at)
     -- UNIQUE name: one folder per job named after the job (PRD 8.2)

candidates(id, job_id → jobs NOT NULL, name TEXT NOT NULL, email TEXT, phone TEXT,
     status TEXT NOT NULL DEFAULT 'new', current_rank INTEGER, created_at, updated_at)
     -- status vocabulary is a Phase 1/2 design item; Phase 0 only sets the default

candidate_documents(id, candidate_id → candidates NOT NULL, type TEXT NOT NULL,
     file_path TEXT NOT NULL, extracted_text_path TEXT, created_at)

interviews(id, candidate_id → candidates NOT NULL, stage INTEGER NOT NULL DEFAULT 1,
     mode TEXT NOT NULL DEFAULT 'manual', scheduled_at TEXT, transcript_path TEXT,
     summary_path TEXT, ai_score REAL, boss_decision TEXT, created_at)

rankings(id, job_id → jobs NOT NULL, criteria TEXT NOT NULL DEFAULT '[]', reason TEXT,
     created_at)
     -- criteria (JSON) added beyond the spec field list: PRD F4.2's snapshot shape
     -- requires the criteria used; recorded here as a deliberate deviation

ranking_items(id, ranking_id → rankings NOT NULL, candidate_id → candidates NOT NULL,
     rank INTEGER NOT NULL, score REAL NOT NULL, reason TEXT)

memory_events(id, scope TEXT NOT NULL,            -- company | job | candidate
     scope_id TEXT, source_type TEXT, source_id INTEGER, content TEXT NOT NULL,
     approved_by_boss INTEGER NOT NULL DEFAULT 0, created_at)
```

The six tables deferred to this design *(PRD section 8.1 last paragraph)*:

```sql
interview_questions(id, interview_id → interviews NOT NULL, order_index INTEGER NOT NULL,
     category TEXT NOT NULL,      -- standard | resume | jd_risk | boss_favourite | followup
     text TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'generated',  -- generated | question_bank | boss
     created_at)

interview_answers(id, interview_question_id → interview_questions NOT NULL,
     answer_text TEXT, boss_note TEXT, ai_comment TEXT, confidence REAL,
     affects_ranking INTEGER NOT NULL DEFAULT 0,
     source TEXT NOT NULL DEFAULT 'manual',       -- manual | stt (post-MVP)
     created_at)                                  -- per-item fields from spec 4.5

ai_analyses(id, job_id → jobs, candidate_id → candidates,
     kind TEXT NOT NULL,          -- candidate_analysis | interview_summary |
                                  -- question_generation | ranking_reason | skill_proposal
     provider TEXT NOT NULL, model TEXT NOT NULL, prompt_version TEXT NOT NULL,
     input_manifest TEXT NOT NULL DEFAULT '{}',   -- JSON: what went in (paths + hashes)
     output_path TEXT,            -- big outputs live as files; DB is the index
     confidence REAL, created_at)                 -- F3.2 audit fields

emails(id, candidate_id → candidates NOT NULL,
     type TEXT NOT NULL,          -- invite_online | invite_onsite | reschedule |
                                  -- rejection | more_materials | onboarding
     file_path TEXT NOT NULL, created_at)

documents(id, candidate_id → candidates NOT NULL,
     type TEXT NOT NULL,          -- onboarding | legal | other
     file_path TEXT NOT NULL, created_at)

settings(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at)
```

**Snapshot immutability enforced at the DB layer:** `0001_init` adds triggers raising
`ABORT` on any `UPDATE` or `DELETE` against `rankings` and `ranking_items` (PRD invariant
11.1-5, by construction). Phase 5's migration explicitly relaxes the delete trigger when the
candidate-deletion policy (purge vs anonymise) is decided — default-deny until then.

## 6. Server routes (Phase 0)

- `GET /health` → `200 { status: "ok", schemaVersion: number, dataDir: string, uptimeSeconds: number }`
- `GET /version` → `200 { app: "jobpin", version: string }`

That is the entire Phase 0 API surface. Later phases add routes; the app factory takes
`{ db, paths }` as arguments so tests construct it without Electron.

## 7. Shell window (renderer)

One React status screen: product name, live server status (polls `/health`), schema version,
data-folder path, and an **Open folder** button (`openDataFolder()` → `shell.openPath`) as the
first file-first-transparency touch. No router, no styling investment, no other UI — Phase 1
owns real UI.

## 8. Packaging

electron-builder (`electron-builder.yml`): `productName: Jobpin`, `appId: com.jobpin.desktop`,
NSIS target with `oneClick: false` (boss can choose the install directory), asar enabled with
`better-sqlite3` in `asarUnpack`; native-module ABI rebuild via electron-builder's standard
step and **verified in the packaged app**, not just dev mode.

**Signing posture:** Phase 0 ships unsigned — Windows SmartScreen will warn on install.
Accepted for internal/dev builds; purchasing a code-signing certificate is a pre-distribution
to-do (consistent with D-14), tracked when a client-facing build is needed.

Node engine for development: current LTS, pinned in `package.json` `engines` and `.nvmrc`;
Electron pinned to an exact current-stable version in `package.json` at implementation time.

## 9. Testing & acceptance mapping

Vitest, all offline, using `JOBPIN_DATA_DIR` pointed at temp dirs:

| Test | Verifies (acceptance criterion) |
|---|---|
| `paths.ts` resolution + env override | data root logic (D-21) |
| scaffold creates full tree; second run overwrites nothing | first-run scaffold, idempotency |
| fresh DB → migration 0001 applied; re-run → no-op; future-schema DB → loud failure | migration runner |
| schema introspection: exactly the 13 tables (+ `migrations`), FK + index presence, snapshot triggers fire on UPDATE/DELETE | "DB file exists with all 13 tables"; invariant 11.1-5 |
| `/health` and `/version` via Hono app in-process | "server responds on localhost" |

Packaged-build verification is a **documented manual checklist** (in the repo): run the NSIS
installer on Windows → app opens → status screen green → `~/jobpin-data` tree correct → disable
network, relaunch, everything still works. No CI and no Playwright in Phase 0 — deliberate
deferrals until there is more to protect.

## 10. Out of scope (Phase 0)

No AI / model gateway (Phase 2) · no jobs/candidates UI or routes (Phase 1) · no template
bundling (Phase 4, D-16) · no encryption/backup (Phase 5, D-17) · no subscription/auth (Phase 2,
D-10/D-12) · no code signing · no CI · no auto-update.

## 11. Risks & mitigations

| Risk | Mitigation |
|---|---|
| better-sqlite3 ABI mismatch in packaged app | electron-builder rebuild step + packaged-app check in the manual checklist |
| OneDrive-style folder redirection surprises | home-folder location (D-21) avoids the default trap; `paths.ts` is the single place to adjust if a machine proves exotic |
| Migration runner subtle bugs compound forever | smallest possible runner, transaction per migration, loud failure on unknown state, unit-tested no-op/downgrade paths |
| Unsigned installer scares testers | expected SmartScreen warning documented in the checklist; signing before client distribution |
