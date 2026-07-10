# Phase 1 — Job Workspace & Candidate Intake: Design Spec

> Companion: PRD sections 5–6, 8, 10 · CONTEXT.md (terms) · DECISIONS.md (D-17, D-21, D-22) | v1.0 · 2026-07-10
> Builds on the Phase 0 foundation spec (`2026-07-10-phase-0-desktop-foundation-design.md`); Phase 0's
> module boundaries (`src/server/` never imports Electron; relative `*_path` convention) are load-bearing here.

**Date:** 2026-07-10
**Status:** Approved (owner, 2026-07-10)
**Source requirements:** `PRD.md` section 10 Phase 1 (minutes tasks 4–6); F1.1–F1.4, F2.1–F2.2, F2.4
**Owner decisions this session:** solid-foundation UI (app shell now, Phase 1 screens only) · job **rename** included, delete stays Phase 5 (D-17)

## 1. Summary

The boss can create a job (name + JD), get candidates into it (file upload or pasted text, with
text extraction), rename a job safely, and browse an unranked candidate list — all through the
app's first real UI (routed app shell). No AI, no ranking, no schema changes. Everything follows
the Phase 0 patterns: file-first with the DB as index, relative paths, honesty-in-failure,
renderer → HTTP → Hono only.

## 2. Server modules (all Electron-free, in `src/server/`)

| Module | Responsibility | Key exports |
|---|---|---|
| `naming.ts` | Pure job-folder-name derivation | `deriveFolderName(displayName: string, existingFolderNames: string[]): string` |
| `jobs.ts` | Job service: create/list/get/rename + folder scaffold | `createJob`, `listJobs`, `getJob`, `renameJob`, `setJd` |
| `candidates.ts` | Candidate service: add (file/text), list, get | `addCandidateFromFile`, `addCandidateFromText`, `listCandidates`, `getCandidate` |
| `extract.ts` | Text extraction; **never throws** | `extractText(bytes: Uint8Array, ext: string): Promise<{ text: string } \| { error: string }>` |
| `routes.ts` (new) | Mounts Phase 1 REST routes onto the Hono app factory | `registerJobRoutes(app, deps)` |

