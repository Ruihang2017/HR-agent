# Phase 4+5 — Communications & Data Protection: Design Spec

> Companion: PRD sections 5.4, 6 (F6/F8), 10 · CONTEXT.md · DECISIONS.md (D-15…D-17, D-21) ·
> `docs/design/` | v1.0 · 2026-07-12
> Builds on Phases 0–3. Inherited load-bearing rules: `src/server/` never imports Electron;
> relative forward-slash `*_path`; typed errors mapped once; explicit boss actions; file-first;
> migrations for schema change; all tests via `npm test`.

**Date:** 2026-07-12
**Status:** Approved (owner, 2026-07-12 — combined phase + the five scoping decisions below)
**Source requirements:** PRD section 10 Phases 4 and 5 (minutes tasks 12, 14); F6.1, F6.4, F8.2–F8.4; D-15…D-17, D-21
**Owner decisions this session:** Phases 4+5 ship as **one phase** (one branch/spec/plan; Part A
before Part B) · **Handlebars** as the template engine · key management = **safeStorage-wrapped
random master key with a documented passphrase-upgrade seam** · deleted candidates are
**anonymised** in ranking snapshots (never purged) · backup offers **both** formats —
passphrase-encrypted archive by default, plain zip behind an explicit risk acknowledgement ·
encryption architecture = **Approach A**: whole-DB cipher swap + file-layer candidate encryption.

## 1. Summary

Part A closes the paperwork half of the MVP: six AU business-English email templates
(Handlebars, boss-editable at `company/email_templates/`, seeded from `templates/au/emails/`)
render with job/candidate/company variables plus per-type inputs into the candidate's `emails/`
folder and the `emails` table — copy-to-clipboard, never send, fully offline. Part B makes the
data promise true under inspection: the SQLite database is whole-DB encrypted
(`better-sqlite3-multiple-ciphers`), candidate files are AES-256-GCM encrypted at the file
layer (company/job files stay plain — D-17), the key is a safeStorage-wrapped random master key
living inside `jobpin-data/.keys/`, deletion works for candidates (anonymise-in-snapshots) and
jobs (full cascade) behind rewritten-but-still-strict immutability triggers, and backup/restore
round-trips the whole data set as a passphrase-encrypted portable archive (or plain zip behind
an acknowledgement).

## 2. New/changed modules

| Module | Responsibility |
|---|---|
| `templates/au/emails/` (repo) | Six `.hbs` templates + `manifest.json` (dev-owned defaults; lawyer review not required — business copy, not legal content) |
| `src/server/scaffold.ts` (extend) | Seed `company/email_templates/` from bundled defaults (idempotent, never overwrites) |
| `src/server/emails.ts` | Template listing (manifest), rendering (Handlebars), persistence (file + row) |
| `src/server/cryptx.ts` | AES-256-GCM buffer encrypt/decrypt + `isEncrypted` (magic `JPE1`), scrypt key derivation for backups |
| `src/server/candidate-fs.ts` | The single read/write seam for candidate-tree files: passthrough without a key, encrypt/decrypt with one |
| `src/server/db.ts` (change) | `openDatabase(file, key?: Buffer)` → `PRAGMA hexkey`; plaintext-DB detection + one-time `rekey` migration |
| `src/server/data-migrations.ts` | First-boot encryption sweep of existing candidate trees (idempotent/resumable via `isEncrypted`) |
| `src/server/deletion.ts` | `deleteCandidate` (purge + anonymise + scrub), `deleteJob` (cascade) — both inside maintenance-flag-gated transactions |
| `src/server/backup.ts` | `createBackup` / `readBackup` (Electron-free; main supplies paths/passphrase) |
| `src/server/migrations/0004_*.ts` | `maintenance_flags` table + rewritten snapshot triggers (section 7) |
| `src/main/key-provider.ts` | safeStorage wrap/unwrap of the master key; first-run generation |
| `src/main/ipc.ts` (extend) | `jobpin:backup` / `jobpin:restore` (file dialogs, passphrase prompt payloads, relaunch) |
| Routes (extend) | emails endpoints + `DELETE /candidates/:id`, `DELETE /jobs/:id` |
| UI | CandidatePage Emails card; Settings Data-protection card; typed-confirmation delete buttons |

**New prod dependencies:** `handlebars`, `jszip` (promoted from devDependencies), and the swap
`better-sqlite3` → `better-sqlite3-multiple-ciphers` (drop-in API; D-23's postinstall rebuild
targets the new package name). No other additions.

## 3. Part A — Email templates (F6.1, F6.4)

