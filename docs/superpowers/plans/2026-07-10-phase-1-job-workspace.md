# Phase 1 — Job Workspace & Candidate Intake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The boss can create/rename jobs (with the full file-first folder skeleton), add candidates by file upload or pasted text (with never-throws text extraction), and browse them through the app's first routed UI.

**Architecture:** New Electron-free domain modules in `src/server/` (`naming`, `errors`, `jobs`, `candidates`, `extract`, `routes`) mounted on the Phase 0 Hono app; files are the substance, DB the index, all stored paths relative with forward slashes. Renderer gets a HashRouter app shell (sidebar + tokens) and three pages, talking HTTP only — plus one new containment-checked IPC method (`openPath`).

**Tech Stack:** Existing Phase 0 stack + `unpdf` (PDF text), `mammoth` (DOCX text), `react-router-dom` (renderer), `pdf-lib` + `jszip` (dev-only, test-fixture generation).

**Spec:** `docs/superpowers/specs/2026-07-10-phase-1-job-workspace-design.md` (approved). Decisions: D-17 (no deletion), D-21/D-22 (foundation).

## Global Constraints

- **Pure-JS only for new deps** — no native modules (the better-sqlite3 ABI lesson). `unpdf`, `mammoth`, `pdf-lib`, `jszip` are all pure JS.
- **All DB-stored paths are relative to `jobpin-data/` and use forward slashes** (`jobs/Sales Manager/jd.md`); resolve to absolute with `path.join(paths.dataRoot, rel)`.
- **No schema changes** — Phase 1 ships zero migrations; `candidates.status` uses only `new` and `needs_review`.
- **Never overwrite or lose user files**; extraction never throws; originals always preserved.
- Tests run **only** via `npm test` (Vitest under Electron-as-Node; `npx vitest` loads the wrong ABI and crashes). Filter: `npm test -- tests/<file>`.
- Every test uses a fresh temp dir via `getPaths(tmp)` — never the real `~/jobpin-data`.
- Server binds `127.0.0.1` only (unchanged). Upload cap: **20 MB** → `413`.
- Typed errors (`ValidationError→400`, `NotFoundError→404`, `ConflictError→409`) mapped in one place.
- UI: HashRouter (required — production loads via `file://`), design tokens as CSS variables; consult the frontend-design skill when styling Tasks 7–8.
- TypeScript strict; conventional commits; commit at the end of every task.

## File Structure (end state)

```
src/server/
  errors.ts          # typed error classes (NEW)
  naming.ts          # pure folder-name derivation (NEW)
  jobs.ts            # job service: create/list/get/setJd/rename (NEW)
  candidates.ts      # candidate service: add file/text, list, get (NEW)
  extract.ts         # never-throws text extraction (NEW)
  routes.ts          # REST routes + error mapping (NEW)
  app.ts             # MODIFIED: takes paths, mounts routes
src/main/ipc.ts      # MODIFIED: + jobpin:open-path (containment-checked)
src/preload/index.ts # MODIFIED: + openPath
src/renderer/src/
  styles/tokens.css  # design tokens (NEW)
  api.ts             # port-resolving fetch helper (NEW)
  components/Shell.tsx        # sidebar layout (NEW)
  components/StatusBadge.tsx  # candidate status chip (NEW)
  pages/JobsPage.tsx · pages/JobDetailPage.tsx · pages/CandidatePage.tsx · pages/SystemPage.tsx (NEW)
  App.tsx            # MODIFIED: HashRouter + routes
  env.d.ts           # MODIFIED: + openPath
tests/
  naming.test.ts · jobs.test.ts · rename.test.ts · extract.test.ts · candidates.test.ts · routes.test.ts (NEW)
  fixtures/generate.mjs + generated sample.txt/sample.pdf/sample.docx/corrupt.pdf/empty.pdf (NEW)
```

---

### Task 1: `naming.ts` — folder-name derivation

**Files:**
- Create: `src/server/naming.ts`
- Test: `tests/naming.test.ts`

**Interfaces:**
- Produces: `deriveFolderName(displayName: string, existingFolderNames: string[]): string` — unicode-preserving, Windows-safe, case-insensitive collision suffixing.

- [ ] **Step 1: Write the failing test**

`tests/naming.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { deriveFolderName } from '../src/server/naming'

describe('deriveFolderName', () => {
  it('keeps unicode names as-is', () => {
    expect(deriveFolderName('销售经理', [])).toBe('销售经理')
  })

  it('strips Windows-illegal characters', () => {
    expect(deriveFolderName('Sales/Manager: "North" <QLD>?', [])).toBe('Sales Manager North QLD')
  })

  it('collapses whitespace and trims dots/spaces', () => {
    expect(deriveFolderName('  Sales   Manager. ', [])).toBe('Sales Manager')
  })

  it('guards reserved device names', () => {
    expect(deriveFolderName('CON', [])).toBe('CON_')
    expect(deriveFolderName('lpt1', [])).toBe('lpt1_')
  })

  it('falls back for names that sanitize to nothing', () => {
    expect(deriveFolderName('???', [])).toBe('job')
  })

  it('caps length at 80 chars without trailing dots/spaces', () => {
    const long = 'a'.repeat(79) + ' b'
    expect(deriveFolderName(long, []).length).toBeLessThanOrEqual(80)
    expect(deriveFolderName(long, [])).not.toMatch(/[. ]$/)
  })

  it('suffixes on case-insensitive collision', () => {
    expect(deriveFolderName('Sales Manager', ['sales manager'])).toBe('Sales Manager (2)')
    expect(deriveFolderName('Sales Manager', ['Sales Manager', 'Sales Manager (2)'])).toBe('Sales Manager (3)')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/naming.test.ts`
Expected: FAIL — cannot resolve `../src/server/naming`.

- [ ] **Step 3: Write the implementation**

`src/server/naming.ts`:

```ts
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/**
 * Derive a Windows-safe folder name from a job display name (spec section 2.1).
 * Unicode is preserved; only illegal characters, reserved device names, and
 * collisions are handled. The display name in the DB is never altered.
 */
export function deriveFolderName(displayName: string, existingFolderNames: string[]): string {
  let name = displayName
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[. ]+/, '')
    .replace(/[. ]+$/, '')
  if (name.length > 80) name = name.slice(0, 80).replace(/[. ]+$/, '')
  if (name === '') name = 'job'
  if (RESERVED.test(name)) name += '_'

  const taken = new Set(existingFolderNames.map(n => n.toLowerCase()))
  if (!taken.has(name.toLowerCase())) return name
  for (let i = 2; ; i++) {
    const candidate = `${name} (${i})`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/naming.test.ts`
Expected: 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/naming.ts tests/naming.test.ts
git commit -m "feat: add windows-safe unicode-preserving job folder naming"
```

---

### Task 2: `errors.ts` + `jobs.ts` — create / list / get / setJd

**Files:**
- Create: `src/server/errors.ts`, `src/server/jobs.ts`
- Test: `tests/jobs.test.ts`

**Interfaces:**
- Consumes: `deriveFolderName` (Task 1); `DB`, `JobpinPaths`, `getPaths`, `openDatabase`, `runMigrations`, `migrations` (Phase 0).
- Produces:
  - `errors.ts`: `class ValidationError`, `class NotFoundError`, `class ConflictError` (all `extends Error`)
  - `jobs.ts`: `interface JobsDeps { db: DB; paths: JobpinPaths }` · `interface JobSummary { id: number; name: string; candidateCount: number; createdAt: string }` · `interface JobDetail { id: number; name: string; folderPath: string; jd: string | null; createdAt: string }` · `createJob(deps, name: string, jd?: string): JobDetail` · `listJobs(deps): JobSummary[]` · `getJob(deps, id: number): JobDetail` · `setJd(deps, id: number, text: string): string`

- [ ] **Step 1: Write the failing test**

`tests/jobs.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getPaths, type JobpinPaths } from '../src/server/paths'
import { ensureScaffold } from '../src/server/scaffold'
import { openDatabase, runMigrations, type DB } from '../src/server/db'
import { migrations } from '../src/server/migrations'
import { createJob, listJobs, getJob, setJd } from '../src/server/jobs'
import { ConflictError, NotFoundError, ValidationError } from '../src/server/errors'

let tmp: string
let db: DB
let paths: JobpinPaths

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jobpin-jobs-'))
  paths = getPaths(tmp)
  ensureScaffold(paths)
  db = openDatabase(paths.dbFile)
  runMigrations(db, migrations)
})

