# Phase 4+5 — Communications & Data Protection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Six boss-editable AU email templates rendering to the candidate folder with copy-to-clipboard (never send), then whole-DB + candidate-file encryption under a safeStorage-wrapped key, candidate/job deletion with anonymised snapshots, and passphrase-encrypted portable backup/restore.

**Architecture:** Part A: `templates/au/emails/` → scaffold seed → `emails.ts` + routes + UI. Part B: `cryptx.ts` + `candidate-fs.ts` seam → cipher-fork DB swap → `key-provider.ts` + boot sweep → migration 0004 + `deletion.ts` → `backup.ts` + IPC → Settings UI. Spec: `docs/superpowers/specs/2026-07-12-phase-4-5-communications-data-protection-design.md` (normative where silent).

**Tech Stack:** + `handlebars` (prod), `jszip` (promote to prod), `better-sqlite3` → `better-sqlite3-multiple-ciphers` (drop-in swap). Node `crypto` for AES-256-GCM/scrypt.

## Global Constraints

- **No network in tests.** No AI calls anywhere in this phase.
- Keys/passphrases NEVER in logs, error messages, or the renderer. `.keys/` excluded from backups.
- Existing **269 tests (31 files) must stay green after every task** — keyless behaviour is unchanged by design; the full suite is the cipher-fork drop-in proof after Task 7.
- All tests via `npm test` (NEVER `npx vitest`, D-23 — postinstall rebuild target changes to the fork in Task 7). `git diff` TEXT only. Never touch `.env`/`PRD.md`/`CLAUDE.md`.
- Relative forward-slash paths; `src/server/**` never imports Electron; typed errors mapped once.
- Destructive UI actions require typed confirmation. No send affordance of any kind (D-15).
- Email template types exactly: `online_invitation` · `onsite_invitation` · `reschedule` · `rejection` · `more_materials` · `onboarding`.
- Commit after every task with trailers:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` + `Claude-Session: https://claude.ai/code/session_01Y5PnkrHijpH82ARYPDDxq4`

---

### Task 1: AU email templates + manifest + scaffold seed

**Files:**
- Create: `templates/au/emails/manifest.json`, `templates/au/emails/online_invitation.hbs`, `onsite_invitation.hbs`, `reschedule.hbs`, `rejection.hbs`, `more_materials.hbs`, `onboarding.hbs`
- Modify: `src/server/scaffold.ts` (seed `company/email_templates/` from the bundled dir; idempotent, never overwrites existing files)
- Test: `tests/scaffold.test.ts` (extend) or a new `tests/email-templates-seed.test.ts`

**Interfaces:**
- Produces: `manifest.json` shape consumed by Task 2:
```json
[{ "type": "online_invitation", "label": "Online interview invitation", "file": "online_invitation.hbs",
   "subject": "Interview invitation — {{job_name}} at {{company_name}}",
   "inputs": [{ "key": "interview_datetime", "label": "Interview date & time", "kind": "datetime", "required": true },
              { "key": "meeting_link", "label": "Meeting link", "kind": "text", "required": true }] }, ...]
```
- Scaffold copies the whole dir to `<dataRoot>/company/email_templates/` file-by-file only when absent.
- Bundled-dir resolution: scaffold receives the source dir as a parameter (`ensureScaffold(paths, opts?)` gains `emailTemplatesSrc?: string`); the main process passes the packaged path (`join(app.getAppPath(), 'templates/au/emails')` dev; for the packaged build add `templates/au/emails` to electron-builder `extraResources` and resolve via `process.resourcesPath` — mirror how `resources/` is handled in electron-builder.yml). Tests pass the repo path directly.