- **Types (exactly):** `online_invitation` · `onsite_invitation` · `reschedule` · `rejection` ·
  `more_materials` · `onboarding`.
- **`manifest.json`** (seeded beside the templates): array of `{ type, label, file, subject,
  inputs: [{ key, label, kind: 'text' | 'datetime' | 'multiline', required }] }`. Invitations
  require `interview_datetime` + (`location` | `meeting_link`); reschedule requires
  `interview_datetime` + optional `reason`; onboarding requires `start_date`; rejection and
  more_materials need no extra inputs (more_materials takes optional `materials` multiline).
  `subject` is a Handlebars string rendered alongside the body.
- **Variables available to every template:** `candidate_name`, `job_name`, `company_name`,
  `sender_name`, `today` (en-AU long date) + the type's declared inputs. `company_name` /
  `sender_name` come from new settings keys (`company.name`, `company.sender_name`), editable
  on the Settings page, defaulting to empty string (renders as blank — visible nudge, not an
  error).
- **Rendering:** Handlebars in strict-enough mode: compile errors and missing *declared inputs*
  → `ValidationError` naming the template file and the problem; unknown variables render empty
  (boss typo tolerance). Body renders to Markdown-ish plain text.
- **Persistence:** save writes `candidates/candidate_<id>/emails/<type>-<n>.md` (n = next
  ordinal; **through `candidate-fs.ts`**, so Part B encrypts these too) + an `emails` row
  (`candidate_id, type, file_path`). Preview does not persist.
- **REST:** `GET /email-templates` (manifest, for the form) · `POST /candidates/:id/emails`
  `{ type, inputs, save: boolean }` → rendered `{ subject, body }`, plus file+row when
  `save` (201) · `GET /candidates/:id/emails` (rows) · `GET /emails/:id` (row + decrypted body).
- **UI (CandidatePage Emails card):** type picker → declared-input form → Preview → Save →
  **Copy to clipboard** (navigator.clipboard; subject and body). List of previously generated
  emails (open/copy). **No send affordance of any kind — no `mailto:`, no send button.**
- No AI calls anywhere in Part A; works fully offline.

## 4. Part B — Key management (F8.2, D-17)

- First run: `key-provider.ts` generates 32 random bytes, wraps with
  `safeStorage.encryptString` (hex payload), writes `jobpin-data/.keys/master.key`. Every boot:
  unwrap → pass the raw `Buffer` into the server layer (`createApp`/services receive
  `dataKey?: Buffer` — the same seam pattern as `TokenIssuer`). The key never appears in logs,
  errors, or the renderer.
- The wrapped key lives **inside** `jobpin-data` so the folder remains the complete data set
  (D-21); it is DPAPI-bound, so a copied folder is unreadable off-machine — which is why
  backups carry their own passphrase (section 8). Backups **exclude** `.keys/`.
- `safeStorage.isEncryptionAvailable() === false` (rare on Windows): the app runs unencrypted
  with a persistent visible warning in the Settings Data-protection card — never silently.
- **Passphrase-upgrade seam (documented, not built):** only the *wrapping* of `master.key`
  changes (DPAPI blob → scrypt(passphrase) envelope, same `JPBK1` format as backups); DB, file
  layer, and services are wrapping-agnostic by construction.

## 5. Part B — Database encryption

- Swap to `better-sqlite3-multiple-ciphers` (SQLCipher-compatible fork, identical API).
  `openDatabase(file, key?)`: with a key, apply `PRAGMA hexkey = '<hex>'` immediately after
  open (exact pragma name verified against the package docs at implementation; `key`/`hexkey`
  both supported there). Without a key (tests, dev opt-out): plaintext, unchanged behaviour —
  the entire existing suite doubles as the drop-in proof.
- **Upgrade migration (one-time, intrinsic detection):** try keyed open → on
  `SQLITE_NOTADB`-class failure, open plaintext (header check `SQLite format 3`), then
  `PRAGMA hexrekey` to encrypt in place; log one line. A DB that is neither keyed-readable nor
  plaintext fails loudly (honesty-in-failure dialog).
- Production always keys (when safeStorage is available). WAL mode unchanged.

## 6. Part B — Candidate-file encryption

- `cryptx.ts`: `encryptBuffer(key, plain)` → `JPE1` magic + 12-byte IV + 16-byte GCM tag +
  ciphertext; `decryptBuffer`; `isEncrypted(buf)`. `deriveBackupKey(passphrase, salt)` via
  `crypto.scryptSync` (N=2^15, r=8, p=1).