afterEach(() => {
  db.close()
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('createJob', () => {
  it('creates the full folder skeleton and DB row with relative forward-slash paths', () => {
    const job = createJob({ db, paths }, 'Sales Manager', '# JD\nSell things.')
    expect(job.folderPath).toBe('jobs/Sales Manager')
    const abs = path.join(tmp, 'jobs', 'Sales Manager')
    expect(fs.readFileSync(path.join(abs, 'jd.md'), 'utf8')).toBe('# JD\nSell things.')
    expect(fs.readFileSync(path.join(abs, 'inject.md'), 'utf8')).toBe('')
    expect(fs.existsSync(path.join(abs, 'references', 'interview_rules.md'))).toBe(true)
    expect(fs.existsSync(path.join(abs, 'references', 'legal_notes.md'))).toBe(true)
    expect(fs.existsSync(path.join(abs, 'references', 'company_context.md'))).toBe(true)
    expect(JSON.parse(fs.readFileSync(path.join(abs, 'question_bank.json'), 'utf8'))).toEqual({ questions: [] })
    expect(fs.existsSync(path.join(abs, 'learned_skills.md'))).toBe(true)
    expect(fs.existsSync(path.join(abs, 'candidates'))).toBe(true)
    const row = db.prepare('SELECT folder_path, jd_path, inject_path FROM jobs WHERE id = ?').get(job.id) as any
    expect(row.jd_path).toBe('jobs/Sales Manager/jd.md')
    expect(row.inject_path).toBe('jobs/Sales Manager/inject.md')
  })

  it('supports unicode names', () => {
    const job = createJob({ db, paths }, '销售经理')
    expect(fs.existsSync(path.join(tmp, 'jobs', '销售经理', 'jd.md'))).toBe(true)
    expect(job.jd).toBeNull() // no JD provided → empty file → null
  })

  it('rejects empty names', () => {
    expect(() => createJob({ db, paths }, '   ')).toThrow(ValidationError)
  })

  it('rejects duplicate display names', () => {
    createJob({ db, paths }, 'Barista')
    expect(() => createJob({ db, paths }, 'Barista')).toThrow(ConflictError)
  })

  it('suffixes folder when different names sanitize to the same folder', () => {
    createJob({ db, paths }, 'A/B')
    const second = createJob({ db, paths }, 'A\\B') // different display name, same sanitized folder
    expect(second.folderPath).toBe('jobs/A B (2)')
  })
})

describe('listJobs / getJob / setJd', () => {
  it('lists jobs with candidate counts', () => {
    const job = createJob({ db, paths }, 'Barista')
    db.prepare("INSERT INTO candidates (job_id, name) VALUES (?, 'Alex')").run(job.id)
    const list = listJobs({ db, paths })
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('Barista')
    expect(list[0].candidateCount).toBe(1)
  })

  it('getJob 404s on unknown id', () => {
    expect(() => getJob({ db, paths }, 999)).toThrow(NotFoundError)
  })

  it('setJd writes jd.md and getJob reads it back', () => {
    const job = createJob({ db, paths }, 'Barista')
    setJd({ db, paths }, job.id, 'New JD text')
    expect(getJob({ db, paths }, job.id).jd).toBe('New JD text')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/jobs.test.ts`
Expected: FAIL — cannot resolve `../src/server/jobs`.

- [ ] **Step 3: Write the implementations**

`src/server/errors.ts`:

```ts
/** Typed service errors, mapped to HTTP statuses in routes.ts (400/404/409). */
export class ValidationError extends Error {}
export class NotFoundError extends Error {}
export class ConflictError extends Error {}
```

`src/server/jobs.ts`:

```ts
import fs from 'node:fs'
import path from 'node:path'
import type { DB } from './db'
import type { JobpinPaths } from './paths'
import { deriveFolderName } from './naming'
import { ConflictError, NotFoundError, ValidationError } from './errors'

export interface JobsDeps {
  db: DB
  paths: JobpinPaths
}

export interface JobSummary {
  id: number
  name: string
  candidateCount: number
  createdAt: string
}

export interface JobDetail {
  id: number
  name: string
  folderPath: string
  jd: string | null
  createdAt: string
}

/** Skeleton files per PRD section 8.2 / spec section 4. Never overwrites. */
const SKELETON_FILES: Array<[rel: string, content: string]> = [
  ['inject.md', ''],
  ['references/interview_rules.md', ''],
  ['references/legal_notes.md', ''],
  ['references/company_context.md', ''],
  ['question_bank.json', '{"questions": []}\n'],
  ['learned_skills.md', '']
]

export function existingFolderNames(paths: JobpinPaths): string[] {
  if (!fs.existsSync(paths.jobsDir)) return []
  return fs
    .readdirSync(paths.jobsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
}

export function createJob(deps: JobsDeps, name: string, jd?: string): JobDetail {
  const { db, paths } = deps
  const displayName = (name ?? '').trim()
  if (!displayName) throw new ValidationError('job name is required')
  if (db.prepare('SELECT id FROM jobs WHERE name = ?').get(displayName)) {
    throw new ConflictError(`a job named "${displayName}" already exists`)
  }

  const folderName = deriveFolderName(displayName, existingFolderNames(paths))
  const folderRel = `jobs/${folderName}` // forward slashes in all stored paths
  const folderAbs = path.join(paths.dataRoot, folderRel)

  fs.mkdirSync(path.join(folderAbs, 'references'), { recursive: true })
  fs.mkdirSync(path.join(folderAbs, 'candidates'), { recursive: true })
  fs.writeFileSync(path.join(folderAbs, 'jd.md'), jd ?? '', 'utf8')
  for (const [rel, content] of SKELETON_FILES) {
    fs.writeFileSync(path.join(folderAbs, rel), content, 'utf8')
  }

  try {
    const info = db
      .prepare('INSERT INTO jobs (name, folder_path, jd_path, inject_path) VALUES (?, ?, ?, ?)')
      .run(displayName, folderRel, `${folderRel}/jd.md`, `${folderRel}/inject.md`)
    return getJob(deps, Number(info.lastInsertRowid))
  } catch (e) {
    fs.rmSync(folderAbs, { recursive: true, force: true }) // no half-created jobs
    throw e
  }
}

export function listJobs({ db }: JobsDeps): JobSummary[] {
  return db
    .prepare(
      `SELECT j.id, j.name, j.created_at AS createdAt,
              (SELECT COUNT(*) FROM candidates c WHERE c.job_id = j.id) AS candidateCount
       FROM jobs j ORDER BY j.created_at DESC, j.id DESC`
    )
    .all() as JobSummary[]
}

export function getJob({ db, paths }: JobsDeps, id: number): JobDetail {
  const row = db
    .prepare('SELECT id, name, folder_path, jd_path, created_at FROM jobs WHERE id = ?')
    .get(id) as { id: number; name: string; folder_path: string; jd_path: string; created_at: string } | undefined
  if (!row) throw new NotFoundError(`job ${id} not found`)
  const jdAbs = path.join(paths.dataRoot, row.jd_path)
  const jdRaw = fs.existsSync(jdAbs) ? fs.readFileSync(jdAbs, 'utf8') : ''
  return {
    id: row.id,
    name: row.name,
    folderPath: row.folder_path,
    jd: jdRaw.trim() === '' ? null : jdRaw, // empty jd.md → "no JD yet"
    createdAt: row.created_at
  }
}

export function setJd({ db, paths }: JobsDeps, id: number, text: string): string {
  const row = db.prepare('SELECT jd_path FROM jobs WHERE id = ?').get(id) as { jd_path: string } | undefined
  if (!row) throw new NotFoundError(`job ${id} not found`)
  fs.writeFileSync(path.join(paths.dataRoot, row.jd_path), text, 'utf8')
  return text
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/jobs.test.ts`
Expected: 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/errors.ts src/server/jobs.ts tests/jobs.test.ts
git commit -m "feat: add job service - create with folder skeleton, list, get, setJd"
```

---

### Task 3: `renameJob` — transactional rename with path rewrite

**Files:**
- Modify: `src/server/jobs.ts` (append)
- Test: `tests/rename.test.ts`

**Interfaces:**
- Produces: `renameJob(deps: JobsDeps, id: number, newName: string): JobDetail` — fs rename first, then one DB transaction rewriting every path column; compensating fs rename on DB failure.

- [ ] **Step 1: Write the failing test**

`tests/rename.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getPaths, type JobpinPaths } from '../src/server/paths'
import { ensureScaffold } from '../src/server/scaffold'
import { openDatabase, runMigrations, type DB } from '../src/server/db'
import { migrations } from '../src/server/migrations'
import { createJob, renameJob, getJob } from '../src/server/jobs'
import { ConflictError } from '../src/server/errors'

let tmp: string
let db: DB
let paths: JobpinPaths

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jobpin-rename-'))
  paths = getPaths(tmp)
  ensureScaffold(paths)
  db = openDatabase(paths.dbFile)
  runMigrations(db, migrations)
})

afterEach(() => {
  db.close()
  fs.rmSync(tmp, { recursive: true, force: true })
})

function addCandidateRows(jobId: number, folderRel: string): void {
  const info = db.prepare("INSERT INTO candidates (job_id, name) VALUES (?, 'Alex')").run(jobId)
  const candRel = `${folderRel}/candidates/candidate_${info.lastInsertRowid}`
  fs.mkdirSync(path.join(tmp, candRel), { recursive: true })
  fs.writeFileSync(path.join(tmp, candRel, 'resume.pdf'), 'x')
  db.prepare(
    'INSERT INTO candidate_documents (candidate_id, type, file_path, extracted_text_path) VALUES (?, ?, ?, ?)'
  ).run(info.lastInsertRowid, 'resume', `${candRel}/resume.pdf`, `${candRel}/resume_text.md`)
}

describe('renameJob', () => {
  it('renames folder and rewrites every stored path', () => {
    const job = createJob({ db, paths }, 'Sales Manger') // typo
    addCandidateRows(job.id, job.folderPath)

    const renamed = renameJob({ db, paths }, job.id, 'Sales Manager')
    expect(renamed.name).toBe('Sales Manager')
    expect(renamed.folderPath).toBe('jobs/Sales Manager')
    expect(fs.existsSync(path.join(tmp, 'jobs', 'Sales Manager', 'jd.md'))).toBe(true)
    expect(fs.existsSync(path.join(tmp, 'jobs', 'Sales Manger'))).toBe(false)

    const doc = db.prepare('SELECT file_path, extracted_text_path FROM candidate_documents').get() as any
    expect(doc.file_path).toMatch(/^jobs\/Sales Manager\/candidates\//)
    expect(doc.extracted_text_path).toMatch(/^jobs\/Sales Manager\/candidates\//)
    // the moved file still resolves
    expect(fs.existsSync(path.join(tmp, doc.file_path))).toBe(true)
  })

  it('does not touch other jobs paths', () => {
    const a = createJob({ db, paths }, 'Alpha')
    const b = createJob({ db, paths }, 'Beta')
    addCandidateRows(b.id, b.folderPath)
    renameJob({ db, paths }, a.id, 'Gamma')
    const doc = db.prepare('SELECT file_path FROM candidate_documents').get() as any
    expect(doc.file_path).toMatch(/^jobs\/Beta\//)
  })

  it('name-only change when folder name is unchanged (case-only rename)', () => {
    const job = createJob({ db, paths }, 'barista')
    const renamed = renameJob({ db, paths }, job.id, 'barista ') // trims to same folder
    expect(renamed.name).toBe('barista')
  })

  it('rejects duplicate display name', () => {
    createJob({ db, paths }, 'Alpha')
    const b = createJob({ db, paths }, 'Beta')
    expect(() => renameJob({ db, paths }, b.id, 'Alpha')).toThrow(ConflictError)
  })

  it('compensates the fs rename when the DB transaction fails', () => {
    const job = createJob({ db, paths }, 'Original')
    // Force the in-transaction jobs UPDATE to abort:
    db.exec(`CREATE TRIGGER boom BEFORE UPDATE OF name ON jobs
             WHEN NEW.name = 'BOOM' BEGIN SELECT RAISE(ABORT, 'boom'); END`)
    expect(() => renameJob({ db, paths }, job.id, 'BOOM')).toThrow(/boom/)
    // folder is back at the original location, DB unchanged
    expect(fs.existsSync(path.join(tmp, 'jobs', 'Original', 'jd.md'))).toBe(true)
    expect(fs.existsSync(path.join(tmp, 'jobs', 'BOOM'))).toBe(false)
    expect(getJob({ db, paths }, job.id).name).toBe('Original')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/rename.test.ts`
Expected: FAIL — `renameJob` is not exported.

- [ ] **Step 3: Append the implementation to `src/server/jobs.ts`**

```ts
/** Every column that stores a jobpin-data-relative path (spec section 5 step 4). */
const PATH_COLUMNS: Array<[table: string, column: string]> = [
  ['jobs', 'folder_path'],
  ['jobs', 'jd_path'],
  ['jobs', 'inject_path'],
  ['candidate_documents', 'file_path'],
  ['candidate_documents', 'extracted_text_path'],
  ['interviews', 'transcript_path'],
  ['interviews', 'summary_path'],
  ['ai_analyses', 'output_path'],
  ['emails', 'file_path'],
  ['documents', 'file_path']
]

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, m => '\\' + m)
}

export function renameJob(deps: JobsDeps, id: number, newName: string): JobDetail {
  const { db, paths } = deps
  const name = (newName ?? '').trim()
  if (!name) throw new ValidationError('job name is required')
  const row = db.prepare('SELECT id, name, folder_path FROM jobs WHERE id = ?').get(id) as
    | { id: number; name: string; folder_path: string }
    | undefined
  if (!row) throw new NotFoundError(`job ${id} not found`)
  if (db.prepare('SELECT id FROM jobs WHERE name = ? AND id != ?').get(name, id)) {
    throw new ConflictError(`a job named "${name}" already exists`)
  }

  const oldFolderRel = row.folder_path
  const oldFolderName = oldFolderRel.slice('jobs/'.length)
  const others = existingFolderNames(paths).filter(n => n !== oldFolderName)
  const newFolderName = deriveFolderName(name, others)

  const touchName = db.prepare(
    "UPDATE jobs SET name = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?"
  )

  if (newFolderName === oldFolderName) {
    touchName.run(name, id) // display-name-only change; folder already correct
    return getJob(deps, id)
  }

  const newFolderRel = `jobs/${newFolderName}`
  const oldAbs = path.join(paths.dataRoot, oldFolderRel)
  const newAbs = path.join(paths.dataRoot, newFolderRel)

  fs.renameSync(oldAbs, newAbs) // atomic on the same volume
  try {
    db.transaction(() => {
      touchName.run(name, id)
      for (const [table, column] of PATH_COLUMNS) {
        db.prepare(
          `UPDATE ${table}
             SET ${column} = ? || substr(${column}, ?)
           WHERE ${column} = ? OR ${column} LIKE ? ESCAPE '\\'`
        ).run(newFolderRel, oldFolderRel.length + 1, oldFolderRel, escapeLike(oldFolderRel) + '/%')
      }
    })()
  } catch (e) {
    fs.renameSync(newAbs, oldAbs) // compensate: put the folder back
    throw e
  }
  return getJob(deps, id)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/rename.test.ts`
Expected: 5 tests PASS.

Run: `npm test`
Expected: whole suite PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/jobs.ts tests/rename.test.ts
git commit -m "feat: add transactional job rename with generic path rewrite and fs compensation"
```

---

### Task 4: `extract.ts` + test fixtures

**Files:**
- Create: `src/server/extract.ts`, `tests/fixtures/generate.mjs`
- Create (generated + committed): `tests/fixtures/sample.txt`, `sample.pdf`, `sample.docx`, `corrupt.pdf`, `empty.pdf`
- Test: `tests/extract.test.ts`

**Interfaces:**
- Produces: `extractText(bytes: Uint8Array, ext: string): Promise<{ text: string } | { error: string }>` (never throws) · `extOf(filename: string): string` (lowercase extension without dot, `''` if none).

- [ ] **Step 1: Install dependencies**

```bash
npm install unpdf mammoth
npm install -D pdf-lib jszip
```

Expected: pure-JS installs; the postinstall electron-rebuild step runs and succeeds (no new native modules).

- [ ] **Step 2: Write the fixture generator**

`tests/fixtures/generate.mjs`:

```js
// One-time generator for extraction test fixtures. Run: node tests/fixtures/generate.mjs
// Outputs are committed so tests never depend on this script at runtime.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import JSZip from 'jszip'

const here = path.dirname(fileURLToPath(import.meta.url))

// sample.txt
fs.writeFileSync(path.join(here, 'sample.txt'), 'Alex Chen\nBarista with 3 years espresso experience.\n', 'utf8')

// sample.pdf - one page with real extractable text
{
  const doc = await PDFDocument.create()
  const page = doc.addPage([400, 200])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  page.drawText('Hello Jobpin PDF resume', { x: 40, y: 120, size: 14, font })
  fs.writeFileSync(path.join(here, 'sample.pdf'), await doc.save())
}

// empty.pdf - a valid PDF with a blank page (no extractable text)
{
  const doc = await PDFDocument.create()
  doc.addPage([400, 200])
  fs.writeFileSync(path.join(here, 'empty.pdf'), await doc.save())
}

// corrupt.pdf - not actually a PDF
fs.writeFileSync(path.join(here, 'corrupt.pdf'), '%PDF-1.4 this is not really a pdf')

// sample.docx - minimal WordprocessingML document mammoth can read
{
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
  )
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  )
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>Hello Jobpin DOCX resume</w:t></w:r></w:p></w:body>
</w:document>`
  )
  fs.writeFileSync(path.join(here, 'sample.docx'), await zip.generateAsync({ type: 'nodebuffer' }))
}

console.log('fixtures generated')
```

Run: `node tests/fixtures/generate.mjs`
Expected: `fixtures generated`; five files exist under `tests/fixtures/`.

- [ ] **Step 3: Write the failing test**

`tests/extract.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractText, extOf } from '../src/server/extract'

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures')
const read = (f: string) => new Uint8Array(fs.readFileSync(path.join(fixtures, f)))

describe('extOf', () => {
  it('lowercases and strips the dot', () => {
    expect(extOf('Resume.PDF')).toBe('pdf')
    expect(extOf('notes')).toBe('')
  })
})

describe('extractText', () => {
  it('reads txt', async () => {
    const r = await extractText(read('sample.txt'), 'txt')
    expect('text' in r && r.text).toContain('espresso')
  })

  it('extracts pdf text', async () => {
    const r = await extractText(read('sample.pdf'), 'pdf')
    expect('text' in r && r.text).toContain('Hello Jobpin PDF resume')
  })

  it('extracts docx text', async () => {
    const r = await extractText(read('sample.docx'), 'docx')
    expect('text' in r && r.text).toContain('Hello Jobpin DOCX resume')
  })

  it('flags scanned/empty pdf as an error, without throwing', async () => {
    const r = await extractText(read('empty.pdf'), 'pdf')
    expect('error' in r && r.error).toMatch(/no extractable text/)
  })

  it('flags corrupt pdf as an error, without throwing', async () => {
    const r = await extractText(read('corrupt.pdf'), 'pdf')
    expect('error' in r).toBe(true)
  })

  it('flags unsupported extensions', async () => {
    const r = await extractText(read('sample.txt'), 'pages')
    expect('error' in r && r.error).toMatch(/unsupported file type/)
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm test -- tests/extract.test.ts`
Expected: FAIL — cannot resolve `../src/server/extract`.

- [ ] **Step 5: Write the implementation**

`src/server/extract.ts`:

```ts
import mammoth from 'mammoth'
import { extractText as unpdfExtractText, getDocumentProxy } from 'unpdf'

export type ExtractResult = { text: string } | { error: string }

export function extOf(filename: string): string {
  const i = filename.lastIndexOf('.')
  return i === -1 ? '' : filename.slice(i + 1).toLowerCase()
}

/**
 * File bytes -> text. NEVER throws: every failure becomes { error }, so the
 * candidate is flagged needs_review and the original is preserved (spec section 6).
 */
export async function extractText(bytes: Uint8Array, ext: string): Promise<ExtractResult> {
  const e = ext.toLowerCase().replace(/^\./, '')
  try {
    if (e === 'txt' || e === 'md') {
      return { text: Buffer.from(bytes).toString('utf8') }
    }
    if (e === 'pdf') {
      const pdf = await getDocumentProxy(new Uint8Array(bytes))
      const { text } = await unpdfExtractText(pdf, { mergePages: true })
      if (!text || text.trim() === '') return { error: 'no extractable text (scanned document?)' }
      return { text }
    }
    if (e === 'docx') {
      const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) })
      if (!value || value.trim() === '') return { error: 'no extractable text in document' }
      return { text: value }
    }
    return { error: `unsupported file type .${e || '(none)'}` }
  } catch (err) {
    return { error: `extraction failed: ${err instanceof Error ? err.message : String(err)}` }
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- tests/extract.test.ts`
Expected: 7 tests PASS. (If the unpdf import shape differs in the installed version, check `node_modules/unpdf/dist` exports — the two named exports above are the documented API.)

- [ ] **Step 7: Commit**

```bash
git add src/server/extract.ts tests/extract.test.ts tests/fixtures package.json package-lock.json
git commit -m "feat: add never-throws text extraction (unpdf/mammoth) with committed fixtures"
```

---

### Task 5: `candidates.ts` — add from file / paste, list, get

**Files:**
- Create: `src/server/candidates.ts`
- Test: `tests/candidates.test.ts`

**Interfaces:**
- Consumes: `extractText`, `extOf` (Task 4); `JobsDeps` shape, errors (Task 2).
- Produces:
  - `interface CandidateSummary { id: number; name: string; status: string; createdAt: string }`
  - `interface CandidateDetail { id: number; jobId: number; name: string; email: string | null; phone: string | null; status: string; extractedText: string | null; extraction: { status: 'ok' | 'failed'; error?: string }; originalFilename?: string; folderPath: string; createdAt: string }`
  - `addCandidateFromFile(deps, jobId: number, originalFilename: string, bytes: Uint8Array, name?: string): Promise<CandidateDetail>`
  - `addCandidateFromText(deps, jobId: number, name: string, text: string): Promise<CandidateDetail>`
  - `listCandidates(deps, jobId: number): CandidateSummary[]`
  - `getCandidate(deps, id: number): CandidateDetail`

- [ ] **Step 1: Write the failing test**

`tests/candidates.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getPaths, type JobpinPaths } from '../src/server/paths'
import { ensureScaffold } from '../src/server/scaffold'
import { openDatabase, runMigrations, type DB } from '../src/server/db'
import { migrations } from '../src/server/migrations'
import { createJob } from '../src/server/jobs'
import {
  addCandidateFromFile, addCandidateFromText, listCandidates, getCandidate
} from '../src/server/candidates'
import { NotFoundError, ValidationError } from '../src/server/errors'

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures')
const read = (f: string) => new Uint8Array(fs.readFileSync(path.join(fixtures, f)))

let tmp: string
let db: DB
let paths: JobpinPaths
let jobId: number

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jobpin-cand-'))
  paths = getPaths(tmp)
  ensureScaffold(paths)
  db = openDatabase(paths.dbFile)
  runMigrations(db, migrations)
  jobId = createJob({ db, paths }, 'Barista').id
})

afterEach(() => {
  db.close()
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('addCandidateFromFile', () => {
  it('stores original + extracted text, status new, profile.json metadata', async () => {
    const c = await addCandidateFromFile({ db, paths }, jobId, 'Alex Chen CV.pdf', read('sample.pdf'))
    expect(c.name).toBe('Alex Chen CV') // filename stem default
    expect(c.status).toBe('new')
    expect(c.extraction.status).toBe('ok')
    expect(c.originalFilename).toBe('Alex Chen CV.pdf')
    const abs = path.join(tmp, c.folderPath)
    expect(fs.existsSync(path.join(abs, 'resume.pdf'))).toBe(true)
    expect(fs.readFileSync(path.join(abs, 'resume_text.md'), 'utf8')).toContain('Hello Jobpin PDF resume')
    const profile = JSON.parse(fs.readFileSync(path.join(abs, 'profile.json'), 'utf8'))
    expect(profile.source).toBe('upload')
    expect(profile.extraction.status).toBe('ok')
  })

  it('flags extraction failure as needs_review, original preserved', async () => {
    const c = await addCandidateFromFile({ db, paths }, jobId, 'scan.pdf', read('empty.pdf'), 'Scanned Sam')
    expect(c.status).toBe('needs_review')
    expect(c.extraction.status).toBe('failed')
    expect(c.extraction.error).toMatch(/no extractable text/)
    expect(c.extractedText).toBeNull()
    expect(fs.existsSync(path.join(tmp, c.folderPath, 'resume.pdf'))).toBe(true)
    expect(fs.existsSync(path.join(tmp, c.folderPath, 'resume_text.md'))).toBe(false)
  })

  it('404s on unknown job', async () => {
    await expect(addCandidateFromFile({ db, paths }, 999, 'x.txt', read('sample.txt'))).rejects.toThrow(NotFoundError)
  })
})

describe('addCandidateFromText', () => {
  it('stores paste as resume.md + resume_text.md, status new', async () => {
    const c = await addCandidateFromText({ db, paths }, jobId, 'Pasted Pat', 'Ten years of sales.')
    expect(c.status).toBe('new')
    const abs = path.join(tmp, c.folderPath)
    expect(fs.readFileSync(path.join(abs, 'resume.md'), 'utf8')).toBe('Ten years of sales.')
    expect(fs.readFileSync(path.join(abs, 'resume_text.md'), 'utf8')).toBe('Ten years of sales.')
    const profile = JSON.parse(fs.readFileSync(path.join(abs, 'profile.json'), 'utf8'))
    expect(profile.source).toBe('paste')
  })

  it('requires a name', async () => {
    await expect(addCandidateFromText({ db, paths }, jobId, '  ', 'text')).rejects.toThrow(ValidationError)
  })
})

describe('listCandidates / getCandidate', () => {
  it('lists newest first and 404s on unknown job', async () => {
    await addCandidateFromText({ db, paths }, jobId, 'One', 'a')
    await addCandidateFromText({ db, paths }, jobId, 'Two', 'b')
    const list = listCandidates({ db, paths }, jobId)
    expect(list.map(c => c.name)).toEqual(['Two', 'One'])
    expect(() => listCandidates({ db, paths }, 999)).toThrow(NotFoundError)
  })

  it('getCandidate returns extracted text and 404s on unknown id', async () => {
    const c = await addCandidateFromText({ db, paths }, jobId, 'One', 'the text')
    expect(getCandidate({ db, paths }, c.id).extractedText).toBe('the text')
    expect(() => getCandidate({ db, paths }, 999)).toThrow(NotFoundError)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/candidates.test.ts`
Expected: FAIL — cannot resolve `../src/server/candidates`.

- [ ] **Step 3: Write the implementation**

`src/server/candidates.ts`:

```ts
import fs from 'node:fs'
import path from 'node:path'
import type { JobsDeps } from './jobs'
import { extractText, extOf, type ExtractResult } from './extract'
import { NotFoundError, ValidationError } from './errors'

export interface CandidateSummary {
  id: number
  name: string
  status: string
  createdAt: string
}

export interface CandidateDetail extends CandidateSummary {
  jobId: number
  email: string | null
  phone: string | null
  extractedText: string | null
  extraction: { status: 'ok' | 'failed'; error?: string }
  originalFilename?: string
  folderPath: string
}

interface Profile {
  name: string
  email: string | null
  phone: string | null
  source: 'upload' | 'paste'
  originalFilename?: string
  extraction: { status: 'ok' | 'failed'; error?: string }
  createdAt: string
}

function jobFolderOr404(deps: JobsDeps, jobId: number): string {
  const row = deps.db.prepare('SELECT folder_path FROM jobs WHERE id = ?').get(jobId) as
    | { folder_path: string }
    | undefined
  if (!row) throw new NotFoundError(`job ${jobId} not found`)
  return row.folder_path
}

/** Shared write path for both intake modes. `originalName` = stored original file name. */
function persistCandidate(
  deps: JobsDeps,
  jobId: number,
  jobFolderRel: string,
  name: string,
  originalName: string,
  originalBytes: Uint8Array,
  result: ExtractResult,
  profileBase: Pick<Profile, 'source' | 'originalFilename'>
): number {
  const { db, paths } = deps
  const status = 'text' in result ? 'new' : 'needs_review'

  const insert = db.transaction(() => {
    const info = db.prepare('INSERT INTO candidates (job_id, name, status) VALUES (?, ?, ?)').run(jobId, name, status)
    const id = Number(info.lastInsertRowid)
    const candRel = `${jobFolderRel}/candidates/candidate_${id}`
    const candAbs = path.join(paths.dataRoot, candRel)
    try {
      fs.mkdirSync(candAbs, { recursive: true })
      fs.writeFileSync(path.join(candAbs, originalName), originalBytes)
      let extractedRel: string | null = null
      if ('text' in result) {
        extractedRel = `${candRel}/resume_text.md`
        fs.writeFileSync(path.join(candAbs, 'resume_text.md'), result.text, 'utf8')
      }
      const profile: Profile = {
        name,
        email: null,
        phone: null,
        ...profileBase,
        extraction: 'text' in result ? { status: 'ok' } : { status: 'failed', error: result.error },
        createdAt: new Date().toISOString()
      }
      fs.writeFileSync(path.join(candAbs, 'profile.json'), JSON.stringify(profile, null, 2) + '\n', 'utf8')
      db.prepare(
        'INSERT INTO candidate_documents (candidate_id, type, file_path, extracted_text_path) VALUES (?, ?, ?, ?)'
      ).run(id, 'resume', `${candRel}/${originalName}`, extractedRel)
      return id
    } catch (e) {
      fs.rmSync(candAbs, { recursive: true, force: true }) // fs failed → remove partial folder; tx rolls back
      throw e
    }
  })
  return insert()
}

export async function addCandidateFromFile(
  deps: JobsDeps,
  jobId: number,
  originalFilename: string,
  bytes: Uint8Array,
  name?: string
): Promise<CandidateDetail> {
  const jobFolderRel = jobFolderOr404(deps, jobId)
  const ext = extOf(originalFilename)
  const stem = originalFilename.replace(/\.[^.]*$/, '')
  const candidateName = (name ?? '').trim() || stem.trim() || 'Unnamed candidate'
  const result = await extractText(bytes, ext)
  const storedName = `resume.${ext || 'bin'}` // contract-stable original filename (spec section 4)
  const id = persistCandidate(deps, jobId, jobFolderRel, candidateName, storedName, bytes, result, {
    source: 'upload',
    originalFilename
  })
  return getCandidate(deps, id)
}

export async function addCandidateFromText(
  deps: JobsDeps,
  jobId: number,
  name: string,
  text: string
): Promise<CandidateDetail> {
  const jobFolderRel = jobFolderOr404(deps, jobId)
  const candidateName = (name ?? '').trim()
  if (!candidateName) throw new ValidationError('candidate name is required for pasted resumes')
  if (!(text ?? '').trim()) throw new ValidationError('resume text is required')
  const id = persistCandidate(
    deps, jobId, jobFolderRel, candidateName, 'resume.md',
    new TextEncoder().encode(text), { text }, { source: 'paste' }
  )
  return getCandidate(deps, id)
}

export function listCandidates(deps: JobsDeps, jobId: number): CandidateSummary[] {
  jobFolderOr404(deps, jobId)
  return deps.db
    .prepare(
      'SELECT id, name, status, created_at AS createdAt FROM candidates WHERE job_id = ? ORDER BY created_at DESC, id DESC'
    )
    .all(jobId) as CandidateSummary[]
}

export function getCandidate(deps: JobsDeps, id: number): CandidateDetail {
  const { db, paths } = deps
  const row = db
    .prepare('SELECT id, job_id, name, email, phone, status, created_at FROM candidates WHERE id = ?')
    .get(id) as
    | { id: number; job_id: number; name: string; email: string | null; phone: string | null; status: string; created_at: string }
    | undefined
  if (!row) throw new NotFoundError(`candidate ${id} not found`)
  const doc = db
    .prepare("SELECT file_path, extracted_text_path FROM candidate_documents WHERE candidate_id = ? AND type = 'resume'")
    .get(id) as { file_path: string; extracted_text_path: string | null } | undefined

  const folderPath = doc ? doc.file_path.slice(0, doc.file_path.lastIndexOf('/')) : ''
  let extractedText: string | null = null
  if (doc?.extracted_text_path) {
    const abs = path.join(paths.dataRoot, doc.extracted_text_path)
    if (fs.existsSync(abs)) extractedText = fs.readFileSync(abs, 'utf8')
  }
  let extraction: CandidateDetail['extraction'] = { status: 'ok' }
  let originalFilename: string | undefined
  const profileAbs = path.join(paths.dataRoot, folderPath, 'profile.json')
  if (folderPath && fs.existsSync(profileAbs)) {
    try {
      const profile = JSON.parse(fs.readFileSync(profileAbs, 'utf8')) as Profile
      extraction = profile.extraction ?? extraction
      originalFilename = profile.originalFilename
    } catch {
      /* unreadable profile.json is non-fatal; defaults stand */
    }
  }
  return {
    id: row.id,
    jobId: row.job_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    status: row.status,
    createdAt: row.created_at,
    extractedText,
    extraction,
    originalFilename,
    folderPath
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/candidates.test.ts`
Expected: 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/candidates.ts tests/candidates.test.ts
git commit -m "feat: add candidate intake service - upload/paste, profile.json, needs_review flow"
```

---

### Task 6: REST routes + error mapping, wired into the app

**Files:**
- Create: `src/server/routes.ts`
- Modify: `src/server/app.ts` (take `paths`, mount routes), `src/main/index.ts` (pass `paths`), `tests/app.test.ts` (new `createApp` signature)
- Test: `tests/routes.test.ts`

**Interfaces:**
- Consumes: all Task 1–5 exports.
- Produces: `registerJobRoutes(app: Hono, deps: JobsDeps): void`; **modified** `createApp(deps: { db: DB; paths: JobpinPaths; version: string }): Hono` (was `dataRoot: string` — `/health` now uses `paths.dataRoot`).

- [ ] **Step 1: Write the failing test**

`tests/routes.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Hono } from 'hono'
import { getPaths, type JobpinPaths } from '../src/server/paths'
import { ensureScaffold } from '../src/server/scaffold'
import { openDatabase, runMigrations, type DB } from '../src/server/db'
import { migrations } from '../src/server/migrations'
import { createApp } from '../src/server/app'

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures')

let tmp: string
let db: DB
let paths: JobpinPaths
let app: Hono

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jobpin-routes-'))
  paths = getPaths(tmp)
  ensureScaffold(paths)
  db = openDatabase(paths.dbFile)
  runMigrations(db, migrations)
  app = createApp({ db, paths, version: '0.1.0' })
})

afterEach(() => {
  db.close()
  fs.rmSync(tmp, { recursive: true, force: true })
})

const json = (body: unknown) => ({
  method: 'POST' as const,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
})

describe('job routes', () => {
  it('POST /jobs creates; GET /jobs lists; GET /jobs/:id details', async () => {
    const created = await app.request('/jobs', json({ name: 'Barista', jd: 'Make coffee' }))
    expect(created.status).toBe(201)
    const { id } = await created.json()

    const list = await (await app.request('/jobs')).json()
    expect(list).toHaveLength(1)
    expect(list[0].candidateCount).toBe(0)

    const detail = await (await app.request(`/jobs/${id}`)).json()
    expect(detail.jd).toBe('Make coffee')
  })

  it('maps typed errors: 400 empty name, 409 duplicate, 404 unknown', async () => {
    expect((await app.request('/jobs', json({ name: ' ' }))).status).toBe(400)
    await app.request('/jobs', json({ name: 'Barista' }))
    expect((await app.request('/jobs', json({ name: 'Barista' }))).status).toBe(409)
    expect((await app.request('/jobs/999')).status).toBe(404)
  })

  it('PATCH /jobs/:id renames', async () => {
    const { id } = await (await app.request('/jobs', json({ name: 'Barsita' }))).json()
    const res = await app.request(`/jobs/${id}`, { ...json({ name: 'Barista' }), method: 'PATCH' })
    expect(res.status).toBe(200)
    expect((await res.json()).name).toBe('Barista')
  })

  it('PUT /jobs/:id/jd accepts text and multipart file', async () => {
    const { id } = await (await app.request('/jobs', json({ name: 'Barista' }))).json()
    const t = await app.request(`/jobs/${id}/jd`, { ...json({ text: 'JD v2' }), method: 'PUT' })
    expect(t.status).toBe(200)

    const fd = new FormData()
    fd.append('file', new File([fs.readFileSync(path.join(fixtures, 'sample.txt'))], 'jd.txt'))
    const f = await app.request(`/jobs/${id}/jd`, { method: 'PUT', body: fd })
    expect(f.status).toBe(200)
    expect((await f.json()).jd).toContain('espresso')
  })

  it('PUT /jobs/:id/jd returns 422 when file extraction fails', async () => {
    const { id } = await (await app.request('/jobs', json({ name: 'Barista' }))).json()
    const fd = new FormData()
    fd.append('file', new File([fs.readFileSync(path.join(fixtures, 'corrupt.pdf'))], 'jd.pdf'))
    expect((await app.request(`/jobs/${id}/jd`, { method: 'PUT', body: fd })).status).toBe(422)
  })
})

describe('candidate routes', () => {
  let jobId: number
  beforeEach(async () => {
    jobId = (await (await app.request('/jobs', json({ name: 'Barista' }))).json()).id
  })

  it('POST multipart file → 201; needs_review for empty pdf', async () => {
    const fd = new FormData()
    fd.append('file', new File([fs.readFileSync(path.join(fixtures, 'sample.pdf'))], 'Alex.pdf'))
    const ok = await app.request(`/jobs/${jobId}/candidates`, { method: 'POST', body: fd })
    expect(ok.status).toBe(201)
    expect((await ok.json()).status).toBe('new')

    const fd2 = new FormData()
    fd2.append('file', new File([fs.readFileSync(path.join(fixtures, 'empty.pdf'))], 'scan.pdf'))
    const flagged = await (await app.request(`/jobs/${jobId}/candidates`, { method: 'POST', body: fd2 })).json()
    expect(flagged.status).toBe('needs_review')
  })

  it('POST paste JSON → 201; 400 without name', async () => {
    const ok = await app.request(`/jobs/${jobId}/candidates`, json({ name: 'Pat', text: 'resume text' }))
    expect(ok.status).toBe(201)
    expect((await app.request(`/jobs/${jobId}/candidates`, json({ text: 'no name' }))).status).toBe(400)
  })

  it('413 on oversize upload', async () => {
    const fd = new FormData()
    fd.append('file', new File([new Uint8Array(21 * 1024 * 1024)], 'big.pdf'))
    expect((await app.request(`/jobs/${jobId}/candidates`, { method: 'POST', body: fd })).status).toBe(413)
  })

  it('GET list + GET candidate detail', async () => {
    const { id } = await (await app.request(`/jobs/${jobId}/candidates`, json({ name: 'Pat', text: 'abc' }))).json()
    const list = await (await app.request(`/jobs/${jobId}/candidates`)).json()
    expect(list).toHaveLength(1)
    const detail = await (await app.request(`/candidates/${id}`)).json()
    expect(detail.extractedText).toBe('abc')
    expect((await app.request('/candidates/999')).status).toBe(404)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/routes.test.ts`
Expected: FAIL — `createApp` signature mismatch / routes missing.

- [ ] **Step 3: Write `src/server/routes.ts`**

```ts
import type { Hono } from 'hono'
import type { JobsDeps } from './jobs'
import * as jobs from './jobs'
import * as candidates from './candidates'
import { extractText, extOf } from './extract'
import { ConflictError, NotFoundError, ValidationError } from './errors'

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024 // spec section 3: 20 MB → 413

export function registerJobRoutes(app: Hono, deps: JobsDeps): void {
  app.onError((err, c) => {
    if (err instanceof ValidationError) return c.json({ error: err.message }, 400)
    if (err instanceof NotFoundError) return c.json({ error: err.message }, 404)
    if (err instanceof ConflictError) return c.json({ error: err.message }, 409)
    console.error(err)
    return c.json({ error: 'internal error' }, 500)
  })

  app.post('/jobs', async c => {
    const body = (await c.req.json()) as { name?: string; jd?: string }
    return c.json(jobs.createJob(deps, body.name ?? '', body.jd), 201)
  })

  app.get('/jobs', c => c.json(jobs.listJobs(deps)))

  app.get('/jobs/:id', c => c.json(jobs.getJob(deps, Number(c.req.param('id')))))

  app.patch('/jobs/:id', async c => {
    const body = (await c.req.json()) as { name?: string }
    return c.json(jobs.renameJob(deps, Number(c.req.param('id')), body.name ?? ''))
  })

  app.put('/jobs/:id/jd', async c => {
    const id = Number(c.req.param('id'))
    const ct = c.req.header('content-type') ?? ''
    if (ct.includes('multipart/form-data')) {
      const body = await c.req.parseBody()
      const file = body['file']
      if (!(file instanceof File)) throw new ValidationError('a file field is required')
      if (file.size > MAX_UPLOAD_BYTES) return c.json({ error: 'file too large (max 20 MB)' }, 413)
      const result = await extractText(new Uint8Array(await file.arrayBuffer()), extOf(file.name))
      if ('error' in result) return c.json({ error: result.error }, 422)
      return c.json({ jd: jobs.setJd(deps, id, result.text) })
    }
    const body = (await c.req.json()) as { text?: string }
    if (typeof body.text !== 'string' || body.text.trim() === '') {
      throw new ValidationError('jd text is required')
    }
    return c.json({ jd: jobs.setJd(deps, id, body.text) })
  })

  app.post('/jobs/:id/candidates', async c => {
    const jobId = Number(c.req.param('id'))
    const ct = c.req.header('content-type') ?? ''
    if (ct.includes('multipart/form-data')) {
      const body = await c.req.parseBody()
      const file = body['file']
      if (!(file instanceof File)) throw new ValidationError('a file field is required')
      if (file.size > MAX_UPLOAD_BYTES) return c.json({ error: 'file too large (max 20 MB)' }, 413)
      const name = typeof body['name'] === 'string' ? (body['name'] as string) : undefined
      const detail = await candidates.addCandidateFromFile(
        deps, jobId, file.name, new Uint8Array(await file.arrayBuffer()), name
      )
      return c.json(detail, 201)
    }
    const body = (await c.req.json()) as { name?: string; text?: string }
    const detail = await candidates.addCandidateFromText(deps, jobId, body.name ?? '', body.text ?? '')
    return c.json(detail, 201)
  })

  app.get('/jobs/:id/candidates', c =>
    c.json(candidates.listCandidates(deps, Number(c.req.param('id'))))
  )

  app.get('/candidates/:id', c => c.json(candidates.getCandidate(deps, Number(c.req.param('id')))))
}
```

- [ ] **Step 4: Rewire `src/server/app.ts`** (full replacement — `paths` instead of `dataRoot`, routes mounted):

```ts
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { getSchemaVersion, type DB } from './db'
import type { JobpinPaths } from './paths'
import { registerJobRoutes } from './routes'

export interface AppDeps {
  db: DB
  paths: JobpinPaths
  version: string
}

/**
 * The local API. CORS is open because the renderer runs on a different
 * origin (file:// packaged, http://localhost:5173 in dev) and the server
 * itself only ever binds 127.0.0.1.
 */
export function createApp({ db, paths, version }: AppDeps): Hono {
  const startedAt = Date.now()
  const app = new Hono()
  app.use('*', cors())

  app.get('/health', c =>
    c.json({
      status: 'ok',
      schemaVersion: getSchemaVersion(db),
      dataDir: paths.dataRoot,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000)
    })
  )

  app.get('/version', c => c.json({ app: 'jobpin', version }))

  registerJobRoutes(app, { db, paths })
  return app
}
```

- [ ] **Step 5: Update the two existing consumers**

In `src/main/index.ts`, change the `createApp` call:

```ts
      const honoApp = createApp({ db, paths, version: app.getVersion() })
```

In `tests/app.test.ts`, update both `createApp` calls **and** add `getPaths`/`ensureScaffold` wiring:
replace `createApp({ db, dataRoot: tmp, version: '0.1.0' })` with:

```ts
    const app = createApp({ db, paths: getPaths(tmp), version: '0.1.0' })
```

and add to the imports: `import { getPaths } from '../src/server/paths'`.
(The `/health` assertions are unchanged — `dataDir` still reports the same directory.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- tests/routes.test.ts`
Expected: 8 tests PASS.

Run: `npm test` and `npm run typecheck`
Expected: whole suite + typecheck PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server/routes.ts src/server/app.ts src/main/index.ts tests/routes.test.ts tests/app.test.ts
git commit -m "feat: mount phase 1 REST routes with typed-error mapping and upload caps"
```

---

### Task 7: UI foundation — router, tokens, shell, api helper, openPath IPC

**Files:**
- Create: `src/renderer/src/styles/tokens.css`, `src/renderer/src/api.ts`, `src/renderer/src/components/Shell.tsx`, `src/renderer/src/pages/SystemPage.tsx`
- Modify: `src/renderer/src/App.tsx`, `src/renderer/src/main.tsx`, `src/renderer/src/env.d.ts`, `src/preload/index.ts`, `src/main/ipc.ts`

**Interfaces:**
- Consumes: `/health` route; preload bridge.
- Produces:
  - `window.jobpin.openPath(relativePath: string): Promise<void>` (IPC `jobpin:open-path`, containment-checked)
  - `api.ts`: `apiJson<T>(path: string, init?: RequestInit): Promise<T>` (throws `Error` with server message on non-2xx) and `apiUpload<T>(path: string, method: string, form: FormData): Promise<T>`
  - Routes: `/` (JobsPage placeholder for Task 8), `/jobs/:id`, `/candidates/:id`, `/system`.

- [ ] **Step 1: Install the router**

```bash
npm install -D react-router-dom
```

- [ ] **Step 2: IPC + preload + typing**

Append to `registerIpc` in `src/main/ipc.ts` (inside the function, after the existing handlers):

```ts
  ipcMain.handle('jobpin:open-path', async (_e, relativePath: string) => {
    const path = await import('node:path')
    const target = path.resolve(state.dataRoot, relativePath ?? '')
    const root = path.resolve(state.dataRoot)
    // Containment check: never open anything outside jobpin-data (spec section 7).
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new Error('path escapes the data folder')
    }
    await shell.openPath(target)
  })
```

In `src/preload/index.ts`, add to the `bridge` object:

```ts
  openPath: (relativePath: string): Promise<void> => ipcRenderer.invoke('jobpin:open-path', relativePath)
```

In `src/renderer/src/env.d.ts`, add to `JobpinBridge`:

```ts
  openPath(relativePath: string): Promise<void>
```

- [ ] **Step 3: Design tokens + api helper**

`src/renderer/src/styles/tokens.css`:

```css
:root {
  /* type */
  --font-sans: system-ui, 'Segoe UI', sans-serif;
  --text-xs: 12px; --text-sm: 13px; --text-md: 14px; --text-lg: 18px; --text-xl: 24px;
  /* spacing scale */
  --sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px; --sp-5: 24px; --sp-6: 32px;
  /* semantic colors */
  --c-bg: #f7f7f8; --c-surface: #ffffff; --c-border: #e3e3e6;
  --c-text: #1b1b1f; --c-text-2: #6b6b74;
  --c-accent: #2a5fd0; --c-accent-hover: #234fae;
  --c-ok: #1a7f37; --c-warn-bg: #fff4e0; --c-warn-text: #92600a;
  --c-danger: #c0392b;
  --c-sidebar-bg: #14141a; --c-sidebar-text: #d7d7de; --c-sidebar-muted: #8a8a95;
  --radius: 8px; --radius-sm: 6px;
}

* { box-sizing: border-box; }
body { margin: 0; font-family: var(--font-sans); font-size: var(--text-md); color: var(--c-text); background: var(--c-bg); }
button { font: inherit; cursor: pointer; }
input, textarea { font: inherit; }
code { font-size: var(--text-sm); }
```

`src/renderer/src/api.ts`:

```ts
let portPromise: Promise<number> | null = null
const port = (): Promise<number> => (portPromise ??= window.jobpin.getServerPort())

async function handle<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) throw new Error(body.error ?? `request failed (${res.status})`)
  return body as T
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const p = await port()
  const res = await fetch(`http://127.0.0.1:${p}${path}`, {
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init
  })
  return handle<T>(res)
}

export async function apiUpload<T>(path: string, method: string, form: FormData): Promise<T> {
  const p = await port()
  const res = await fetch(`http://127.0.0.1:${p}${path}`, { method, body: form })
  return handle<T>(res)
}
```

- [ ] **Step 4: Shell, SystemPage, router**

`src/renderer/src/components/Shell.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { apiJson } from '../api'

interface Health { status: string; schemaVersion: number; dataDir: string }

export default function Shell() {
  const [health, setHealth] = useState<Health | null>(null)
  useEffect(() => {
    let cancelled = false
    let timer: number | undefined
    async function tick() {
      try {
        const h = await apiJson<Health>('/health')
        if (!cancelled) setHealth(h)
      } catch {
        if (!cancelled) setHealth(null)
      }
      if (!cancelled) timer = window.setTimeout(tick, 5000)
    }
    tick()
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [])

  const ok = health?.status === 'ok'
  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <aside style={{
        width: 220, flexShrink: 0, background: 'var(--c-sidebar-bg)', color: 'var(--c-sidebar-text)',
        display: 'flex', flexDirection: 'column', padding: 'var(--sp-4)'
      }}>
        <div style={{ fontSize: 'var(--text-lg)', fontWeight: 700, marginBottom: 'var(--sp-6)' }}>Jobpin</div>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)' }}>
          <NavLink to="/" style={({ isActive }) => ({
            padding: 'var(--sp-2) var(--sp-3)', borderRadius: 'var(--radius-sm)', textDecoration: 'none',
            color: isActive ? '#fff' : 'var(--c-sidebar-text)',
            background: isActive ? 'rgba(255,255,255,0.12)' : 'transparent'
          })}>Jobs</NavLink>
        </nav>
        <div style={{ marginTop: 'auto', fontSize: 'var(--text-xs)', color: 'var(--c-sidebar-muted)' }}>
          <NavLink to="/system" style={{ color: 'inherit', textDecoration: 'none' }}>
            <span style={{ color: ok ? 'var(--c-ok)' : 'var(--c-danger)' }}>●</span>{' '}
            {ok ? 'local server running' : 'server unavailable'}
          </NavLink>
          {health && (
            <div style={{ marginTop: 'var(--sp-2)', cursor: 'pointer' }}
                 onClick={() => window.jobpin.openPath('')}
                 title={health.dataDir}>
              📁 your data folder
            </div>
          )}
        </div>
      </aside>
      <main style={{ flex: 1, overflow: 'auto', padding: 'var(--sp-6)' }}>
        <Outlet />
      </main>
    </div>
  )
}
```

`src/renderer/src/pages/SystemPage.tsx` (the Phase 0 status content, relocated):

```tsx
import { useEffect, useState } from 'react'
import { apiJson } from '../api'

interface Health { status: string; schemaVersion: number; dataDir: string; uptimeSeconds: number }
interface AppInfo { version: string; dataDir: string }

export default function SystemPage() {
  const [health, setHealth] = useState<Health | null>(null)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.jobpin.getAppInfo().then(setInfo)
    apiJson<Health>('/health').then(setHealth).catch(e => setError(e.message))
  }, [])

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>System</h1>
      {info && <p>Jobpin v{info.version}</p>}
      <p>Local server: <strong style={{ color: health ? 'var(--c-ok)' : 'var(--c-danger)' }}>
        {health ? 'running' : error ?? 'checking…'}</strong></p>
      {health && <p>Database schema: v{health.schemaVersion} · uptime {health.uptimeSeconds}s</p>}
      {info && (
        <p>Your data: <code>{info.dataDir}</code>{' '}
          <button onClick={() => window.jobpin.openPath('')}>Open folder</button></p>
      )}
    </div>
  )
}
```

`src/renderer/src/App.tsx` (full replacement — HashRouter is required because production loads over `file://`):