- [ ] **Step 1: Failing tests** — seed test: fresh scaffold with `emailTemplatesSrc` → all 7 files exist under `company/email_templates/`; re-run after editing one file → boss edit preserved; manifest parses and every `file` it names exists; every template's `subject` and body compile under Handlebars (no syntax errors); required-input keys are non-empty strings.
- [ ] **Step 2: Run** — FAIL
- [ ] **Step 3: Implement.** Manifest inputs per type: `online_invitation`: interview_datetime (datetime, req) + meeting_link (text, req) · `onsite_invitation`: interview_datetime (req) + location (text, req) · `reschedule`: interview_datetime (req) + reason (text, optional) · `rejection`: none · `more_materials`: materials (multiline, optional) · `onboarding`: start_date (datetime, req) + location (text, optional). Template copy (write these verbatim; professional AU business English; variables `{{candidate_name}} {{job_name}} {{company_name}} {{sender_name}} {{today}}` + the type's inputs; each body 8–14 lines, greeting "Dear {{candidate_name}},", sign-off "Kind regards,\n{{sender_name}}\n{{company_name}}"). Example — `online_invitation.hbs`:

```
Dear {{candidate_name}},

Thank you for your application for the {{job_name}} position at {{company_name}}.

We were impressed with your background and would like to invite you to an online
interview.

Proposed time: {{interview_datetime}}
Meeting link: {{meeting_link}}

The interview should take around 45 minutes. If the proposed time does not suit,
please reply with a couple of alternatives and we will do our best to accommodate.

We look forward to speaking with you.

Kind regards,
{{sender_name}}
{{company_name}}
```

Write the other five in the same register: `onsite_invitation` (address line "Location: {{location}}", note about asking for the sender at reception); `reschedule` (apologise briefly, `{{#if reason}}Reason: {{reason}}{{/if}}`, propose `{{interview_datetime}}`, ask to confirm); `rejection` (thank, "we will not be progressing your application on this occasion", warm close, no feedback promises); `more_materials` (request documents, `{{#if materials}}Specifically: {{materials}}{{/if}}`, how to send them — "reply to this email"); `onboarding` (congratulate on accepting, "your first day is {{start_date}}"`{{#if location}}` at `{{location}}{{/if}}`, what to bring: photo ID, bank and super details, TFN declaration — standard AU onboarding items, plainly phrased).

- [ ] **Step 4: Full `npm test` + `npm run typecheck` green (baseline 269 + new)**
- [ ] **Step 5: Commit** — `feat: AU email templates, manifest, and scaffold seeding`

---

### Task 2: Email service (`emails.ts`)

**Files:**
- Create: `src/server/emails.ts`
- Modify: `package.json` (+`handlebars` prod dep — run `npm install handlebars`)
- Test: `tests/emails.test.ts`

**Interfaces (produces, for Tasks 3/4; Task 6 later reroutes the file write through candidate-fs):**

```ts
export interface EmailDeps { db: DB; paths: JobpinPaths }
export interface TemplateInfo { type: string; label: string; subject: string; inputs: { key: string; label: string; kind: string; required: boolean }[] }
export function listTemplates(deps): TemplateInfo[]                    // reads company/email_templates/manifest.json
export function renderEmail(deps, candidateId: number, type: string, inputs: Record<string, string>): { subject: string; body: string }
export function saveEmail(deps, candidateId: number, type: string, inputs: Record<string, string>): { id: number; filePath: string; subject: string; body: string }
export function listEmails(deps, candidateId): { id; type; filePath; createdAt }[]
export function getEmail(deps, emailId): { id; type; createdAt; content: string }  // content = subject line + blank + body as stored
```

Behaviour contract:
- Variables: `candidate_name` (candidates.name), `job_name` (jobs.name via candidate), `company_name` / `sender_name` (settings keys `company.name` / `company.sender_name`, '' when unset), `today` (`new Intl.DateTimeFormat('en-AU', { dateStyle: 'long' }).format(new Date())`), plus the type's inputs verbatim.
- Guards: candidate 404; unknown type → `ValidationError('unknown email template type "<type>"')`; missing required input → `ValidationError('missing required input: <label>')`; Handlebars compile/render error → `ValidationError('template <file> failed to render: <message>')` (never a crash; message NEVER includes variable values beyond Handlebars' own text).
- Rendering: compile per call (boss may have just edited the file); `noEscape: true` (plain-text emails, no HTML entities).
- `saveEmail` writes `jobs/<f>/candidates/candidate_<id>/emails/<type>-<n>.md` (n = 1 + count of existing rows of that type for the candidate) with content `Subject: <subject>\n\n<body>`, then inserts the `emails` row (candidate_id, type, file_path) — file write via plain fs helpers for now (Task 6 reroutes), row + write mirroring the established write-order discipline.

- [ ] **Step 1: Failing tests** — setup mirrors tests/interviews.test.ts (temp dir + scaffold WITH `emailTemplatesSrc` pointing at the repo templates + migrations + createJob + addCandidateFromText; set settings keys directly via SQL):
  1. `listTemplates` returns 6 entries matching the manifest.
  2. Each of the six types renders: subject + body contain candidate/job/company/sender values and the supplied inputs (table-driven over all 6 with per-type inputs).
  3. Missing required input (online_invitation without meeting_link) → ValidationError naming the label; unknown type → ValidationError.
  4. Boss-broken template (overwrite `rejection.hbs` with `{{#if}}` garbage) → ValidationError naming the file.
  5. Unset company settings render as empty strings (no error, no 'undefined').
  6. `saveEmail` → file exists with `Subject:` header; row inserted; second save of same type → `-2` ordinal; `listEmails`/`getEmail` round-trip.
- [ ] **Step 2: Run** — FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Full suite + typecheck green**
- [ ] **Step 5: Commit** — `feat: email rendering service over boss-editable Handlebars templates`

---

### Task 3: Email + company-settings routes

**Files:**
- Create: `src/server/email-routes.ts` (or extend `src/server/routes.ts` — follow the file-size judgment of the codebase; new file preferred, mounted from `createApp` unconditionally: no AI dependency)
- Modify: `src/server/app.ts` (mount), `src/server/ai/routes.ts` ONLY if reusing its settings helpers is cleaner
- Test: `tests/email-routes.test.ts`

**Surface:**

| Route | Success | Errors |
|---|---|---|
| `GET /email-templates` | `200 TemplateInfo[]` | — |
| `POST /candidates/:id/emails` `{ type, inputs, save }` | `200 {subject, body}` (preview) / `201 {id, filePath, subject, body}` (save) | `400` (strict JSON + validation) · `404` |
| `GET /candidates/:id/emails` | `200` rows | `404` |
| `GET /emails/:id` | `200 {id, type, createdAt, content}` | `404` |
| `GET /company-settings` | `200 {name, senderName}` | — |
| `PUT /company-settings` `{ name?, senderName? }` | `200` updated | `400` strict JSON |

Strict-JSON body parsing (the established `parseJsonBody` pattern — reuse/extract, don't triplicate). Company settings persist to the `settings` table keys `company.name` / `company.sender_name` (upsert like `setAiSettings`).

- [ ] **Step 1: Failing tests** — via `app.request` (no AI runtime needed): full surface incl. preview-vs-save semantics, 404s, malformed JSON → 400, settings round-trip feeding a subsequent render.
- [ ] **Step 2: Run** — FAIL
- [ ] **Step 3: Implement (thin handlers → emails.ts)**
- [ ] **Step 4: Full suite + typecheck green**
- [ ] **Step 5: Commit** — `feat: email + company-settings REST surface`

---

### Task 4: Emails UI + company identity fields

**Files:**
- Modify: `src/renderer/src/pages/CandidatePage.tsx` (Emails card), `src/renderer/src/pages/SettingsPage.tsx` (company identity fields)
- Test: none (owner walk); typecheck gate

**Requirements:**
- CandidatePage **Emails card** (below Interviews): type picker (labels from `GET /email-templates`) → declared-input form (datetime → `datetime-local` input rendered to a readable string, text/multiline accordingly; required marked) → **Preview** (POST save:false; shows subject + body in a `<pre>`-style block) → **Save** (POST save:true; refreshes list) → **Copy** button (`navigator.clipboard.writeText` of `Subject: ...\n\n<body>`; "Copied" confirmation state). List of saved emails (type · date) with view (GET /emails/:id) + copy. Errors render inline (template errors name the file). **No mailto:, no send.**
- SettingsPage: "Company identity" card — `Company name` + `Sender name` text fields, saved via `PUT /company-settings` on blur with a saved indicator; caption "used in email templates".
- Tokens-only styling; match existing card/form patterns.
- [ ] **Step 1-2: Implement both.** **Step 3: Verify** — typecheck + full suite green; `npm run dev` smoke on a synthetic candidate: set company fields, preview + save an online invitation, copy it, view it again from the list; confirm the file exists under the candidate's `emails/` folder; owner's real jobs untouched; close the app.
- [ ] **Step 4: Commit** — `feat: email generation UI + company identity settings`

---

### Task 5: Crypto primitives (`cryptx.ts`)

**Files:**
- Create: `src/server/cryptx.ts`
- Test: `tests/cryptx.test.ts`

**Interfaces (produces, for Tasks 6/8/11):**

```ts
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'

export const FILE_MAGIC = Buffer.from('JPE1')      // candidate-file envelope
export const BACKUP_MAGIC = Buffer.from('JPBK1')   // backup envelope (Task 11)

export function encryptBuffer(key: Buffer, plain: Buffer): Buffer
// layout: JPE1 | iv(12) | tag(16) | ciphertext  — AES-256-GCM
export function decryptBuffer(key: Buffer, blob: Buffer): Buffer
// throws Error('not an encrypted file') on bad magic; GCM auth failure propagates
export function isEncrypted(buf: Buffer): boolean  // magic check, length-safe
export function deriveBackupKey(passphrase: string, salt: Buffer): Buffer
// scryptSync(passphrase, salt, 32, { N: 2**15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
```

- [ ] **Step 1: Failing tests**
  1. round-trip: random 32B key, utf8 + binary payloads, empty buffer.
  2. output starts with JPE1; `isEncrypted` true for output, false for plain text, false for a 2-byte buffer.
  3. tamper: flip one ciphertext byte → decrypt throws; flip a tag byte → throws; wrong key → throws.
  4. `deriveBackupKey` deterministic for same (passphrase, salt); differs across salts; 32 bytes.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** (complete module, ~50 lines, code per the layout above; iv = randomBytes(12); tag from `cipher.getAuthTag()`).
- [ ] **Step 4: Full suite + typecheck green. Step 5: Commit** — `feat: AES-256-GCM crypto primitives for candidate files and backups`

---

### Task 6: Candidate-file seam (`candidate-fs.ts`) + reroute all candidate-tree I/O

**Files:**
- Create: `src/server/candidate-fs.ts`
- Modify: `src/server/candidates.ts`, `src/server/ai/persist.ts`, `src/server/ai/analyze.ts`, `src/server/ai/interview-ai.ts`, `src/server/ranking.ts`, `src/server/interviews.ts`, `src/server/emails.ts` (every candidate-tree read/write goes through the seam), plus their deps types (`dataKey?: Buffer` added to the service deps objects and threaded from `createApp`/routes)
- Modify: `src/server/app.ts` (`AppDeps` gains `dataKey?: Buffer`; passed into route registrations)
- Test: `tests/candidate-fs.test.ts` + ONE new keyed integration test file `tests/encryption-integration.test.ts`

**Interfaces:**

```ts
export interface CandidateFsDeps { paths: JobpinPaths; dataKey?: Buffer }
export function writeCandidateFile(deps, rel: string, data: Buffer | string): void  // mkdir -p; encrypt when key present
export function readCandidateFile(deps, rel: string): Buffer
// key present + JPE1 → decrypt; key present + NOT JPE1 → passthrough (legacy window during sweep);
// no key + JPE1 → throw Error('file is encrypted but no data key is available')
export function readCandidateFileText(deps, rel: string): string
export function existsCandidateFile(deps, rel: string): boolean
```

Rules:
- Company/job files (jd, inject, references, learned_skills, question_bank, email TEMPLATES) keep plain fs — do NOT reroute those.
- KEYLESS behaviour must be byte-identical to today: the existing 269+ tests run unchanged and prove it.
- The reroute is mechanical: every `readFileSync`/`writeFileSync`/`existsSync` whose path is under `candidates/candidate_<id>/` switches to the seam; each service's deps gains optional `dataKey` and passes it through. `getCandidate`'s extracted-text read, extraction original writes, profile.json, versioned analyses + ai_analysis.json, interview record/summary, email files — all of it.
- `tests/encryption-integration.test.ts` (keyed, end-to-end at service level): with `dataKey` set — addCandidateFromText → on-disk `resume_text.md` + `profile.json` bytes start with JPE1 while `jd.md` stays plain; getCandidate returns the decrypted text; analyze (mock gateway) round-trips; saveEmail file encrypted; interview record mirror encrypted; a legacy plaintext file dropped into the tree is still readable (passthrough).

- [ ] **Step 1: Failing tests** (candidate-fs unit + the integration file)
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** (seam first, then the mechanical reroute service by service, running the suite after each).
- [ ] **Step 4: FULL suite + typecheck green (this task touches the most files — zero regressions tolerated).**
- [ ] **Step 5: Commit** — `feat: candidate-file encryption seam routed through all candidate-tree I/O`

---

### Task 7: Database encryption (cipher-fork swap + keyed open + auto-rekey)

**Files:**
- Modify: `package.json` (remove `better-sqlite3`, add `better-sqlite3-multiple-ciphers`; update the `postinstall` script's rebuild target `electron-rebuild -f -w better-sqlite3-multiple-ciphers`), run `npm install`
- Modify: `src/server/db.ts` (`openDatabase(dbFile, key?: Buffer)`), `src/main/index.ts` (pass the key — Task 8 wires the real provider; until then main passes `undefined`, behaviour unchanged)
- Test: `tests/db-encryption.test.ts`

**`openDatabase` contract:**

```ts
export function openDatabase(dbFile: string, key?: Buffer): DB {
  const db = new Database(dbFile)
  if (key) {
    db.pragma(`hexkey = '${key.toString('hex')}'`)       // must be the FIRST statement
    try { db.prepare('SELECT count(*) FROM sqlite_master').get() }
    catch {
      db.close()
      // plaintext? (header check) -> one-time in-place encryption
      const header = readFileSync(dbFile).subarray(0, 16).toString('latin1')
      if (!header.startsWith('SQLite format 3')) throw new Error('database is neither readable with the data key nor plaintext - refusing to touch it')
      const plain = new Database(dbFile)
      plain.pragma(`hexrekey = '${key.toString('hex')}'`)
      plain.close()
      return openDatabase(dbFile, key)                    // reopen keyed
    }
  }
  // existing pragmas: WAL, foreign_keys, busy_timeout (AFTER the key)
  ...
}
```

(Verify the exact pragma names `hexkey`/`hexrekey` against the installed package's README at implementation; adjust if it exposes `key`/`rekey` with hex quoting instead. Handle the missing-file case: a NEW db with a key needs no rekey path.)

- [ ] **Step 1: Failing tests**
  1. new keyed DB: create with key → migrations run → reopen with key → data present; raw file does NOT start with 'SQLite format 3'.
  2. plaintext upgrade: create keyless + write a row → reopen WITH key → auto-rekey → row present; file header now encrypted; third open (keyed) is a plain success (no re-rekey).
  3. wrong key → loud error (not silent empty DB).
  4. keyless behaviour unchanged (open, migrate, WAL pragma still applied).
- [ ] **Step 2: Run** — FAIL (package not swapped yet). **Step 3: Implement** — swap the dependency FIRST (`npm uninstall better-sqlite3 && npm install better-sqlite3-multiple-ciphers`, postinstall edit, verify `npm test` still green BEFORE touching db.ts: that is the drop-in proof commit point), then the keyed logic.
- [ ] **Step 4: FULL suite + typecheck green. Also `npm run dev` boots (implementer smoke: window + /health).**
- [ ] **Step 5: Commit** — `feat: whole-database encryption via better-sqlite3-multiple-ciphers with one-time auto-rekey`

---

### Task 8: Key provider + boot wiring + candidate-file sweep

**Files:**
- Create: `src/main/key-provider.ts`, `src/server/data-migrations.ts`
- Modify: `src/main/index.ts` (boot order: key → openDatabase(key) → runMigrations → sweepCandidateFiles → server; safeStorage-unavailable path), `src/server/app.ts` (thread `dataKey` — from Task 6 the plumbing exists)
- Test: `tests/data-migrations.test.ts` (the sweep; key-provider is main-process — covered by the owner walk + a pure-function unit for its wrap format helpers if extracted)

**`key-provider.ts` contract:**

```ts
import { safeStorage } from 'electron'
export function getOrCreateDataKey(dataRoot: string): Buffer | null
// null when safeStorage.isEncryptionAvailable() === false (caller shows the persistent warning)
// else: read <dataRoot>/.keys/master.key (base64 of safeStorage-encrypted hex) -> decrypt -> Buffer
// missing: generate randomBytes(32), wrap via safeStorage.encryptString(hex), mkdir .keys, write, return
```

**`data-migrations.ts` contract:**

```ts
export function sweepCandidateFiles(deps: { db: DB; paths: JobpinPaths; dataKey: Buffer }): { encrypted: number; skipped: number }
// walk jobs/*/candidates/candidate_*/ recursively; for each FILE: isEncrypted ? skipped++ : rewrite via encryptBuffer; idempotent by construction
```

Boot order in main: `getOrCreateDataKey` → `openDatabase(dbFile, key ?? undefined)` → `runMigrations` → `if (key) sweepCandidateFiles(...)` (log one summary line) → createApp({..., dataKey: key ?? undefined}) → serve. safeStorage-unavailable: proceed keyless + expose the state via `/health` (`encryption: 'on' | 'unavailable'`) for the Settings card. `.keys/` must be excluded from any directory walks (scaffold marker checks etc. — verify none trip on it).

- [ ] **Step 1: Failing tests (sweep):** seed a keyless data dir with a job + 2 candidates (files plaintext) → sweep with a key → all candidate-tree files JPE1, jd.md untouched, counts right; second run → all skipped; simulated partial run (pre-encrypt one file) → resumes correctly; services read the swept files fine with the key (getCandidate round-trip).
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.**
- [ ] **Step 4: Full suite + typecheck; `npm run dev` smoke — REAL data dir now encrypts on boot: verify with the OWNER'S CONSENT DEFERRED — use an ISOLATED JOBPIN_DATA_DIR for the smoke (seed a synthetic job/candidate keyless, boot, verify JPE1 on disk + /health encryption:on + app usable). NEVER run the sweep against the owner's real jobpin-data during implementation.**
- [ ] **Step 5: Commit** — `feat: safeStorage-wrapped data key + first-boot candidate-file encryption sweep`

---

### Task 9: Migration 0004 — maintenance flags + gated snapshot triggers

**Files:**
- Create: `src/server/migrations/0004_snapshot_maintenance.ts`
- Modify: `src/server/migrations/index.ts` (+ the hardcoded schemaVersion/trigger assertions in existing tests — sanctioned, same as every migration task)
- Test: `tests/migration-0004.test.ts`

**SQL (verbatim):**

```sql
CREATE TABLE maintenance_flags (flag TEXT PRIMARY KEY);

DROP TRIGGER trg_rankings_immutable_update;
DROP TRIGGER trg_rankings_immutable_delete;
DROP TRIGGER trg_ranking_items_immutable_update;
DROP TRIGGER trg_ranking_items_immutable_delete;

CREATE TRIGGER trg_rankings_immutable_update BEFORE UPDATE ON rankings
BEGIN SELECT RAISE(ABORT, 'ranking snapshots are immutable'); END;

CREATE TRIGGER trg_rankings_immutable_delete BEFORE DELETE ON rankings
WHEN NOT EXISTS (SELECT 1 FROM maintenance_flags WHERE flag = 'allow-snapshot-delete')
BEGIN SELECT RAISE(ABORT, 'ranking snapshots are immutable'); END;

CREATE TRIGGER trg_ranking_items_immutable_update BEFORE UPDATE ON ranking_items
WHEN NOT (EXISTS (SELECT 1 FROM maintenance_flags WHERE flag = 'allow-reason-scrub')
  AND NEW.ranking_id = OLD.ranking_id AND NEW.candidate_id = OLD.candidate_id
  AND NEW.rank = OLD.rank AND NEW.score = OLD.score)
BEGIN SELECT RAISE(ABORT, 'ranking snapshots are immutable'); END;

CREATE TRIGGER trg_ranking_items_immutable_delete BEFORE DELETE ON ranking_items
WHEN NOT EXISTS (SELECT 1 FROM maintenance_flags WHERE flag = 'allow-snapshot-delete')
BEGIN SELECT RAISE(ABORT, 'ranking snapshots are immutable'); END;
```

- [ ] **Step 1: Failing tests**
  1. applies over 0001–0003 → version 4; flags table exists; all four triggers exist.
  2. WITHOUT flags: UPDATE rankings.reason aborts; UPDATE ranking_items.reason aborts; DELETE either aborts (the 11.1-5 regression, same assertions as tests/ranking.test.ts's immutability case).
  3. WITH `allow-reason-scrub`: reason-only UPDATE on ranking_items succeeds; changing score in the same statement still aborts; UPDATE on rankings still aborts regardless.
  4. WITH `allow-snapshot-delete`: DELETE ranking_items + rankings succeed; without → abort (flag removed).
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Full suite + typecheck green.**
- [ ] **Step 5: Commit** — `feat: migration 0004 - flag-gated snapshot maintenance paths`

---

### Task 10: Deletion service (`deletion.ts`)

**Files:**
- Create: `src/server/deletion.ts`
- Test: `tests/deletion.test.ts`

**Interfaces (for Task 12 routes):**

```ts
export interface DeletionDeps { db: DB; paths: JobpinPaths; dataKey?: Buffer }
export function deleteCandidate(deps, candidateId: number): void   // 404 unknown
export function deleteJob(deps, jobId: number): void               // 404 unknown; cascades candidates
```

`deleteCandidate` — ONE `db.transaction`:
1. Resolve candidate + job (folder path); 404 if unknown.
2. `INSERT INTO maintenance_flags VALUES ('allow-reason-scrub')`.
3. `UPDATE ranking_items SET reason = '[removed - candidate deleted]' WHERE candidate_id = ?` (rank/score untouched → passes the gated trigger).
4. Purge child rows: `interview_answers` (via its interviews→questions), `interview_questions`, `interviews`, `candidate_documents`, `ai_analyses`, `analysis_tasks` WHERE candidate_id = ?; scrub `memory_events` for this candidate's interviews — set evidence quotes in `content` JSON to '[removed]', keep lesson (read-modify-write each row; match via source_id ∈ this candidate's interview ids).
5. `UPDATE candidates SET name='Deleted candidate', email=NULL, phone=NULL, status='deleted' WHERE id=?`.
6. `DELETE FROM maintenance_flags WHERE flag='allow-reason-scrub'`.
Then AFTER the tx commits: remove the candidate folder via rmrfWithRetry (fs outside the tx — a folder-removal failure must not roll back the committed anonymisation; log and rethrow so the UI shows it, DB already consistent). Order matters: DB anonymised first (the durable record), folder second.

`deleteJob` — ONE `db.transaction`:
1. Resolve job; 404.
2. For each candidate of the job: steps 3-5 above WITHOUT the snapshot scrub (the whole snapshot is about to go) — purge child rows + (no need to anonymise rows we're deleting).
3. `INSERT INTO maintenance_flags VALUES ('allow-snapshot-delete')`.
4. `DELETE FROM ranking_items WHERE ranking_id IN (SELECT id FROM rankings WHERE job_id=?)`; `DELETE FROM rankings WHERE job_id=?`.
5. `DELETE FROM emails WHERE candidate_id IN (...job's candidates...)`; `DELETE FROM candidates WHERE job_id=?`; `DELETE FROM jobs WHERE id=?`.
6. `DELETE FROM maintenance_flags WHERE flag='allow-snapshot-delete'`.
Then remove the job folder (rmrfWithRetry) after commit.
NOTE: `learned_skills.md` lives in the job folder → gone with deleteJob (correct); deleteCandidate leaves it (documented — approved job knowledge).

- [ ] **Step 1: Failing tests** (seed a job, 2 candidates, an interview_summary + a ranking snapshot with both candidates via direct inserts + the ranking service, an email, memory_events with quotes):
  1. deleteCandidate: folder gone; candidates row name='Deleted candidate', email/phone NULL, status 'deleted'; ranking_items for them keep rank+score, reason scrubbed; the OTHER candidate's ranking_items untouched; interviews/questions/answers/documents/ai_analyses rows gone; memory_events lesson kept + quotes '[removed]'; the flag is NOT left in maintenance_flags afterward.
  2. after deleteCandidate, a NEW plain `UPDATE ranking_items SET score=...` STILL aborts (flag cleaned up → 11.1-5 regression holds).
  3. deleteJob: job/candidates/rankings/ranking_items/emails all gone; job folder gone; flag cleaned up; a second job's data untouched.
  4. 404s for unknown ids.
  5. keyless AND keyed deps both work (folder removal + row ops independent of encryption).
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Full suite + typecheck green.**
- [ ] **Step 5: Commit** — `feat: candidate anonymisation + job cascade deletion behind gated snapshot triggers`

---

### Task 11: Backup / restore (`backup.ts`) + IPC

**Files:**
- Create: `src/server/backup.ts`
- Modify: `src/main/index.ts` + `src/main/ipc.ts` (backup/restore IPC with dialogs, passphrase payloads, relaunch), `src/preload/*` (expose `backup`/`restore` on the bridge)
- Test: `tests/backup.test.ts` (the Electron-free create/read round-trip; IPC + dialogs are owner-walk)

**Interfaces (Electron-free core):**

```ts
export interface BackupDeps { db: DB; paths: JobpinPaths; dataKey?: Buffer }
export function createBackup(deps, outFile: string, opts: { passphrase?: string }): { path: string; encrypted: boolean }
// passphrase present -> .jpbak (JPBK1 | salt(16) | iv(12) | tag(16) | AES-256-GCM(zip)); absent -> plain .zip
export function readBackup(inFile: string, opts: { passphrase?: string }): Buffer  // returns the plaintext zip bytes; throws 'wrong passphrase or corrupt backup' on GCM failure/bad magic
export function extractBackupTo(zipBytes: Buffer, destDir: string): void           // unzip into a fresh dir
```

`createBackup` steps (per spec section 8, with the self-review fix):
1. `db.backup(tmpDbPath)` (consistent snapshot).
2. If `deps.dataKey`: open `tmpDbPath` keyed, `PRAGMA rekey = ''` (or `hexrekey` to empty per the package API) → plaintext portable DB; close.
3. jszip: add the plaintext DB as `jobpin.db`; walk `paths.dataRoot` adding every file EXCEPT `.keys/**`, `jobpin.db*` (live), `*.pre-restore-*`; for candidate-tree files with a key → `decryptBuffer` before adding (store plaintext in the archive); company/job files added as-is.
4. Serialize zip → if passphrase: salt=randomBytes(16), key=deriveBackupKey(passphrase,salt), AES-256-GCM → `JPBK1|salt|iv|tag|ct` to `outFile`; else write the zip bytes to `outFile`.

`readBackup`: sniff magic — `JPBK1` → require passphrase, derive, decrypt (GCM failure → clean error); PK zip magic → passthrough. Return zip bytes.

- [ ] **Step 1: Failing tests**
  1. encrypted round-trip: keyed deps + seeded data (a candidate with an encrypted resume_text) → createBackup(pass) → readBackup(pass) → extract → the archived `jobpin.db` opens as PLAINTEXT (header 'SQLite format 3') and the archived candidate file is PLAINTEXT (no JPE1) and byte-equals the original decrypted content; `.keys/` absent from the archive.
  2. wrong passphrase → 'wrong passphrase or corrupt backup'; corrupt bytes → same.
  3. plain-zip path (no passphrase): archive is a readable zip; candidate files plaintext inside.
  4. keyless deps: backup of a keyless data dir works (files already plaintext).
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** the Electron-free core + wire IPC (main: save/open dialogs; restore safety-renames `jobpin-data` → `jobpin-data.pre-restore-<ts>`, extracts, `app.relaunch()`+`app.exit()`; preload bridge methods; NEVER log the passphrase).
- [ ] **Step 4: Full suite + typecheck green.**
- [ ] **Step 5: Commit** — `feat: portable encrypted backup + restore (plain-zip behind acknowledgement)`

---

### Task 12: Data-protection & delete UI + final verification + docs

**Files:**
- Modify: `src/renderer/src/pages/SettingsPage.tsx` (Data-protection card), `src/renderer/src/pages/JobDetailPage.tsx` + `CandidatePage.tsx` (delete buttons), `src/server/ai/routes.ts` or a routes file (DELETE endpoints), `README.md`
- Test: `tests/delete-routes.test.ts`; full suite + typecheck

**DELETE routes** (thin → deletion.ts, typed 404s): `DELETE /candidates/:id` → 200 `{deleted:true}`; `DELETE /jobs/:id` → 200. Mounted where the other job/candidate routes live; `dataKey` threaded.

**Settings Data-protection card:** encryption status from `/health` (`encryption: on` → "On — protected by your Windows account"; `unavailable` → amber warning); **Back up…** (format radio: encrypted default / plain behind an "I understand candidate data will be unprotected" checkbox; passphrase + confirm fields for encrypted, with the loss warning) → `window.jobpin.backup(...)` → result path or error; **Restore…** → file pick → passphrase if needed → typed "restore" confirm → `window.jobpin.restore(...)` (relaunches). Company identity fields already added in Task 4 stay.

**Delete UI:** JobDetail + Candidate pages get a Delete button (danger styling via tokens) → modal requiring the exact typed name → DELETE call → navigate away on success; the modal states what's removed ("ranking history keeps rank & score with the name removed"; job delete: "removes the job, all its candidates, and all its ranking history").

**Final verification:** full `npm test` (expect ~305+, 0 fail — NAME any flake), `npm run typecheck`, `git diff --stat <branch-base>..HEAD` text-only. **README:** new "Data protection (Phase 5)" subsection (encryption on by default via the OS account; backup/restore with the passphrase-loss warning; deletion semantics) + extend the AI-features/emails note ("Emails (Phase 4): generate copy-to-clipboard templates, never sent").

- [ ] **Step 1: DELETE routes + test. Step 2: Settings card. Step 3: delete UI. Step 4: README.**
- [ ] **Step 5: Verify** — full suite + typecheck; `npm run dev` smoke on an ISOLATED data dir: generate+copy an email, encryption status shows On, create an encrypted backup to a temp path, delete a candidate (snapshot keeps rank/score), delete a job; record results. NEVER back up/restore/delete against the owner's real jobpin-data.
- [ ] **Step 6: Commit** — `feat: data-protection settings, delete UI, DELETE routes + Phase 4-5 docs`