- `candidate-fs.ts`: `readCandidateFile(deps, rel)` / `writeCandidateFile(deps, rel, data)` /
  `readCandidateFileText`. With `deps.dataKey`: write-encrypted, read-decrypted (passthrough
  for legacy plaintext during migration); without: passthrough. **Every** candidate-tree
  read/write site routes through it: `candidates.ts` (originals, `resume_text`,
  `profile.json`), `ai/persist.ts` (versioned outputs + `ai_analysis.json`), `analyze.ts` /
  `interview-ai.ts` / `ranking.ts` reads, `interviews.ts` (record mirror, summary md),
  `emails.ts`. Company/job files (`jd.md`, `learned_skills.md`, `question_bank.json`,
  templates) keep using plain fs — D-17's transparency line.
- **First-boot sweep** (`data-migrations.ts`): walk `jobs/*/candidates/*/`, encrypt any
  file failing `isEncrypted` — idempotent, crash-resumable by construction; progress logged;
  runs after the DB rekey, before the server starts serving.
- "Open folder" keeps working (folders/names visible; contents encrypted) — the Candidate page
  remains the readable view; this is the documented D-17 trade already in the PRD (section 7).

## 7. Part B — Deletion (F8.3 + the Phase 1-deferred job deletion)

- **Migration 0004:** `maintenance_flags(flag TEXT PRIMARY KEY)` + the four snapshot triggers
  rewritten (dropped/recreated), preserving invariant 11.1-5 for every normal path:
  - `rankings`/`ranking_items` UPDATE: abort **unless** flag `allow-reason-scrub` exists AND
    only `reason` changes (trigger `WHEN` compares OLD/NEW on all other columns).
  - `rankings`/`ranking_items` DELETE: abort **unless** flag `allow-snapshot-delete` exists.
  - Flags are inserted and deleted **inside the deletion transaction** — no window where other
    writers see them (single-connection SQLite).
- **`deleteCandidate(deps, id)`** — one transaction: scrub `ranking_items.reason` →
  `'[removed — candidate deleted]'` (flag-gated); purge `interview_answers`,
  `interview_questions`, `interviews`, `candidate_documents`, `ai_analyses`, `analysis_tasks`
  rows; null `usage_events.candidate_id`; scrub evidence quotes inside this candidate's
  `memory_events.content` (lesson text kept — it is approved job knowledge; quotes become
  `'[removed]'`); anonymise the `candidates` row (`name='Deleted candidate'`, email/phone
  NULL, `status='deleted'`); then remove the candidate folder (retry-wrapped). Snapshot ranks
  and scores survive; `learned_skills.md` is deliberately untouched (boss-approved content,
  boss-editable — documented).
- **`deleteJob(deps, id)`** — cascade: every candidate via the same path (skipping snapshot
  scrub), then flag-gated DELETE of the job's `ranking_items`/`rankings`, `emails` of its
  candidates, the `jobs` row, and the job folder.