```tsx
import { HashRouter, Route, Routes } from 'react-router-dom'
import Shell from './components/Shell'
import SystemPage from './pages/SystemPage'
import JobsPage from './pages/JobsPage'
import JobDetailPage from './pages/JobDetailPage'
import CandidatePage from './pages/CandidatePage'

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route path="/" element={<JobsPage />} />
          <Route path="/jobs/:id" element={<JobDetailPage />} />
          <Route path="/candidates/:id" element={<CandidatePage />} />
          <Route path="/system" element={<SystemPage />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}
```

`src/renderer/src/main.tsx` — add the tokens import as the first line of imports:

```tsx
import './styles/tokens.css'
```

Create **placeholder pages** so this task typechecks before Task 8 fills them in —
`src/renderer/src/pages/JobsPage.tsx`, `JobDetailPage.tsx`, `CandidatePage.tsx`, each:

```tsx
export default function JobsPage() {
  return <h1 style={{ marginTop: 0 }}>Jobs</h1>
}
```

(adjust the component/heading name per file: `JobDetailPage`/`Job`, `CandidatePage`/`Candidate`).

- [ ] **Step 5: Verify**

Run: `npm run typecheck` — Expected: PASS.
Run: `npm test` — Expected: whole suite PASS (nothing server-side changed).
Run: `npm run dev` — Expected: window shows the dark sidebar shell with a green "local server running" dot; "Jobs" navigates to the placeholder; `/system` (click the status dot) shows version/schema/uptime and "Open folder" opens Explorer at `jobpin-data`. Stop the app.

