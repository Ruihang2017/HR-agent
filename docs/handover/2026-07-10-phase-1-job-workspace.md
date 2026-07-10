# Handover — Phase 1: Job workspace & candidate intake

- **Date:** 2026-07-10
- **Author:** horace.hou
- **Status:** Complete on `feat/phase-1-job-workspace` (17 commits, base `1108cf3`, HEAD `7e2ba0e`); owner
  ran the full manual acceptance walk — merging via PR
- **Related:** PRD v2.11 section 10 Phase 1; spec
  `docs/superpowers/specs/2026-07-10-phase-1-job-workspace-design.md`; plan
  `docs/superpowers/plans/2026-07-10-phase-1-job-workspace.md`; decisions D-26, D-27

## Summary
The boss can now do real (non-AI) hiring work: create a job with its full file-first workspace,
get candidates into it by file upload or pasted text (with PDF/DOCX/TXT extraction), rename a job
safely with candidates present, and browse candidates through the app's first routed UI. Extraction
failure never loses an original — the candidate lands as `needs_review` with a visible reason.
Every Phase 1 acceptance criterion (spec section 11) passed, including the owner's manual walk:
unicode job 「销售经理」, real PDF, paste, corrupt file, rename-with-candidates, duplicate-name 409,
and the whole flow offline.

## Scope
PRD Phase 1 exactly (minutes tasks 4–6): F1.1–F1.4 job workspace, F2.1/F2.2/F2.4 candidate intake,
job rename (owner addition, D-17 keeps delete at Phase 5). No AI, no ranking, no schema changes —
migration 0001 already covered everything.

## What was built
- **`src/server/` (Electron-free, unit-tested):**
  - `naming.ts` — filesystem-safe job-folder derivation: unicode preserved, Windows-illegal chars
    stripped, reserved device names guarded, 80-char cap, case-insensitive ` (2)` collision suffixing
  - `errors.ts` — typed `ValidationError` / `NotFoundError` / `ConflictError`
  - `jobs.ts` — create (full section 8.2 skeleton, folder-first with rollback), list (candidate
    counts), get (JD read from `jd.md`), setJd, and transactional rename (D-26)
  - `fsx.ts` — `renameSyncWithRetry`, the Windows EPERM/EBUSY retry policy (D-27)
  - `extract.ts` — never-throws text extraction: unpdf (PDF), mammoth (DOCX), fs (TXT/MD); pure JS,
    no native modules
  - `candidates.ts` — add from file/paste (DB id → `candidate_<id>` folder → files → document row,
    rollback on failure), list, get; `profile.json` carries name/contact/source/extraction status
  - `routes.ts` — the Phase 1 REST surface on the Phase 0 Hono app; one `app.onError` maps typed
    errors to 400/404/409, plus 413 (20 MB cap) and 422 (JD extraction failure)
- **UI (routed app shell):** react-router (HashRouter — survives `file://` in production), design
  tokens in `styles/tokens.css`, sidebar Shell with live health dot, pages: Jobs (cards + create
  form), JobDetail (inline rename, JD panel, drag-drop + paste intake with per-file failure
  isolation), Candidate (extracted text + needs_review reason + Open folder), System.
- **IPC:** `openPath` on the preload bridge, guarded by `src/main/contained-path.ts` — any path
  escaping `jobpin-data` is rejected (6 adversarial tests).
- **Tests:** 71 passing across 12 files (51 new in Phase 1), committed binary fixtures +
  `tests/fixtures/generate.mjs`.

## How to run & verify
Unchanged: `npm run dev`, `npm test` (never `npx vitest` — D-23), `npm run typecheck`. The
packaged installer in `dist/` predates this phase; rebuild with `npm run dist` when a Phase 1
installer is needed.

## Verification & results
- 71/71 tests + typecheck clean at HEAD, re-verified independently after the final fix commit.
- Executed via subagent-driven development: per-task spec+quality review with fix loops (9 tasks,
  ledger at `.superpowers/sdd/progress.md`), then a whole-branch final review — verdict
  "Ready to merge", its two Important items resolved before merge (docs close-out = this file;
  compensation error-masking fixed in `7e2ba0e`).
- Owner manually ran all 7 acceptance items (spec section 11) — all passing, including offline.

## Decisions
- **D-26** transactional rename: fs-rename-first with compensating rename; one DB transaction
  rewrites all path columns via LIKE-escaped prefix match; case-insensitive same-folder fast path.
- **D-27** Windows fs-retry policy: bounded EPERM/EBUSY/EACCES retry (`renameSyncWithRetry`) —
  antivirus/indexer races made unretried renames flake at ~25–50%.

## Known gaps & follow-ups (ride to Phase 2)
Triaged by the final review as safe to defer, recorded here so they aren't lost:
- Multipart validation duplicated across two route handlers → extract a shared helper; add the
  missing 413/404 tests on the JD route.
- `getCandidate` defaults extraction to "ok" if `profile.json` is unreadable → default to honest
  "unknown/failed".
- Malformed JSON bodies surface as 500 → map to 400.
- No upload extension whitelist (any extension accepted; unsupported ones become `needs_review`).
- One hardcoded `#fff` left in `Shell.tsx`; SystemPage fetches `/health` once (no polling).
- Collision suffixing can push a folder name past the 80-char cap (cosmetic).
- `createJob` fs failures before the DB insert can leave an orphan folder (no DB inconsistency).
- Rollback `rmSync` in candidates isn't EPERM-hardened (could mask the original error).
- Visual design polish deferred — the UI is deliberately "solid foundation" (owner choice).

## Files & areas touched
`src/server/` (7 modules), `src/renderer/src/` (api, tokens, Shell, StatusBadge, 4 pages),
`src/main/` (ipc + contained-path), `src/preload/`, `tests/` (8 new files + helpers + fixtures),
`package.json` (unpdf, mammoth, react-router-dom; pdf-lib + jszip dev-only for fixture
generation), `README.md`. 17 commits.

## Pick-up notes
Next is **Phase 2 — AI analysis & ranking** (PRD section 10): the model gateway (OpenAI /
DeepSeek / Anthropic adapters), subscription/token-issuance client (stubbable with the dev
credentials in `.env`), candidate analysis with evidence + confidence, and immutable ranking
snapshots (DB triggers already enforce immutability). Start with a brainstorming/design session
as for Phases 0–1. Load-bearing patterns to keep: `src/server/` never imports Electron; relative
forward-slash `*_path` values in the DB; typed errors mapped once in `app.onError`; extraction
never throws; all tests via `npm test`. The technical design layer at `docs/design/` (D-28) must
be revised as part of the Phase 2 design session.
