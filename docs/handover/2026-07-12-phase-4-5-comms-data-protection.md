# Handover — Phase 4+5: Communications & Data Protection

- **Date:** 2026-07-12
- **Author:** Claude (agent session), reviewed against the owner's task briefs
- **Status:** Complete
- **Related:** PRD section 10 Phases 4 and 5 (F6.1, F6.4, F8.2-F8.4); `DECISIONS.md` D-37..D-40
  (also D-15, D-17, D-19, D-21 from earlier phases); `docs/superpowers/specs/2026-07-12-phase-4-5-communications-data-protection-design.md`;
  `docs/superpowers/plans/2026-07-12-phase-4-5-comms-data-protection.md`

## Summary

Phase 4 (Part A) adds copy-to-clipboard email templates and company identity settings — no send
capability anywhere. Phase 5 (Part B) makes the local-data promise true under inspection: the
whole SQLite database and every candidate file are encrypted at rest under a key wrapped by the
boss's Windows account, candidates can be anonymised and jobs fully deleted without breaking
ranking-snapshot history, and the whole data set can be backed up to (and restored from) one
portable, optionally passphrase-encrypted, file. This was the final task of the phase and also
added the DELETE REST surface, the Settings "Data protection" card, typed-confirmation delete
buttons on JobDetail/Candidate, and this documentation set.

## Scope

**Covers:** six AU email templates + rendering + persistence + UI; company identity settings;
AES-256-GCM candidate-file encryption; whole-DB encryption via
`better-sqlite3-multiple-ciphers` with one-time auto-rekey of a pre-existing plaintext DB;
safeStorage-wrapped master key + first-boot encryption sweep; candidate anonymisation / job
cascade deletion behind flag-gated snapshot-immutability triggers; encrypted/plain backup +
crash-safe restore; the `DELETE /candidates/:id` and `DELETE /jobs/:id` REST endpoints; the
Settings Data-protection card (encryption status, back up, restore); delete buttons with typed
name confirmation on JobDetail and Candidate pages.

**Does not cover:** sending email of any kind (deliberately absent — D-15); onboarding/legal
document generation (post-MVP — D-19); a real passphrase-based key-wrapping upgrade (seam
documented in D-38, not built); scheduled/automatic backups; key rotation UI; multi-machine
portability of the live (non-backup) folder.

## What was built

- **Email templates (Part A):** `templates/au/emails/*.hbs` + `manifest.json` (6 types), seeded
  into `company/email_templates/` by `scaffold.ts` (idempotent, never overwrites); rendering in
  `src/server/emails.ts` (Handlebars, named `ValidationError`s for missing required inputs or a
  broken template); `GET /email-templates`, `POST /candidates/:id/emails`,
  `GET /candidates/:id/emails`, `GET /emails/:id`, `GET`/`PUT /company-settings` in
  `src/server/email-routes.ts`; CandidatePage "Emails" card (type picker, per-type inputs,
  preview, save, copy-to-clipboard, saved-email list).
- **Crypto + candidate-file seam:** `src/server/cryptx.ts` (AES-256-GCM buffer encrypt/decrypt,
  `JPE1` magic, `isEncrypted`, `deriveBackupKey` via scrypt); `src/server/candidate-fs.ts` as the
  single read/write seam every candidate-tree I/O site now goes through (candidates, AI
  persistence/reads, interviews, emails); company/job files (`jd.md`, `learned_skills.md`,
  `question_bank.json`, templates) deliberately still use plain `fs`.
- **Database encryption:** `better-sqlite3-multiple-ciphers` replaces `better-sqlite3`;
  `openDatabase(file, key?)` applies `PRAGMA hexkey`; a pre-existing plaintext DB is detected and
  `hexrekey`'d once, logged; keyless (tests, opt-out) behaviour is unchanged — the full
  pre-Phase-5 suite doubles as the drop-in-cipher proof.
- **Key management:** `src/main/key-provider.ts` (`getOrCreateDataKey`) generates/wraps/unwraps
  the 32-byte master key via Electron `safeStorage`, stored at `jobpin-data/.keys/master.key`;
  `dataKey?: Buffer` is threaded through `AppDeps`/`JobsDeps`/route registrations exactly like
  the existing `TokenIssuer` seam. `data-migrations.ts` runs an idempotent, crash-resumable
  first-boot sweep that encrypts any not-yet-encrypted candidate file (atomic temp-write +
  rename, so a crash mid-sweep never corrupts a file).
- **Deletion:** migration `0004_snapshot_maintenance` adds `maintenance_flags` and rewrites the
  four snapshot triggers to abort unless the matching flag is open inside the same transaction.
  `src/server/deletion.ts` exports `deleteCandidate` (anonymise: PII scrubbed, child rows purged,
  `usage_events.candidate_id` nulled, `memory_events` evidence quotes scrubbed, folder removed,
  `ranking_items` rank/score preserved with only `reason` scrubbed) and `deleteJob` (full
  cascade: candidates, rankings, ranking_items, emails, the job row, the folder).