- [ ] **Step 6: Commit**

```bash
git add src/renderer src/preload/index.ts src/main/ipc.ts package.json package-lock.json
git commit -m "feat: add routed app shell with design tokens, api helper, and contained openPath IPC"
```

---

### Task 8: UI pages — Jobs, Job detail, Candidate

**Files:**
- Create: `src/renderer/src/components/StatusBadge.tsx`
- Modify (replace placeholders): `src/renderer/src/pages/JobsPage.tsx`, `src/renderer/src/pages/JobDetailPage.tsx`, `src/renderer/src/pages/CandidatePage.tsx`

**Interfaces:**
- Consumes: `apiJson`, `apiUpload` (Task 7); REST routes (Task 6); `window.jobpin.openPath`.
- Produces: the Phase 1 user experience. Consult the **frontend-design skill** while implementing for spacing/typography judgment; the code below is the functional baseline.

- [ ] **Step 1: `StatusBadge.tsx`**

```tsx
export default function StatusBadge({ status }: { status: string }) {
  const needsReview = status === 'needs_review'
  return (
    <span style={{
      fontSize: 'var(--text-xs)', fontWeight: 600, padding: '2px 8px', borderRadius: 999,
      background: needsReview ? 'var(--c-warn-bg)' : '#e8f0fe',
      color: needsReview ? 'var(--c-warn-text)' : 'var(--c-accent)'
    }}>
      {needsReview ? 'needs review' : status}
    </span>
  )
}
```