- **UI:** Delete buttons on JobDetail and Candidate pages with **typed confirmation** (type the
  exact job/candidate name); deleting shows what will happen (incl. "ranking history keeps
  rank/score with the name removed").
- **REST:** `DELETE /candidates/:id`, `DELETE /jobs/:id` → 200 `{ deleted: true }`; 404s.

## 8. Part B — Backup & restore (F8.4)

- **Create** (`backup.ts`, driven by main via IPC with a save dialog):
  1. `db.backup(tempFile)` for a consistent snapshot (no close needed) — then **decrypt the
     snapshot in place** (open it keyed, `PRAGMA rekey` to empty): the archive must be fully
     portable, and a keyed DB copy would be bound to this machine's key.
  2. Assemble a zip (jszip): the plaintext DB snapshot + the full `jobpin-data` tree with
     candidate files **decrypted**, excluding `.keys/` and `jobpin.db*` live files.
  3. Format A (default): `jobpin-backup-<yyyymmdd-hhmm>.jpbak` = `JPBK1` + 16-byte salt +
     12-byte IV + 16-byte tag + AES-256-GCM(zip) under `deriveBackupKey(passphrase, salt)`.
     Passphrase entered twice; **loss warning shown at creation** ("this passphrase cannot be
     recovered; without it this backup is unreadable").
  4. Format B (behind an explicit "I understand candidate data will be unprotected" checkbox):
     plain `.zip`.
- **Restore** (Settings; works on a fresh install): pick file → passphrase if `.jpbak` →
  validate (magic/tag; wrong passphrase = clean "wrong passphrase or corrupt backup" error) →
  safety-rename current `jobpin-data` → `jobpin-data.pre-restore-<ts>` → extract plaintext →
  relaunch app → boot migrations re-encrypt under the local key (section 5/6 machinery,
  unchanged). The safety copy is left for the boss to delete manually (stated in the UI).
- Memory note: jszip assembles in memory — acceptable at MVP data sizes; recorded as a rider
  with a size guard (warn above ~500 MB).

## 9. Settings UI — Data protection card

Encryption status line ("On — key protected by your Windows account" / warning when
unavailable) · "Back up…" (format choice + passphrase fields + warnings → IPC save dialog →
progress → result path) · "Restore…" (IPC open dialog → typed confirmation "restore" +
passphrase → relaunch) · company identity fields (`company.name`, `company.sender_name`) used
by email templates.

## 10. Sequencing (one plan, Part A first)

Part A (tasks ~1–4): templates + manifest + scaffold seed → emails service → routes → UI.
Part B (tasks ~5–12): cryptx + candidate-fs seam (passthrough) → dependency swap + keyed
openDatabase + rekey → key-provider + main wiring + boot sweep → migration 0004 + deletion →
backup/restore + IPC → Settings/delete UI → final verification. Part A lands before any
encryption so its email files are just another candidate-file client of the seam.

## 11. Testing (all offline; suite baseline 269)

| Test file | Covers |
|---|---|
| `tests/emails.test.ts` | manifest listing; each of the 6 types renders subject+body with variables; missing required input → ValidationError naming it; boss-broken template → ValidationError naming the file; save writes file (via seam) + row; ordinal filenames |
| `tests/cryptx.test.ts` | round-trip; tamper (flip a byte) → auth failure; isEncrypted; scrypt derivation deterministic per salt |
| `tests/candidate-fs.test.ts` | passthrough without key; encrypt/decrypt with key; legacy-plaintext read under a key (migration window); on-disk bytes carry `JPE1` |
| `tests/db-encryption.test.ts` | keyed open round-trip; plaintext DB auto-rekeyed once (file header changes); wrong key fails loudly; keyless behaviour unchanged |
| `tests/data-migrations.test.ts` | sweep encrypts a seeded plaintext candidate tree; idempotent second run; resumes after simulated partial run; company/job files untouched |
| `tests/migration-0004.test.ts` | flags table; gated scrub allowed in-tx; rank/score updates still abort with AND without the flag; deletes abort without the flag |
| `tests/deletion.test.ts` | candidate: folder gone, row anonymised, snapshot rank/score intact + reason scrubbed, interviews/docs/analyses purged, memory quotes scrubbed, usage nulled; job cascade incl. rankings; 404s; snapshot-mutation regression outside the gates |
| `tests/backup.test.ts` | encrypted round-trip (create → readBackup → byte-compare tree, .keys excluded, candidate files plaintext inside); wrong passphrase → clean error; plain-zip round-trip |
| `tests/email-routes.test.ts` + route extensions | the section 3 REST surface + DELETE endpoints |
| Existing 269 | must stay green on the cipher fork — the drop-in proof |

## 12. Out of scope

Passphrase key wrapping (seam documented) · onboarding/legal **documents** (post-MVP, D-19/F6.3)
· PDF/DOCX rendering · scheduled/automatic backups · cloud anything · key rotation UI · multi-
machine portability of the live folder (backups are the portability story).

## 13. Acceptance criteria

1. For a chosen candidate, each of the six email types renders with correct job/candidate/
   company variables from its boss-editable template, saves under `emails/` + an `emails` row,
   and copies to clipboard; the UI has **no send capability anywhere** (D-15); a template
   syntax error surfaces as a clear message naming the file.
2. Fresh install: `jobpin.db` is not readable as plaintext SQLite; candidate files on disk are
   `JPE1`-encrypted; `jd.md`/`learned_skills.md`/templates remain plain and boss-editable
   (D-17); the app behaves normally throughout.
3. Upgrade install: first boot encrypts the existing DB and candidate trees; an interrupted
   sweep resumes on next boot; second boot is a no-op.
4. Deleting a candidate (typed confirmation) removes their files and PII in one action; every
   historical snapshot still renders with rank/score intact and the reason scrubbed; deleting
   a job removes the job, its candidates, and its rankings.
5. Snapshot mutations outside the gated paths still abort (invariant 11.1-5 regression).
6. Backup (encrypted) → wipe `jobpin-data` → restore → relaunch: the full data set returns and
   is re-encrypted locally; a wrong passphrase gives a clean error; the plain-zip path exists
   only behind the explicit acknowledgement.
7. Everything in this phase works offline.