- **Backup & restore:** `src/server/backup.ts` (`createBackup`/`readBackup`/`extractBackupTo`/
  `restoreSwap`/`assertValidRestoreTree`, Electron-free) + `src/main/ipc.ts` (`jobpin:backup`,
  `jobpin:restore` — save/open dialogs, passphrase never logged, same-volume extraction to avoid
  a cross-drive `EXDEV`, archive validated **before** the live DB connection is closed, two-rename
  swap with a compensating rollback on failure, then `app.relaunch()` + `app.exit()`).
- **REST + UI (this task, closing the phase):** `DELETE /candidates/:id` / `DELETE /jobs/:id` in
  `src/server/routes.ts` (thin wrappers over `deletion.ts`, typed 404s bubble to the existing
  `onError`, both return `200 {deleted:true}`); Settings "Data protection" card (encryption
  status from `/health`, back-up format radio with passphrase/confirm/loss-warning or a plain-zip
  acknowledgement checkbox, restore with a typed "restore" confirmation); a shared
  `ConfirmDeleteModal` component wired into JobDetailPage ("Delete job") and CandidatePage
  ("Delete candidate"), each requiring the exact current name typed before the danger button
  enables; `src/renderer/src/env.d.ts` gained the `backup`/`restore` bridge typings (present in
  `preload/index.ts` since Task 11 but not yet exposed to the renderer's type-checker).

## How to run & verify

See `README.md` → "Run it" for the standard commands, and its new "Emails (Phase 4)" /
"Data protection (Phase 5)" subsections for the user-facing behaviour this phase added.

Manual owner-walk paths specific to this phase (not exercised by the automated suite, which runs
under `ELECTRON_RUN_AS_NODE=1` where `safeStorage` is unavailable): the Settings Data-protection
card's encryption status line, the backup/restore dialogs end-to-end (including a wrong
passphrase and a genuine app relaunch), and the delete confirmation modals.

## Verification & results

- `npm test`: **385 passed / 385, 43 test files** (baseline going into this task: 381/42 — the
  4 new tests are `tests/delete-routes.test.ts`). No flakes observed across the runs in this
  session.
- `npm run typecheck`: clean (`tsc --noEmit` on both `tsconfig.node.json` and
  `tsconfig.web.json`).
- `git diff --stat 42ef5b2..HEAD` (branch base → this task's HEAD): recorded in
  `.superpowers/sdd/task-12-report.md`.
- Manual smoke on an isolated `JOBPIN_DATA_DIR` (never the owner's real `jobpin-data`): see the
  task report for the exact steps and observations (encryption status, email copy, encrypted
  backup, candidate delete with snapshot rank/score preserved, job delete).

## Decisions

`DECISIONS.md` D-37 (email templates: Handlebars, copy-only), D-38 (encryption architecture:
Approach A, safeStorage-wrapped key), D-39 (deletion: anonymise candidates / cascade jobs, both
flag-gated), D-40 (backup/restore: dual format, no passphrase recovery, crash-safe same-volume
swap). All four were logged retroactively by this closing task — Tasks 1-11 built the
functionality; this task is where the phase's decision trail and this handover were written up,
following the same per-phase pattern as Phases 0-3.

## Known gaps & follow-ups

- The passphrase-upgrade seam (D-38: moving `master.key`'s wrapping from DPAPI to a
  scrypt(passphrase) envelope) is documented but intentionally not built.
- `safeStorage.isEncryptionAvailable() === false` and the real Electron backup/restore relaunch
  path are not exercised by the automated suite by construction (`ELECTRON_RUN_AS_NODE=1`); they
  are owner-walk-only, as noted in `key-provider.ts` and this handover.
- Backup assembly holds the whole data set in memory via `jszip` — acceptable at MVP data sizes;
  the design spec records a rider to add a size guard (~500 MB) if that stops being true.
- PRD.md's Phase 4/5 status line was intentionally left untouched by this task per this task's
  explicit instructions (unlike Phases 0-3's close-outs, which did flip PRD status as part of
  their final commit) — a future task should reconcile PRD.md's status header with the fact that
  Phase 4+5 is now complete.

## Files & areas touched (this task specifically)

- `src/server/routes.ts` (DELETE routes), `tests/delete-routes.test.ts` (new)
- `src/renderer/src/pages/SettingsPage.tsx` (Data-protection card), `src/renderer/src/env.d.ts`
  (backup/restore bridge typings)
- `src/renderer/src/components/ConfirmDeleteModal.tsx` (new, shared), wired into
  `src/renderer/src/pages/JobDetailPage.tsx` and `src/renderer/src/pages/CandidatePage.tsx`
- `README.md` ("Emails (Phase 4)", "Data protection (Phase 5)" subsections)
- `DECISIONS.md` (D-37..D-40), this handover file

Everything else listed under "What was built" above shipped in Tasks 1-11 of this same branch;
see the commit log between `42ef5b2` and this task's commit for the file-level detail per task.

## Pick-up notes

Phase 4+5 is functionally complete and phase-closed. The natural next steps are whatever PRD
section 10 sequences after Phase 5 (check PRD.md's current header for status), plus the two
follow-ups above (PRD status reconciliation; the documented-not-built passphrase-upgrade seam) if
and when they become priorities.