- [ ] **Step 2: `JobsPage.tsx`** (full replacement)

```tsx
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiJson } from '../api'

interface JobSummary { id: number; name: string; candidateCount: number; createdAt: string }

export default function JobsPage() {
  const [jobs, setJobs] = useState<JobSummary[] | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [jd, setJd] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(() => {
    apiJson<JobSummary[]>('/jobs').then(setJobs).catch(e => setError(e.message))
  }, [])
  useEffect(refresh, [refresh])

  async function create() {
    setBusy(true); setError(null)
    try {
      await apiJson('/jobs', { method: 'POST', body: JSON.stringify({ name, jd: jd || undefined }) })
      setName(''); setJd(''); setShowForm(false); refresh()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h1 style={{ marginTop: 0 }}>Jobs</h1>
        <button onClick={() => setShowForm(v => !v)} style={{
          background: 'var(--c-accent)', color: '#fff', border: 'none',
          padding: 'var(--sp-2) var(--sp-4)', borderRadius: 'var(--radius-sm)'
        }}>New job</button>
      </div>

      {error && <p style={{ color: 'var(--c-danger)' }}>{error}</p>}

      {showForm && (
        <div style={{
          background: 'var(--c-surface)', border: '1px solid var(--c-border)',
          borderRadius: 'var(--radius)', padding: 'var(--sp-4)', marginBottom: 'var(--sp-5)'
        }}>
          <label style={{ display: 'block', fontWeight: 600, marginBottom: 'var(--sp-3)' }}>
            Job name
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Sales Manager / 销售经理"
              style={{ display: 'block', width: '100%', marginTop: 4, padding: 'var(--sp-2)',
                       border: '1px solid var(--c-border)', borderRadius: 'var(--radius-sm)' }} />
          </label>
          <label style={{ display: 'block', fontWeight: 600, marginBottom: 'var(--sp-3)' }}>
            Job description (optional — you can add it later)
            <textarea value={jd} onChange={e => setJd(e.target.value)} rows={6}
              style={{ display: 'block', width: '100%', marginTop: 4, padding: 'var(--sp-2)',
                       border: '1px solid var(--c-border)', borderRadius: 'var(--radius-sm)' }} />
          </label>
          <button disabled={busy || !name.trim()} onClick={create} style={{
            background: 'var(--c-accent)', color: '#fff', border: 'none',
            padding: 'var(--sp-2) var(--sp-4)', borderRadius: 'var(--radius-sm)', opacity: busy || !name.trim() ? 0.5 : 1
          }}>{busy ? 'Creating…' : 'Create job'}</button>
        </div>
      )}

      {jobs === null ? <p style={{ color: 'var(--c-text-2)' }}>Loading…</p> :
        jobs.length === 0 ? (
          <p style={{ color: 'var(--c-text-2)' }}>No jobs yet — create your first one to start hiring.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
            {jobs.map(j => (
              <Link key={j.id} to={`/jobs/${j.id}`} style={{
                display: 'flex', justifyContent: 'space-between', textDecoration: 'none', color: 'inherit',
                background: 'var(--c-surface)', border: '1px solid var(--c-border)',
                borderRadius: 'var(--radius)', padding: 'var(--sp-4)'
              }}>
                <strong>{j.name}</strong>
                <span style={{ color: 'var(--c-text-2)' }}>
                  {j.candidateCount} candidate{j.candidateCount === 1 ? '' : 's'}
                </span>
              </Link>
            ))}
          </div>
        )}
    </div>
  )
}
```