Services take `{ db, paths }` deps (same dependency-injection shape as Phase 0's `createApp`),
so all are unit-testable against temp dirs.

### 2.1 `naming.ts` rules

- Keep unicode (Chinese job names are first-class).
- Strip Windows-illegal characters ``< > : " / \ | ? *`` and control chars; collapse whitespace;
  trim leading/trailing dots and spaces.
- Guard reserved device names (`CON`, `PRN`, `AUX`, `NUL`, `COM1–9`, `LPT1–9`, case-insensitive)
  by suffixing `_`.
- Empty result after sanitization → `job`.
- Case-insensitive collision against existing folder names → append ` (2)`, ` (3)`, …
- Max folder-name length 80 chars (truncate before collision-suffixing).

Display name (DB `jobs.name`, UNIQUE) is never altered; only the folder name is derived.

## 3. REST API (mounted on the existing Hono app)

| Route | Request | Success | Errors |
|---|---|---|---|
| `POST /jobs` | JSON `{ name: string, jd?: string }` | `201 {job}` | `400` empty name · `409` name exists |
| `GET /jobs` | — | `200 [{id, name, candidateCount, createdAt}]` (note: `jobs` has no status column) | — |
| `GET /jobs/:id` | — | `200 {id, name, folderPath, jd: string \| null, createdAt}` (jd read from `jd.md`) | `404` |
| `PATCH /jobs/:id` | JSON `{ name }` | `200 {job}` (rename, section 5) | `400` · `404` · `409` name exists |
| `PUT /jobs/:id/jd` | JSON `{ text }` **or** multipart `file` | `200 {jd}` — writes `jd.md` (files go through extraction first) | `400` · `404` · `413` >20 MB · `422` extraction failed |
| `POST /jobs/:id/candidates` | multipart `file` (+ optional `name`) **or** JSON `{ name, text }` | `201 {candidate}` | `400` (paste without name / no file) · `404` · `413` >20 MB |
| `GET /jobs/:id/candidates` | — | `200 [{id, name, status, createdAt}]` | `404` |
| `GET /candidates/:id` | — | `200 {id, jobId, name, email, phone, status, extractedText: string \| null, extraction: {status, error?}, originalFilename?, folderPath}` | `404` |

Multipart via `c.req.parseBody()`. Upload cap **20 MB** → `413`. All handlers wrap service calls;
services throw typed errors (`NotFound`, `Conflict`, `ValidationError`) mapped to status codes in
one error-mapping middleware.

## 4. Folder contract (file-first; PRD section 8.2)

`createJob` writes the full skeleton:

```
jobs/<derivedFolderName>/
  jd.md                    (provided JD text, or empty if none yet)
  inject.md                (empty)
  references/
    interview_rules.md     (empty)
    legal_notes.md         (empty)
    company_context.md     (empty)
  question_bank.json       {"questions": []}
  learned_skills.md        (empty)
  candidates/
```

DB row: `jobs(name, folder_path='jobs/<folder>', jd_path='jobs/<folder>/jd.md',
inject_path='jobs/<folder>/inject.md')` — relative paths always.

`addCandidate*` writes:

```
.../candidates/candidate_<id>/
  resume.<original-ext>    (upload: original bytes, contract-stable filename)
  resume.md                (paste: the pasted text as the "original")
  resume_text.md           (extracted text — only on success)
  profile.json             (metadata with no DB column — see below)
```

`profile.json` (initial shape):

```json
{
  "name": "...", "email": null, "phone": null,
  "source": "upload" | "paste",
  "originalFilename": "Jane Doe CV.pdf",
  "extraction": { "status": "ok" | "failed", "error": "..." },
  "createdAt": "ISO-8601"
}
```

DB rows: `candidates(job_id, name, email?, phone?, status)` +
`candidate_documents(candidate_id, type='resume', file_path, extracted_text_path?)`.
The DB id is created first (transaction), then the folder `candidate_<id>` — on any fs failure the
transaction rolls back and partial folders are removed.

**Candidate naming:** upload → optional `name` field, defaulting to the filename stem; paste →
`name` required (400 without it).

## 5. Rename algorithm (transactional)

1. Validate new display name (400 empty; 409 if another job has it, case-sensitive per UNIQUE).
2. Derive new folder name via `naming.ts` (collision-checked against existing folders).
3. `fs.renameSync(oldFolder, newFolder)` — atomic on the same volume.
4. One DB transaction: update `jobs.name/folder_path/jd_path/inject_path`, then a **generic
   prefix-rewrite helper** updates every known path column (`candidate_documents.file_path`,
   `.extracted_text_path`, and the currently-empty future columns: `interviews.transcript_path`,
   `.summary_path`, `ai_analyses.output_path`, `emails.file_path`, `documents.file_path`) where
   the value starts with the old folder prefix.
5. If the DB transaction fails → compensating `fs.renameSync` back, then rethrow.

If the folder name derived from the new display name equals the old one (e.g. case-only change),
skip the fs rename and just update `jobs.name`.

## 6. Extraction pipeline (`extract.ts`)

| Ext | Engine | Notes |
|---|---|---|
| `.pdf` | **unpdf** (pdf.js) | pure JS; empty/whitespace-only text → `error: "no extractable text (scanned document?)"` |
| `.docx` | **mammoth** | pure JS (raw text) |
| `.txt`, `.md` | `fs` (UTF-8) | — |
| anything else | — | `error: "unsupported file type <ext>"` |

Hard rule (post better-sqlite3 ABI lesson): **no native modules** in this pipeline.
On success: write `resume_text.md`, set `candidate_documents.extracted_text_path`, status `new`.
On any failure: status **`needs_review`**, reason in `profile.json.extraction.error`, original
preserved, no `resume_text.md`. Nothing throws out of `extractText`.

**Status vocabulary (Phase 1):** `new` · `needs_review` only. The fuller lifecycle
(invited/interviewing/…) is deliberately deferred to Phases 2–3, added by migration then.
**No schema changes in Phase 1** — migration 0001 already covers everything (and production
exercises the runner's no-op path).

## 7. UI — solid foundation

**New deps:** `react-router-dom` (devDependency; Vite bundles it). Design tokens as CSS variables
in `src/renderer/src/styles/tokens.css` (spacing scale, type scale, semantic colors, radii) —
layout/visual work at implementation follows the frontend-design skill's guidance.

**Shell** (`src/renderer/src/App.tsx` + `components/Shell.tsx`): left sidebar — product name,
"Jobs" nav item, footer with live server-status dot (reuses `/health` polling) and a
data-folder link; main pane is the router outlet. Phase 0's status screen content moves to the
sidebar footer + a `/system` route.

**Routes/pages** (`src/renderer/src/pages/`):
- `/` → **JobsPage**: job cards/list (name, candidate count, created); "New job" form — name +
  JD (textarea tab / file tab); empty state invites creating the first job.
- `/jobs/:id` → **JobDetailPage**: header (name + inline rename), JD panel (view / replace via
  paste or file), candidates table (name, status badge, added), "Add candidates" — drag-drop
  zone + paste tab.
- `/candidates/:id` → **CandidatePage**: name/contact, status badge (+ human-readable
  `needs_review` reason), extracted-text viewer, "Open folder" button.
- `/system` → the Phase 0 status content.

**IPC addition** (the one non-HTTP change): `openPath(relativePath: string)` on the preload
bridge → main process resolves against `dataRoot`, **rejects any path escaping it**
(resolve + prefix check), then `shell.openPath`. Registered alongside the existing handlers in
`src/main/ipc.ts`.

## 8. Error handling

- Services throw typed errors; one Hono middleware maps them: `ValidationError → 400`,
  `NotFound → 404`, `Conflict → 409`; body cap → `413`; unexpected → `500` with a logged message,
  never a half-written job/candidate (fs work happens inside the same try/rollback pattern).
- UI: inline field errors on forms; failed uploads listed with reasons (batch drop of N files:
  each file succeeds/fails independently); `needs_review` is a visible badge, never a dead end —
  the candidate page explains why and the original is one click away.

## 9. Testing

Vitest via the established Electron-as-Node runner (`npm test` only):

| Test file | Covers |
|---|---|
| `tests/naming.test.ts` | table: unicode preserved, illegal chars, reserved names, dot/space trim, length cap, collision suffixing (case-insensitive) |
| `tests/jobs.test.ts` | create → exact skeleton on disk + DB rows with relative paths; duplicate name 409; rename with candidates → folder moved, ALL path columns rewritten, compensation on injected DB failure |
| `tests/extract.test.ts` | fixtures: valid pdf/docx/txt, corrupt pdf, empty-text pdf, unsupported ext — success shape and never-throws failure shape |
| `tests/candidates.test.ts` | add from file (ok + needs_review paths), add from paste, profile.json contents, rollback on fs failure |
| `tests/routes.test.ts` | full HTTP surface via `app.request` + `FormData`, incl. 400/404/409/413 |

Fixtures: small committed binaries under `tests/fixtures/` (minimal valid PDF; minimal DOCX
generated once by a fixture script at implementation time; corrupt/empty variants).

Manual dev checklist: create 「销售经理」 (unicode) → skeleton correct; upload a real PDF; paste a
resume; rename the job with candidates present → paths still resolve, candidate page still loads;
drop a corrupt file → visible `needs_review` with reason; "Open folder" lands in the right place.

## 10. Out of scope (Phase 1)

AI analysis / ranking (Phase 2) · interviews (Phase 3) · email templates (Phase 4) · any deletion
(Phase 5, D-17) · candidate editing beyond creation fields · OCR for scanned PDFs · JD version
history · company-values/inject editing UI (files are boss-editable directly; UI later if wanted).

## 11. Acceptance criteria (from PRD Phase 1, made concrete)

1. Create "Sales Manager" → the exact section-4 folder tree exists; DB rows carry relative paths.
2. Upload a PDF resume → original + `resume_text.md` stored; candidate visible with status `new`.
3. Paste resume text → same result via the paste path.
4. A corrupt/unsupported file → candidate present, status `needs_review` with reason; original preserved; never lost.
5. Rename a job that has candidates → folder renamed, every stored path still resolves, UI still works.
6. Duplicate job name → clean 409 surfaced inline in the form.
7. All of the above offline, through the routed app shell.