- [ ] **Step 3: `JobDetailPage.tsx`** (full replacement)

```tsx
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { Link, useParams } from 'react-router-dom'
import { apiJson, apiUpload } from '../api'
import StatusBadge from '../components/StatusBadge'

interface JobDetail { id: number; name: string; folderPath: string; jd: string | null; createdAt: string }
interface CandidateSummary { id: number; name: string; status: string; createdAt: string }

export default function JobDetailPage() {
  const { id } = useParams()
  const jobId = Number(id)
  const [job, setJob] = useState<JobDetail | null>(null)
  const [cands, setCands] = useState<CandidateSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [newName, setNewName] = useState('')
  const [editingJd, setEditingJd] = useState(false)
  const [jdDraft, setJdDraft] = useState('')
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteName, setPasteName] = useState('')
  const [pasteText, setPasteText] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const refresh = useCallback(() => {
    apiJson<JobDetail>(`/jobs/${jobId}`).then(setJob).catch(e => setError(e.message))
    apiJson<CandidateSummary[]>(`/jobs/${jobId}/candidates`).then(setCands).catch(() => {})
  }, [jobId])
  useEffect(refresh, [refresh])

  async function run(fn: () => Promise<unknown>) {
    setError(null)
    try { await fn(); refresh() } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }

  const rename = () => run(async () => {
    await apiJson(`/jobs/${jobId}`, { method: 'PATCH', body: JSON.stringify({ name: newName }) })
    setRenaming(false)
  })

  const saveJd = () => run(async () => {
    await apiJson(`/jobs/${jobId}/jd`, { method: 'PUT', body: JSON.stringify({ text: jdDraft }) })
    setEditingJd(false)
  })

  const addFiles = (files: FileList | File[]) => run(async () => {
    for (const f of Array.from(files)) {
      const fd = new FormData()
      fd.append('file', f)
      await apiUpload(`/jobs/${jobId}/candidates`, 'POST', fd)
    }
  })

  const addPaste = () => run(async () => {
    await apiJson(`/jobs/${jobId}/candidates`, {
      method: 'POST', body: JSON.stringify({ name: pasteName, text: pasteText })
    })
    setPasteName(''); setPasteText(''); setPasteOpen(false)
  })

  if (!job) return <p style={{ color: 'var(--c-text-2)' }}>{error ?? 'Loading…'}</p>

  const card: CSSProperties = {
    background: 'var(--c-surface)', border: '1px solid var(--c-border)',
    borderRadius: 'var(--radius)', padding: 'var(--sp-4)', marginBottom: 'var(--sp-5)'
  }

  return (
    <div style={{ maxWidth: 820 }}>
      <p style={{ marginTop: 0 }}><Link to="/">← Jobs</Link></p>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--sp-3)' }}>
        {renaming ? (
          <>
            <input value={newName} onChange={e => setNewName(e.target.value)}
              style={{ fontSize: 'var(--text-xl)', fontWeight: 700, padding: 'var(--sp-1) var(--sp-2)' }} />
            <button onClick={rename} disabled={!newName.trim()}>Save</button>
            <button onClick={() => setRenaming(false)}>Cancel</button>
          </>
        ) : (
          <>
            <h1 style={{ margin: 0 }}>{job.name}</h1>
            <button onClick={() => { setNewName(job.name); setRenaming(true) }}
              style={{ border: 'none', background: 'none', color: 'var(--c-accent)' }}>rename</button>
          </>
        )}
      </div>
      {error && <p style={{ color: 'var(--c-danger)' }}>{error}</p>}

      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontSize: 'var(--text-lg)' }}>Job description</h2>
          {!editingJd && (
            <button onClick={() => { setJdDraft(job.jd ?? ''); setEditingJd(true) }}
              style={{ border: 'none', background: 'none', color: 'var(--c-accent)' }}>
              {job.jd ? 'edit' : 'add JD'}
            </button>
          )}
        </div>
        {editingJd ? (
          <div style={{ marginTop: 'var(--sp-3)' }}>
            <textarea value={jdDraft} onChange={e => setJdDraft(e.target.value)} rows={10}
              style={{ width: '100%', padding: 'var(--sp-2)', border: '1px solid var(--c-border)', borderRadius: 'var(--radius-sm)' }} />
            <button onClick={saveJd} disabled={!jdDraft.trim()}>Save JD</button>{' '}
            <button onClick={() => setEditingJd(false)}>Cancel</button>
          </div>
        ) : job.jd ? (
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 'var(--sp-3) 0 0' }}>{job.jd}</pre>
        ) : (
          <p style={{ color: 'var(--c-text-2)', marginBottom: 0 }}>No JD yet.</p>
        )}
      </div>

      <div style={card}>
        <h2 style={{ margin: '0 0 var(--sp-3)', fontSize: 'var(--text-lg)' }}>Add candidates</h2>
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files) }}
          onClick={() => fileInput.current?.click()}
          style={{
            border: `2px dashed ${dragOver ? 'var(--c-accent)' : 'var(--c-border)'}`,
            borderRadius: 'var(--radius)', padding: 'var(--sp-6)', textAlign: 'center',
            color: 'var(--c-text-2)', cursor: 'pointer', marginBottom: 'var(--sp-3)'
          }}>
          Drop resumes here (PDF / DOCX / TXT / MD), or click to choose files
          <input ref={fileInput} type="file" multiple hidden accept=".pdf,.docx,.txt,.md"
            onChange={e => e.target.files && addFiles(e.target.files)} />
        </div>
        <button onClick={() => setPasteOpen(v => !v)}
          style={{ border: 'none', background: 'none', color: 'var(--c-accent)' }}>
          …or paste resume text
        </button>
        {pasteOpen && (
          <div style={{ marginTop: 'var(--sp-3)' }}>
            <input value={pasteName} onChange={e => setPasteName(e.target.value)} placeholder="Candidate name (required)"
              style={{ display: 'block', width: '100%', padding: 'var(--sp-2)', marginBottom: 'var(--sp-2)',
                       border: '1px solid var(--c-border)', borderRadius: 'var(--radius-sm)' }} />
            <textarea value={pasteText} onChange={e => setPasteText(e.target.value)} rows={8} placeholder="Paste the resume text"
              style={{ display: 'block', width: '100%', padding: 'var(--sp-2)', marginBottom: 'var(--sp-2)',
                       border: '1px solid var(--c-border)', borderRadius: 'var(--radius-sm)' }} />
            <button onClick={addPaste} disabled={!pasteName.trim() || !pasteText.trim()}>Add candidate</button>
          </div>
        )}
      </div>

      <div style={card}>
        <h2 style={{ margin: '0 0 var(--sp-3)', fontSize: 'var(--text-lg)' }}>Candidates ({cands.length})</h2>
        {cands.length === 0 ? (
          <p style={{ color: 'var(--c-text-2)', margin: 0 }}>None yet — drop some resumes above.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {cands.map(c => (
              <Link key={c.id} to={`/candidates/${c.id}`} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: 'var(--sp-3) 0', borderTop: '1px solid var(--c-border)',
                textDecoration: 'none', color: 'inherit'
              }}>
                <span>{c.name}</span>
                <StatusBadge status={c.status} />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: `CandidatePage.tsx`** (full replacement)

```tsx
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { apiJson } from '../api'
import StatusBadge from '../components/StatusBadge'

interface CandidateDetail {
  id: number; jobId: number; name: string; email: string | null; phone: string | null
  status: string; extractedText: string | null
  extraction: { status: 'ok' | 'failed'; error?: string }
  originalFilename?: string; folderPath: string; createdAt: string
}

export default function CandidatePage() {
  const { id } = useParams()
  const [c, setC] = useState<CandidateDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    apiJson<CandidateDetail>(`/candidates/${Number(id)}`).then(setC).catch(e => setError(e.message))
  }, [id])

  if (!c) return <p style={{ color: 'var(--c-text-2)' }}>{error ?? 'Loading…'}</p>

  return (
    <div style={{ maxWidth: 820 }}>
      <p style={{ marginTop: 0 }}><Link to={`/jobs/${c.jobId}`}>← back to job</Link></p>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--sp-3)' }}>
        <h1 style={{ margin: 0 }}>{c.name}</h1>
        <StatusBadge status={c.status} />
        <button onClick={() => window.jobpin.openPath(c.folderPath)}
          style={{ marginLeft: 'auto', border: '1px solid var(--c-border)', background: 'var(--c-surface)',
                   padding: 'var(--sp-1) var(--sp-3)', borderRadius: 'var(--radius-sm)' }}>
          Open folder
        </button>
      </div>
      <p style={{ color: 'var(--c-text-2)' }}>
        {c.originalFilename ? `from ${c.originalFilename} · ` : ''}added {c.createdAt.slice(0, 10)}
      </p>

      {c.extraction.status === 'failed' && (
        <div style={{ background: 'var(--c-warn-bg)', color: 'var(--c-warn-text)',
                      padding: 'var(--sp-3) var(--sp-4)', borderRadius: 'var(--radius)', marginBottom: 'var(--sp-4)' }}>
          Text could not be extracted: {c.extraction.error}. The original file is preserved — use
          "Open folder" to view it.
        </div>
      )}

      {c.extractedText && (
        <div style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)',
                      borderRadius: 'var(--radius)', padding: 'var(--sp-4)' }}>
          <h2 style={{ margin: '0 0 var(--sp-3)', fontSize: 'var(--text-lg)' }}>Resume text</h2>
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0 }}>{c.extractedText}</pre>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck` — Expected: PASS.
Run: `npm test` — Expected: whole suite PASS.
Run: `npm run dev` — manual checklist (all must hold):
1. Create job 「销售经理」 with a pasted JD → appears in list; folder `jobs\销售经理` exists with the full skeleton.
2. Drop `tests/fixtures/sample.pdf` on the drop zone → candidate "sample" appears with status `new`; candidate page shows extracted text.
3. Paste a resume with a name → candidate appears; page shows the pasted text.
4. Drop `tests/fixtures/corrupt.pdf` → candidate appears with a "needs review" badge; page shows the reason banner; "Open folder" opens the candidate folder containing the original.
5. Rename the job (with candidates present) → detail page still loads, candidate pages still load, folder renamed on disk.
6. Try creating a second job with the same name → inline 409 error message.

Stop the app.

- [ ] **Step 6: Commit**

```bash
git add src/renderer
git commit -m "feat: add jobs, job-detail, and candidate pages with upload/paste intake"
```

---

### Task 9: Final verification + README

**Files:**
- Modify: `README.md` (one line in the directory tree)

- [ ] **Step 1: Full verification**

Run: `npm test` — Expected: all tests PASS (≈48 across 10 files).
Run: `npm run typecheck` — Expected: PASS.
Walk the spec's acceptance criteria (section 11, items 1–7) against the dev app — every item must hold, including "all of the above offline" (disable network, relaunch, repeat item 2).

- [ ] **Step 2: README tree touch-up**

In `README.md`'s directory-structure block, update the `src/` line to reflect Phase 1:

```
src/                       the app: main / preload / renderer (routed UI) / server (jobs, candidates, extraction)
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: reflect phase 1 modules in README tree"
```

---

## Completion

Phase 1's PRD acceptance criteria map to: folder skeleton (Task 2 tests + manual 1) · upload with extraction (Tasks 4–6 tests + manual 2) · paste (Task 5–6 tests + manual 3) · corrupt file → visible needs_review, never lost (Tasks 4–5 tests + manual 4) · rename with candidates (Task 3 tests + manual 5) · duplicate name 409 (Tasks 2/6 tests + manual 6) · offline through the routed shell (Task 9).

After the final task: per `CLAUDE.md`, write the Phase 1 handover to `docs/handover/`, append any implementation decisions to `DECISIONS.md`, and update the PRD Phase 1 brief to "complete" — then finishing-a-development-branch.
