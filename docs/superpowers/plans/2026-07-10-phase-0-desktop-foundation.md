# Phase 0 — Desktop Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A launchable, installable Electron skeleton: on startup it scaffolds `~/jobpin-data`, opens/migrates a SQLite DB containing all 13 PRD tables, starts an embedded Hono server on `127.0.0.1:<os-assigned port>`, and shows a status window — all offline, packaged as a Windows NSIS installer.

**Architecture:** Single-package TypeScript project (electron-vite layout). The entire persistence + HTTP layer lives in `src/server/` and **never imports Electron** — it is plain Node code, unit-tested with Vitest, and hosted by the Electron main process in production. Renderer talks to the main process only through a 3-method preload bridge; all future feature traffic goes renderer → HTTP → localhost.

**Tech Stack:** Electron + electron-vite + electron-builder (NSIS) · React 18+ + TypeScript (strict) · Hono + @hono/node-server · better-sqlite3 · Vitest.

**Spec:** `docs/superpowers/specs/2026-07-10-phase-0-desktop-foundation-design.md` (approved). Decisions: D-14, D-21, D-22 in `DECISIONS.md`.

## Global Constraints

- **npm** is the package manager. Install deps with `@latest`-style ranges; `package-lock.json` pins exact versions. Node: current LTS (`.nvmrc` = `22`, `engines.node >= 22`).
- **TypeScript strict mode everywhere.** No `any` unless annotated with a reason.
- **`src/server/**` must never import `'electron'`.** It receives paths/config from its caller.
- The HTTP server binds **`127.0.0.1` only**, port `0` (OS-assigned). Never `0.0.0.0`.
- Any `*_path` value stored in the DB is **relative to the `jobpin-data/` root** (Phase 0 stores none; the convention is documented in the schema task).
- **Never overwrite existing files** in `jobpin-data/` — scaffold creates only what's missing.
- **No `ON DELETE CASCADE` anywhere.** `rankings`/`ranking_items` get immutability triggers (ABORT on UPDATE/DELETE).
- **Native-module ABI rule:** `postinstall` runs `electron-builder install-app-deps`, so `node_modules` holds the **Electron-ABI** build of better-sqlite3. Therefore ALL test runs go through `npm test` (which runs Vitest under `ELECTRON_RUN_AS_NODE=1 electron`) — **never run `npx vitest` directly**; it would load the wrong ABI and crash.
- Tests must set `JOBPIN_DATA_DIR` to a fresh temp dir (or pass explicit paths) — never touch the real `~/jobpin-data`.
- Windows dev machine: every command below works in PowerShell. Use `cross-env` inside npm scripts for env vars.
- Conventional commits (`feat:`/`fix:`/`chore:`/`docs:`/`test:`); commit at the end of every task.

## File Structure (end state)

```
jobpin/ (repo root)
├── package.json · package-lock.json · .nvmrc
├── electron.vite.config.ts · vitest.config.ts · electron-builder.yml
├── tsconfig.json · tsconfig.node.json · tsconfig.web.json
├── .gitignore                    (rewritten for the Node/Electron project)
├── src/
│   ├── main/index.ts             # lifecycle, startup sequence, error dialogs
│   ├── main/ipc.ts               # ipcMain handlers
│   ├── preload/index.ts          # contextBridge: window.jobpin
│   ├── renderer/index.html
│   ├── renderer/src/main.tsx
│   ├── renderer/src/App.tsx      # status screen
│   ├── renderer/src/env.d.ts     # window.jobpin typing
│   └── server/                   # Electron-free, fully unit-tested
│       ├── paths.ts              # data-root resolution + derived paths
│       ├── scaffold.ts           # first-run tree creation (never overwrites)
│       ├── db.ts                 # openDatabase, Migration type, runMigrations, getSchemaVersion
│       ├── migrations/0001_init.ts   # full DDL: 13 tables + indices + triggers
│       ├── migrations/index.ts       # ordered migration list
│       ├── app.ts                # createApp({db,dataRoot,version}) → Hono (/health, /version)
│       └── serve.ts              # startServer(app) → {port, close}
├── tests/
│   ├── paths.test.ts · scaffold.test.ts · db.test.ts · schema.test.ts · app.test.ts
├── resources/                    # (empty in Phase 0; electron-builder buildResources)
└── docs/phase0-install-checklist.md
```

---

### Task 1: Project scaffold — tooling boots end to end

**Files:**
- Create: `package.json`, `.nvmrc`, `electron.vite.config.ts`, `vitest.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`
- Create (placeholders, replaced in Task 7): `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/index.html`, `src/renderer/src/main.tsx`, `src/renderer/src/App.tsx`, `src/renderer/src/env.d.ts`
- Modify: `.gitignore` (full rewrite — old contents are Shortlist-era)

**Interfaces:**
- Produces: a repo where `npm install`, `npm test`, `npm run typecheck`, `npm run build`, and `npm run dev` all succeed. Scripts other tasks rely on: `test`, `typecheck`, `build`, `dev`, `dist`.

- [ ] **Step 1: Write config files**

`package.json`:

```json
{
  "name": "jobpin",
  "version": "0.1.0",
  "private": true,
  "description": "Jobpin - local-first hiring workbench (boss-only desktop app)",
  "main": "./out/main/index.js",
  "engines": { "node": ">=22" },
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "typecheck": "tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json",
    "test": "cross-env ELECTRON_RUN_AS_NODE=1 electron ./node_modules/vitest/vitest.mjs run",
    "test:watch": "cross-env ELECTRON_RUN_AS_NODE=1 electron ./node_modules/vitest/vitest.mjs",
    "postinstall": "electron-builder install-app-deps",
    "dist": "electron-vite build && electron-builder --win"
  }
}
```

`.nvmrc`:

```
22
```

`electron.vite.config.ts`:

```ts
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: { plugins: [react()] }
})
```

`vitest.config.ts` (`pool: 'forks'` so workers run as child processes of the Electron-as-Node runtime; `passWithNoTests` so this task's empty suite is green):

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    pool: 'forks',
    passWithNoTests: true
  }
})
```

`tsconfig.json`:

```json
{ "files": [], "references": [{ "path": "./tsconfig.node.json" }, { "path": "./tsconfig.web.json" }] }
```

`tsconfig.node.json`:

```json
{
  "compilerOptions": {
    "composite": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": [
    "src/main/**/*", "src/preload/**/*", "src/server/**/*",
    "tests/**/*", "electron.vite.config.ts", "vitest.config.ts"
  ]
}
```

`tsconfig.web.json`:

```json
{
  "compilerOptions": {
    "composite": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "skipLibCheck": true,
    "noEmit": true,
    "useDefineForClassFields": true
  },
  "include": ["src/renderer/src/**/*"]
}
```

`.gitignore` (full replacement — the current file only has Shortlist-era entries):

```
node_modules/
out/
dist/
.env
*.log
```

- [ ] **Step 2: Write placeholder app entries** (just enough for dev/build to run; Task 7 replaces them)

`src/main/index.ts`:

```ts
import { app, BrowserWindow } from 'electron'
import path from 'node:path'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 720,
    height: 480,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())
```

`src/preload/index.ts`:

```ts
// Placeholder - Task 7 exposes the real bridge.
export {}
```

`src/renderer/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Jobpin</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`src/renderer/src/main.tsx`:

```tsx
import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

`src/renderer/src/App.tsx`:

```tsx
export default function App() {
  return <h1>Jobpin</h1>
}
```

`src/renderer/src/env.d.ts`:

```ts
/// <reference types="vite/client" />
// Task 7 adds the window.jobpin bridge typing here.
```

- [ ] **Step 3: Install dependencies**

Run (from repo root):

```bash
npm install better-sqlite3 hono @hono/node-server
npm install -D electron electron-vite electron-builder vitest cross-env typescript react react-dom @vitejs/plugin-react @types/node @types/react @types/react-dom @types/better-sqlite3
```

Expected: installs succeed; the `postinstall` hook runs `electron-builder install-app-deps` and rebuilds/downloads the **Electron-ABI** better-sqlite3 binary (watch for a line mentioning `better-sqlite3` and the Electron version). If it compiles from source and fails, install "Visual Studio Build Tools – Desktop development with C++" and re-run `npm install`.

Note: `react`/`react-dom` are devDependencies on purpose — Vite bundles them into the renderer, so they don't need to ship in the asar as runtime deps. `better-sqlite3`, `hono`, `@hono/node-server` are runtime `dependencies` because the main process imports them un-bundled (externalized).

- [ ] **Step 4: Verify the toolchain end to end**

Run: `npm test`
Expected: Vitest banner, `No test files found`, exit code 0 (passWithNoTests). This also proves the ELECTRON_RUN_AS_NODE runner works.

Run: `npm run typecheck`
Expected: completes with no errors.

Run: `npm run build`
Expected: electron-vite builds `out/main/index.js`, `out/preload/index.js`, `out/renderer/index.html` without errors.

Run: `npm run dev`
Expected: an Electron window opens showing the heading "Jobpin". Close it (Ctrl+C in the terminal or close the window).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: scaffold Electron + electron-vite + React + TS project with vitest toolchain"
```

---

### Task 2: `paths.ts` — data-root resolution

**Files:**
- Create: `src/server/paths.ts`
- Test: `tests/paths.test.ts`

**Interfaces:**
- Produces:
  - `resolveDataRoot(env?: NodeJS.ProcessEnv): string` — `JOBPIN_DATA_DIR` override, else `join(os.homedir(), 'jobpin-data')`
  - `getPaths(dataRoot?: string): JobpinPaths`
  - `interface JobpinPaths { dataRoot; dbFile; companyDir; jobsDir; companyMemoryFile; valuesFile; bossPreferencesFile; legalTemplatesDir; onboardingTemplatesDir }` (all `string`)

- [ ] **Step 1: Write the failing test**

`tests/paths.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import { resolveDataRoot, getPaths } from '../src/server/paths'

describe('resolveDataRoot', () => {
  it('uses JOBPIN_DATA_DIR when set', () => {
    expect(resolveDataRoot({ JOBPIN_DATA_DIR: 'C:\\tmp\\jp' })).toBe('C:\\tmp\\jp')
  })

  it('ignores an empty JOBPIN_DATA_DIR', () => {
    expect(resolveDataRoot({ JOBPIN_DATA_DIR: '  ' })).toBe(path.join(os.homedir(), 'jobpin-data'))
  })

  it('defaults to <home>/jobpin-data (D-21)', () => {
    expect(resolveDataRoot({})).toBe(path.join(os.homedir(), 'jobpin-data'))
  })
})

describe('getPaths', () => {
  it('derives every path from the data root', () => {
    const p = getPaths('/root')
    expect(p.dataRoot).toBe('/root')
    expect(p.dbFile).toBe(path.join('/root', 'jobpin.db'))
    expect(p.companyDir).toBe(path.join('/root', 'company'))
    expect(p.jobsDir).toBe(path.join('/root', 'jobs'))
    expect(p.companyMemoryFile).toBe(path.join('/root', 'company', 'company_memory.md'))
    expect(p.valuesFile).toBe(path.join('/root', 'company', 'values.md'))
    expect(p.bossPreferencesFile).toBe(path.join('/root', 'company', 'boss_preferences.json'))
    expect(p.legalTemplatesDir).toBe(path.join('/root', 'company', 'legal_templates'))
    expect(p.onboardingTemplatesDir).toBe(path.join('/root', 'company', 'onboarding_templates'))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/paths.test.ts`
Expected: FAIL — cannot resolve `../src/server/paths`.

- [ ] **Step 3: Write the implementation**

`src/server/paths.ts`:

```ts
import os from 'node:os'
import path from 'node:path'

export interface JobpinPaths {
  dataRoot: string
  dbFile: string
  companyDir: string
  jobsDir: string
  companyMemoryFile: string
  valuesFile: string
  bossPreferencesFile: string
  legalTemplatesDir: string
  onboardingTemplatesDir: string
}

/** JOBPIN_DATA_DIR env override (tests, dev profiles), else <home>/jobpin-data (D-21). */
export function resolveDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.JOBPIN_DATA_DIR
  if (override && override.trim() !== '') return override
  return path.join(os.homedir(), 'jobpin-data')
}

export function getPaths(dataRoot: string = resolveDataRoot()): JobpinPaths {
  const companyDir = path.join(dataRoot, 'company')
  return {
    dataRoot,
    dbFile: path.join(dataRoot, 'jobpin.db'),
    companyDir,
    jobsDir: path.join(dataRoot, 'jobs'),
    companyMemoryFile: path.join(companyDir, 'company_memory.md'),
    valuesFile: path.join(companyDir, 'values.md'),
    bossPreferencesFile: path.join(companyDir, 'boss_preferences.json'),
    legalTemplatesDir: path.join(companyDir, 'legal_templates'),
    onboardingTemplatesDir: path.join(companyDir, 'onboarding_templates')
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/paths.test.ts`
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/paths.ts tests/paths.test.ts
git commit -m "feat: add jobpin-data path resolution with env override (D-21)"
```

---

### Task 3: `scaffold.ts` — first-run tree, never overwrites

**Files:**
- Create: `src/server/scaffold.ts`
- Test: `tests/scaffold.test.ts`

**Interfaces:**
- Consumes: `JobpinPaths`, `getPaths` from Task 2.
- Produces: `ensureScaffold(p: JobpinPaths): void` — creates the PRD 8.2 company/jobs tree; existing files are never modified.

- [ ] **Step 1: Write the failing test**

`tests/scaffold.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getPaths } from '../src/server/paths'
import { ensureScaffold } from '../src/server/scaffold'

let tmp: string

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jobpin-scaffold-'))
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('ensureScaffold', () => {
  it('creates the full first-run tree', () => {
    const p = getPaths(tmp)
    ensureScaffold(p)
    expect(fs.existsSync(p.companyDir)).toBe(true)
    expect(fs.existsSync(p.jobsDir)).toBe(true)
    expect(fs.existsSync(p.legalTemplatesDir)).toBe(true)
    expect(fs.existsSync(p.onboardingTemplatesDir)).toBe(true)
    expect(fs.readFileSync(p.companyMemoryFile, 'utf8')).toBe('')
    expect(fs.readFileSync(p.valuesFile, 'utf8')).toBe('')
    expect(JSON.parse(fs.readFileSync(p.bossPreferencesFile, 'utf8'))).toEqual({})
  })

  it('is idempotent and never overwrites existing files', () => {
    const p = getPaths(tmp)
    ensureScaffold(p)
    fs.writeFileSync(p.valuesFile, 'We value honesty.\n', 'utf8')
    fs.writeFileSync(p.bossPreferencesFile, '{"tone":"direct"}\n', 'utf8')
    ensureScaffold(p) // second run
    expect(fs.readFileSync(p.valuesFile, 'utf8')).toBe('We value honesty.\n')
    expect(fs.readFileSync(p.bossPreferencesFile, 'utf8')).toBe('{"tone":"direct"}\n')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/scaffold.test.ts`
Expected: FAIL — cannot resolve `../src/server/scaffold`.

- [ ] **Step 3: Write the implementation**

`src/server/scaffold.ts`:

```ts
import fs from 'node:fs'
import type { JobpinPaths } from './paths'

/**
 * First-run scaffold (PRD 8.2). Creates missing directories/files only -
 * existing user files are NEVER overwritten (PRD Phase 0 scope).
 */
export function ensureScaffold(p: JobpinPaths): void {
  const dirs = [p.dataRoot, p.companyDir, p.legalTemplatesDir, p.onboardingTemplatesDir, p.jobsDir]
  for (const dir of dirs) fs.mkdirSync(dir, { recursive: true })

  const seedFiles: Array<[string, string]> = [
    [p.companyMemoryFile, ''],
    [p.valuesFile, ''],
    [p.bossPreferencesFile, '{}\n']
  ]
  for (const [file, content] of seedFiles) {
    if (!fs.existsSync(file)) fs.writeFileSync(file, content, 'utf8')
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/scaffold.test.ts`
Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/scaffold.ts tests/scaffold.test.ts
git commit -m "feat: add first-run jobpin-data scaffold (idempotent, never overwrites)"
```

---

### Task 4: `db.ts` — open + pragmas + migration runner

**Files:**
- Create: `src/server/db.ts`
- Test: `tests/db.test.ts`

**Interfaces:**
- Produces:
  - `type DB = InstanceType<typeof Database>` (better-sqlite3 instance type)
  - `interface Migration { id: number; name: string; sql: string }`
  - `openDatabase(dbFile: string): DB` — WAL, `foreign_keys=ON`, `busy_timeout=5000`
  - `runMigrations(db: DB, migrations: Migration[]): void` — ids must be `1..n` gapless; applies pending in order, one transaction each, recorded in `migrations` table; throws on a DB newer than the app
  - `getSchemaVersion(db: DB): number` — max applied migration id, `0` if none

- [ ] **Step 1: Write the failing test**

`tests/db.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase, runMigrations, getSchemaVersion, type DB, type Migration } from '../src/server/db'

let tmp: string
let db: DB

const M1: Migration = { id: 1, name: 'create_a', sql: 'CREATE TABLE a (id INTEGER PRIMARY KEY);' }
const M2: Migration = { id: 2, name: 'create_b', sql: 'CREATE TABLE b (id INTEGER PRIMARY KEY);' }

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jobpin-db-'))
  db = openDatabase(path.join(tmp, 'test.db'))
})

afterEach(() => {
  db.close()
  fs.rmSync(tmp, { recursive: true, force: true })
})

function tableNames(d: DB): string[] {
  return (d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[])
    .map(r => r.name)
    .sort()
}

describe('openDatabase', () => {
  it('applies the required pragmas', () => {
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000)
  })
})

describe('runMigrations', () => {
  it('applies pending migrations in order and records them', () => {
    expect(getSchemaVersion(db)).toBe(0)
    runMigrations(db, [M1, M2])
    expect(getSchemaVersion(db)).toBe(2)
    expect(tableNames(db)).toEqual(['a', 'b', 'migrations'])
  })

  it('is a no-op when already up to date', () => {
    runMigrations(db, [M1, M2])
    runMigrations(db, [M1, M2])
    expect(getSchemaVersion(db)).toBe(2)
  })

  it('rolls back a failing migration atomically', () => {
    const bad: Migration = { id: 2, name: 'bad', sql: 'CREATE TABLE ok (id INTEGER); THIS IS NOT SQL;' }
    runMigrations(db, [M1])
    expect(() => runMigrations(db, [M1, bad])).toThrow()
    expect(getSchemaVersion(db)).toBe(1)
    expect(tableNames(db)).toEqual(['a', 'migrations'])
  })

  it('rejects gapped or misnumbered migration lists', () => {
    const m3: Migration = { id: 3, name: 'skip', sql: 'CREATE TABLE c (id INTEGER);' }
    expect(() => runMigrations(db, [M1, m3])).toThrow(/1\.\.n/)
  })

  it('fails loudly on a database newer than the app', () => {
    runMigrations(db, [M1, M2])
    expect(() => runMigrations(db, [M1])).toThrow(/newer than this app/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/db.test.ts`
Expected: FAIL — cannot resolve `../src/server/db`.

- [ ] **Step 3: Write the implementation**

`src/server/db.ts`:

```ts
import Database from 'better-sqlite3'

export type DB = InstanceType<typeof Database>

export interface Migration {
  id: number
  name: string
  sql: string
}

export function openDatabase(dbFile: string): DB {
  const db = new Database(dbFile)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  return db
}

function ensureMigrationsTable(db: DB): void {
  db.exec(
    'CREATE TABLE IF NOT EXISTS migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)'
  )
}

export function getSchemaVersion(db: DB): number {
  ensureMigrationsTable(db)
  const row = db.prepare('SELECT MAX(id) AS v FROM migrations').get() as { v: number | null }
  return row.v ?? 0
}

/**
 * Applies pending migrations in id order, each inside its own transaction.
 * - ids must be 1..n without gaps (defends against typos in the list)
 * - a DB "from the future" (boss downgraded the app) fails loudly (spec section 5)
 */
export function runMigrations(db: DB, migrations: Migration[]): void {
  ensureMigrationsTable(db)
  const sorted = [...migrations].sort((a, b) => a.id - b.id)
  sorted.forEach((m, i) => {
    if (m.id !== i + 1) {
      throw new Error(`migration ids must be 1..n without gaps; found id ${m.id} at position ${i + 1}`)
    }
  })

  const current = getSchemaVersion(db)
  if (current > sorted.length) {
    throw new Error(
      `database schema version ${current} is newer than this app understands (${sorted.length}). ` +
        'Update Jobpin instead of downgrading.'
    )
  }

  const record = db.prepare(
    "INSERT INTO migrations (id, name, applied_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))"
  )
  for (const m of sorted.filter(m => m.id > current)) {
    db.transaction(() => {
      db.exec(m.sql)
      record.run(m.id, m.name)
    })()
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/db.test.ts`
Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/db.ts tests/db.test.ts
git commit -m "feat: add sqlite open with pragmas and transactional migration runner"
```

---

### Task 5: Migration 0001 — all 13 tables, indices, immutability triggers

**Files:**
- Create: `src/server/migrations/0001_init.ts`, `src/server/migrations/index.ts`
- Test: `tests/schema.test.ts`

**Interfaces:**
- Consumes: `Migration`, `openDatabase`, `runMigrations` from Task 4.
- Produces: `migrations: Migration[]` (from `src/server/migrations/index.ts`) — the canonical ordered list the app runs at startup.

- [ ] **Step 1: Write the failing test**

`tests/schema.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase, runMigrations, getSchemaVersion, type DB } from '../src/server/db'
import { migrations } from '../src/server/migrations'

let tmp: string
let db: DB

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jobpin-schema-'))
  db = openDatabase(path.join(tmp, 'jobpin.db'))
  runMigrations(db, migrations)
})

afterEach(() => {
  db.close()
  fs.rmSync(tmp, { recursive: true, force: true })
})

const EXPECTED_TABLES = [
  'ai_analyses', 'candidate_documents', 'candidates', 'documents', 'emails',
  'interview_answers', 'interview_questions', 'interviews', 'jobs',
  'memory_events', 'migrations', 'ranking_items', 'rankings', 'settings'
].sort()

describe('migration 0001', () => {
  it('creates exactly the 13 PRD tables plus migrations bookkeeping', () => {
    const tables = (db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[]).map(r => r.name).sort()
    expect(tables).toEqual(EXPECTED_TABLES)
    expect(getSchemaVersion(db)).toBe(1)
  })

  it('creates an index on every FK column', () => {
    const indices = (db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'")
      .all() as { name: string }[]).map(r => r.name).sort()
    expect(indices).toEqual([
      'idx_ai_analyses_candidate_id', 'idx_ai_analyses_job_id',
      'idx_candidate_documents_candidate_id', 'idx_candidates_job_id',
      'idx_documents_candidate_id', 'idx_emails_candidate_id',
      'idx_interview_answers_question_id', 'idx_interview_questions_interview_id',
      'idx_interviews_candidate_id', 'idx_ranking_items_candidate_id',
      'idx_ranking_items_ranking_id', 'idx_rankings_job_id'
    ].sort())
  })

  it('enforces foreign keys', () => {
    expect(() =>
      db.prepare("INSERT INTO candidates (job_id, name) VALUES (999, 'ghost')").run()
    ).toThrow(/FOREIGN KEY/)
  })

  it('ranking snapshots are immutable: UPDATE and DELETE abort (PRD 11.1-5)', () => {
    db.prepare("INSERT INTO jobs (name, folder_path) VALUES ('Sales Manager', 'jobs/Sales Manager')").run()
    db.prepare("INSERT INTO candidates (job_id, name) VALUES (1, 'Alex')").run()
    db.prepare("INSERT INTO rankings (job_id, criteria, reason) VALUES (1, '[\"jd_fit\"]', 'initial')").run()
    db.prepare('INSERT INTO ranking_items (ranking_id, candidate_id, rank, score, reason) VALUES (1, 1, 1, 86.0, \'strong\')').run()

    expect(() => db.prepare("UPDATE rankings SET reason = 'edited' WHERE id = 1").run()).toThrow(/immutable/)
    expect(() => db.prepare('DELETE FROM rankings WHERE id = 1').run()).toThrow(/immutable/)
    expect(() => db.prepare('UPDATE ranking_items SET score = 99 WHERE id = 1').run()).toThrow(/immutable/)
    expect(() => db.prepare('DELETE FROM ranking_items WHERE id = 1').run()).toThrow(/immutable/)
  })

  it('inserts get ISO-8601 timestamps by default', () => {
    db.prepare("INSERT INTO jobs (name, folder_path) VALUES ('Barista', 'jobs/Barista')").run()
    const row = db.prepare('SELECT created_at FROM jobs WHERE name = ?').get('Barista') as { created_at: string }
    expect(row.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/schema.test.ts`
Expected: FAIL — cannot resolve `../src/server/migrations`.

- [ ] **Step 3: Write the migration**

`src/server/migrations/0001_init.ts` (conventions: INTEGER PK ids; ISO-8601 TEXT timestamps; index on every FK column; **no ON DELETE CASCADE** — deletion semantics are Phase 5/D-17; every `*_path` column stores a path **relative to the jobpin-data root**):

```ts
import type { Migration } from '../db'

export const migration0001: Migration = {
  id: 1,
  name: 'init',
  sql: `
-- ============ spec-defined tables (PRD section 8.1) ============

CREATE TABLE jobs (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,          -- one folder per job, named after the job (PRD 8.2)
  folder_path  TEXT NOT NULL,                 -- relative to jobpin-data root
  jd_path      TEXT,
  inject_path  TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE candidates (
  id           INTEGER PRIMARY KEY,
  job_id       INTEGER NOT NULL REFERENCES jobs(id),
  name         TEXT NOT NULL,
  email        TEXT,
  phone        TEXT,
  status       TEXT NOT NULL DEFAULT 'new',   -- vocabulary designed in Phase 1/2
  current_rank INTEGER,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_candidates_job_id ON candidates(job_id);

CREATE TABLE candidate_documents (
  id                   INTEGER PRIMARY KEY,
  candidate_id         INTEGER NOT NULL REFERENCES candidates(id),
  type                 TEXT NOT NULL,
  file_path            TEXT NOT NULL,
  extracted_text_path  TEXT,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_candidate_documents_candidate_id ON candidate_documents(candidate_id);

CREATE TABLE interviews (
  id              INTEGER PRIMARY KEY,
  candidate_id    INTEGER NOT NULL REFERENCES candidates(id),
  stage           INTEGER NOT NULL DEFAULT 1,
  mode            TEXT NOT NULL DEFAULT 'manual',   -- manual | voice (post-MVP)
  scheduled_at    TEXT,
  transcript_path TEXT,
  summary_path    TEXT,
  ai_score        REAL,
  boss_decision   TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_interviews_candidate_id ON interviews(candidate_id);

CREATE TABLE rankings (
  id         INTEGER PRIMARY KEY,
  job_id     INTEGER NOT NULL REFERENCES jobs(id),
  criteria   TEXT NOT NULL DEFAULT '[]',     -- JSON; beyond spec field list, required by F4.2 snapshot shape
  reason     TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_rankings_job_id ON rankings(job_id);

CREATE TABLE ranking_items (
  id           INTEGER PRIMARY KEY,
  ranking_id   INTEGER NOT NULL REFERENCES rankings(id),
  candidate_id INTEGER NOT NULL REFERENCES candidates(id),
  rank         INTEGER NOT NULL,
  score        REAL NOT NULL,
  reason       TEXT
);
CREATE INDEX idx_ranking_items_ranking_id ON ranking_items(ranking_id);
CREATE INDEX idx_ranking_items_candidate_id ON ranking_items(candidate_id);

CREATE TABLE memory_events (
  id               INTEGER PRIMARY KEY,
  scope            TEXT NOT NULL,            -- company | job | candidate
  scope_id         TEXT,
  source_type      TEXT,
  source_id        INTEGER,
  content          TEXT NOT NULL,
  approved_by_boss INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ============ tables deferred to Phase 0 design (spec section 5) ============

CREATE TABLE interview_questions (
  id           INTEGER PRIMARY KEY,
  interview_id INTEGER NOT NULL REFERENCES interviews(id),
  order_index  INTEGER NOT NULL,
  category     TEXT NOT NULL,                -- standard | resume | jd_risk | boss_favourite | followup
  text         TEXT NOT NULL,
  source       TEXT NOT NULL DEFAULT 'generated',  -- generated | question_bank | boss
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_interview_questions_interview_id ON interview_questions(interview_id);

CREATE TABLE interview_answers (
  id                    INTEGER PRIMARY KEY,
  interview_question_id INTEGER NOT NULL REFERENCES interview_questions(id),
  answer_text           TEXT,
  boss_note             TEXT,
  ai_comment            TEXT,
  confidence            REAL,
  affects_ranking       INTEGER NOT NULL DEFAULT 0,
  source                TEXT NOT NULL DEFAULT 'manual',  -- manual | stt (post-MVP)
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_interview_answers_question_id ON interview_answers(interview_question_id);

CREATE TABLE ai_analyses (
  id             INTEGER PRIMARY KEY,
  job_id         INTEGER REFERENCES jobs(id),
  candidate_id   INTEGER REFERENCES candidates(id),
  kind           TEXT NOT NULL,   -- candidate_analysis | interview_summary | question_generation | ranking_reason | skill_proposal
  provider       TEXT NOT NULL,
  model          TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  input_manifest TEXT NOT NULL DEFAULT '{}',  -- JSON: inputs (paths + hashes) per F3.2
  output_path    TEXT,                        -- big outputs live as files; DB is the index
  confidence     REAL,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_ai_analyses_job_id ON ai_analyses(job_id);
CREATE INDEX idx_ai_analyses_candidate_id ON ai_analyses(candidate_id);

CREATE TABLE emails (
  id           INTEGER PRIMARY KEY,
  candidate_id INTEGER NOT NULL REFERENCES candidates(id),
  type         TEXT NOT NULL,  -- invite_online | invite_onsite | reschedule | rejection | more_materials | onboarding
  file_path    TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_emails_candidate_id ON emails(candidate_id);

CREATE TABLE documents (
  id           INTEGER PRIMARY KEY,
  candidate_id INTEGER NOT NULL REFERENCES candidates(id),
  type         TEXT NOT NULL,  -- onboarding | legal | other
  file_path    TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_documents_candidate_id ON documents(candidate_id);

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ============ ranking-snapshot immutability (PRD invariant 11.1-5) ============
-- Phase 5 relaxes the delete triggers by migration when the candidate-deletion
-- policy (purge vs anonymise) is decided. Default-deny until then.

CREATE TRIGGER trg_rankings_immutable_update
BEFORE UPDATE ON rankings
BEGIN SELECT RAISE(ABORT, 'ranking snapshots are immutable'); END;

CREATE TRIGGER trg_rankings_immutable_delete
BEFORE DELETE ON rankings
BEGIN SELECT RAISE(ABORT, 'ranking snapshots are immutable'); END;

CREATE TRIGGER trg_ranking_items_immutable_update
BEFORE UPDATE ON ranking_items
BEGIN SELECT RAISE(ABORT, 'ranking snapshots are immutable'); END;

CREATE TRIGGER trg_ranking_items_immutable_delete
BEFORE DELETE ON ranking_items
BEGIN SELECT RAISE(ABORT, 'ranking snapshots are immutable'); END;
`
}
```

`src/server/migrations/index.ts`:

```ts
import type { Migration } from '../db'
import { migration0001 } from './0001_init'

/** Ordered list of all migrations. Append-only; never edit a shipped migration. */
export const migrations: Migration[] = [migration0001]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/schema.test.ts`
Expected: 5 tests PASS.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all tests across all files PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/migrations tests/schema.test.ts
git commit -m "feat: add migration 0001 - all 13 PRD tables, FK indices, snapshot immutability triggers"
```

---

### Task 6: Hono app + localhost server

**Files:**
- Create: `src/server/app.ts`, `src/server/serve.ts`
- Test: `tests/app.test.ts`

**Interfaces:**
- Consumes: `DB`, `getSchemaVersion` (Task 4); `migrations` (Task 5).
- Produces:
  - `createApp(deps: { db: DB; dataRoot: string; version: string }): Hono` — routes `GET /health`, `GET /version`, CORS enabled
  - `startServer(app: Hono): Promise<{ port: number; close: () => Promise<void> }>` — binds `127.0.0.1:0`

- [ ] **Step 1: Write the failing test**

`tests/app.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase, runMigrations, type DB } from '../src/server/db'
import { migrations } from '../src/server/migrations'
import { createApp } from '../src/server/app'
import { startServer } from '../src/server/serve'

let tmp: string
let db: DB

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jobpin-app-'))
  db = openDatabase(path.join(tmp, 'jobpin.db'))
  runMigrations(db, migrations)
})

afterEach(() => {
  db.close()
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('createApp', () => {
  it('GET /health reports ok, schema version and data root', async () => {
    const app = createApp({ db, dataRoot: tmp, version: '0.1.0' })
    const res = await app.request('/health')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('ok')
    expect(body.schemaVersion).toBe(1)
    expect(body.dataDir).toBe(tmp)
    expect(typeof body.uptimeSeconds).toBe('number')
  })

  it('GET /version reports app name and version', async () => {
    const app = createApp({ db, dataRoot: tmp, version: '0.1.0' })
    const res = await app.request('/version')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ app: 'jobpin', version: '0.1.0' })
  })
})

describe('startServer', () => {
  it('serves on an OS-assigned 127.0.0.1 port and closes cleanly', async () => {
    const app = createApp({ db, dataRoot: tmp, version: '0.1.0' })
    const { port, close } = await startServer(app)
    expect(port).toBeGreaterThan(0)
    const res = await fetch(`http://127.0.0.1:${port}/health`)
    expect(res.status).toBe(200)
    await close()
    await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/app.test.ts`
Expected: FAIL — cannot resolve `../src/server/app`.

- [ ] **Step 3: Write the implementation**

`src/server/app.ts`:

```ts
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { getSchemaVersion, type DB } from './db'

export interface AppDeps {
  db: DB
  dataRoot: string
  version: string
}

/**
 * The local API. CORS is open because the renderer runs on a different
 * origin (file:// packaged, http://localhost:5173 in dev) and the server
 * itself only ever binds 127.0.0.1 (spec section 3).
 */
export function createApp({ db, dataRoot, version }: AppDeps): Hono {
  const startedAt = Date.now()
  const app = new Hono()
  app.use('*', cors())

  app.get('/health', c =>
    c.json({
      status: 'ok',
      schemaVersion: getSchemaVersion(db),
      dataDir: dataRoot,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000)
    })
  )

  app.get('/version', c => c.json({ app: 'jobpin', version }))

  return app
}
```

`src/server/serve.ts`:

```ts
import { serve } from '@hono/node-server'
import type { Hono } from 'hono'

export interface RunningServer {
  port: number
  close: () => Promise<void>
}

/** Binds 127.0.0.1 on an OS-assigned port. Never a non-loopback interface. */
export function startServer(app: Hono): Promise<RunningServer> {
  return new Promise((resolve, reject) => {
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }, info => {
      resolve({
        port: info.port,
        close: () =>
          new Promise<void>((res, rej) => server.close(err => (err ? rej(err) : res())))
      })
    })
    server.on('error', reject)
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/app.test.ts`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/app.ts src/server/serve.ts tests/app.test.ts
git commit -m "feat: add hono app (/health, /version) and 127.0.0.1 ephemeral-port server"
```

---

### Task 7: Electron wiring — startup sequence, IPC bridge, status window

**Files:**
- Modify: `src/main/index.ts` (replace placeholder), `src/preload/index.ts` (replace placeholder), `src/renderer/src/App.tsx` (replace placeholder), `src/renderer/src/env.d.ts`
- Create: `src/main/ipc.ts`

**Interfaces:**
- Consumes: `getPaths`, `ensureScaffold`, `openDatabase`, `runMigrations`, `migrations`, `createApp`, `startServer` — exactly as produced by Tasks 2–6.
- Produces: preload bridge `window.jobpin`:
  - `getServerPort(): Promise<number>` (IPC channel `jobpin:server-port`)
  - `getAppInfo(): Promise<{ version: string; dataDir: string }>` (`jobpin:app-info`)
  - `openDataFolder(): Promise<void>` (`jobpin:open-data-folder`)

- [ ] **Step 1: Write the main-process wiring**

`src/main/ipc.ts`:

```ts
import { ipcMain, shell } from 'electron'

export interface IpcState {
  port: number
  dataRoot: string
  version: string
}

export function registerIpc(state: IpcState): void {
  ipcMain.handle('jobpin:server-port', () => state.port)
  ipcMain.handle('jobpin:app-info', () => ({ version: state.version, dataDir: state.dataRoot }))
  ipcMain.handle('jobpin:open-data-folder', async () => {
    await shell.openPath(state.dataRoot)
  })
}
```

`src/main/index.ts` (full replacement — the spec section 3 startup sequence):

```ts
import { app, BrowserWindow, dialog } from 'electron'
import path from 'node:path'
import { getPaths } from '../server/paths'
import { ensureScaffold } from '../server/scaffold'
import { openDatabase, runMigrations } from '../server/db'
import { migrations } from '../server/migrations'
import { createApp } from '../server/app'
import { startServer } from '../server/serve'
import { registerIpc } from './ipc'

let mainWindow: BrowserWindow | null = null

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 720,
    height: 480,
    title: 'Jobpin',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
  return win
}

// Spec section 3, step 1: single instance - second launch focuses the window.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    try {
      // Steps 2-3: paths + first-run scaffold (never overwrites).
      const paths = getPaths()
      ensureScaffold(paths)

      // Step 4: open DB, apply migrations.
      const db = openDatabase(paths.dbFile)
      runMigrations(db, migrations)

      // Step 5: start the localhost server on an OS-assigned port.
      const honoApp = createApp({ db, dataRoot: paths.dataRoot, version: app.getVersion() })
      const { port } = await startServer(honoApp)

      // Step 6: bridge + window.
      registerIpc({ port, dataRoot: paths.dataRoot, version: app.getVersion() })
      mainWindow = createWindow()
    } catch (err) {
      // Honesty-in-failure (spec section 3): plain-language dialog, clean exit.
      const message = err instanceof Error ? err.message : String(err)
      dialog.showErrorBox(
        'Jobpin failed to start',
        `${message}\n\nNothing was left half-initialized. ` +
          'Fix the problem above and start Jobpin again.'
      )
      app.exit(1)
    }
  })

  app.on('window-all-closed', () => app.quit())
}
```

`src/preload/index.ts`:

```ts
import { contextBridge, ipcRenderer } from 'electron'

const bridge = {
  getServerPort: (): Promise<number> => ipcRenderer.invoke('jobpin:server-port'),
  getAppInfo: (): Promise<{ version: string; dataDir: string }> =>
    ipcRenderer.invoke('jobpin:app-info'),
  openDataFolder: (): Promise<void> => ipcRenderer.invoke('jobpin:open-data-folder')
}

contextBridge.exposeInMainWorld('jobpin', bridge)

export type JobpinBridge = typeof bridge
```

`src/renderer/src/env.d.ts` (full replacement):

```ts
/// <reference types="vite/client" />

interface JobpinBridge {
  getServerPort(): Promise<number>
  getAppInfo(): Promise<{ version: string; dataDir: string }>
  openDataFolder(): Promise<void>
}

interface Window {
  jobpin: JobpinBridge
}
```

- [ ] **Step 2: Write the status screen**

`src/renderer/src/App.tsx` (full replacement):

```tsx
import { useEffect, useState } from 'react'

interface Health {
  status: string
  schemaVersion: number
  dataDir: string
  uptimeSeconds: number
}

interface AppInfo {
  version: string
  dataDir: string
}

export default function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<AppInfo | null>(null)

  useEffect(() => {
    let timer: number | undefined
    let cancelled = false

    async function tick() {
      try {
        const port = await window.jobpin.getServerPort()
        const res = await fetch(`http://127.0.0.1:${port}/health`)
        if (!res.ok) throw new Error(`health returned ${res.status}`)
        const body = (await res.json()) as Health
        if (!cancelled) {
          setHealth(body)
          setError(null)
        }
      } catch (e) {
        if (!cancelled) {
          setHealth(null)
          setError(e instanceof Error ? e.message : String(e))
        }
      }
      if (!cancelled) timer = window.setTimeout(tick, 3000)
    }

    window.jobpin.getAppInfo().then(setInfo)
    tick()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [])

  const ok = health?.status === 'ok'
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24, lineHeight: 1.7 }}>
      <h1 style={{ margin: 0 }}>Jobpin</h1>
      <p style={{ color: '#666', marginTop: 0 }}>
        Local hiring workbench{info ? ` — v${info.version}` : ''}
      </p>
      <p>
        Local server:{' '}
        <strong style={{ color: ok ? 'green' : 'crimson' }}>
          {ok ? 'running' : error ? `unavailable (${error})` : 'checking…'}
        </strong>
      </p>
      {health && <p>Database schema: v{health.schemaVersion}</p>}
      {info && (
        <p>
          Your data: <code>{info.dataDir}</code>{' '}
          <button onClick={() => window.jobpin.openDataFolder()}>Open folder</button>
        </p>
      )}
    </main>
  )
}
```

- [ ] **Step 3: Typecheck and run the full test suite**

Run: `npm run typecheck`
Expected: no errors.

Run: `npm test`
Expected: all tests PASS (nothing in this task changes `src/server/`).

- [ ] **Step 4: Manual dev verification**

Run: `npm run dev`

Checklist (all must hold):
1. Window opens titled "Jobpin"; server status turns **green "running"** within ~1s.
2. "Database schema: v1" is shown; data path shows `C:\Users\<you>\jobpin-data`.
3. "Open folder" opens Explorer at `jobpin-data` — confirm `company\` (with the three seed files + two template dirs), `jobs\`, and `jobpin.db` exist.
4. Launch `npm run dev` in a second terminal while the first is running: the existing window is focused; no second window. Stop the second attempt.
5. Failure path: stop the app, then run with an unwritable data dir:
   `npx cross-env JOBPIN_DATA_DIR=Q:\no\such\drive npm run dev` — expect the "Jobpin failed to start" error dialog and clean exit.

- [ ] **Step 5: Commit**

```bash
git add src/main src/preload src/renderer
git commit -m "feat: wire electron startup sequence, IPC bridge, and status window"
```

---

### Task 8: Packaging (NSIS), install checklist, README

**Files:**
- Create: `electron-builder.yml`, `docs/phase0-install-checklist.md`, `resources/.gitkeep`
- Modify: `README.md` (the "Run it" section)

**Interfaces:**
- Consumes: everything; this task ships it.
- Produces: `npm run dist` → `dist/Jobpin Setup 0.1.0.exe` (NSIS installer).

- [ ] **Step 1: Write the packaging config**

`electron-builder.yml`:

```yaml
appId: com.jobpin.desktop
productName: Jobpin
directories:
  output: dist
  buildResources: resources
files:
  - out/**
asarUnpack:
  - "**/node_modules/better-sqlite3/**"
win:
  target:
    - nsis
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
```

Create an empty `resources/.gitkeep` so the buildResources directory exists in git. (No custom icon in Phase 0 — electron-builder will warn and use the default Electron icon; that is accepted.)

- [ ] **Step 2: Build the installer**

Run: `npm run dist`
Expected: build completes; `dist/` contains `Jobpin Setup 0.1.0.exe`. Warnings about a default icon and about the app being unsigned are **expected** (Phase 0 ships unsigned, spec section 8).

- [ ] **Step 3: Write the install checklist**

`docs/phase0-install-checklist.md`:

```markdown
# Phase 0 — Packaged-Build Verification Checklist

Run this against the NSIS installer in `dist/` after `npm run dist`.
Phase 0 ships **unsigned**: Windows SmartScreen will warn ("Windows protected
your PC") — click "More info" → "Run anyway". Expected until a code-signing
certificate is purchased (pre-distribution to-do, D-14).

Tip: to test first-run behaviour without touching your real data, set the
environment variable `JOBPIN_DATA_DIR` to an empty folder before launching,
or temporarily rename your existing `%USERPROFILE%\jobpin-data`.

- [ ] 1. Run the installer. It offers a choice of install directory (oneClick: false).
- [ ] 2. Launch Jobpin from the Start Menu. The window opens.
- [ ] 3. Server status shows green "running"; "Database schema: v1".
- [ ] 4. "Open folder" opens `%USERPROFILE%\jobpin-data` in Explorer with:
      `company\company_memory.md`, `company\values.md`, `company\boss_preferences.json`,
      `company\legal_templates\`, `company\onboarding_templates\`, `jobs\`, `jobpin.db`.
- [ ] 5. Quit. Relaunch. Status is green again; no duplicate scaffold, files preserved
      (edit `values.md` before relaunch to confirm it is untouched).
- [ ] 6. Launch a second copy while one is running: the existing window is focused,
      no second window appears.
- [ ] 7. **Offline test:** disable Wi-Fi/Ethernet, relaunch: everything above still works.
- [ ] 8. Uninstall via Windows Settings. `%USERPROFILE%\jobpin-data` **must survive**
      uninstall (the boss's data is never the installer's to delete).
```

- [ ] **Step 4: Run the checklist against the packaged build**

Install `dist/Jobpin Setup 0.1.0.exe` on this machine and walk items 1–8. All must pass — item 3 in the packaged app also proves the better-sqlite3 Electron-ABI rebuild is correct (spec section 8 requires verifying in the packaged app, not just dev).

- [ ] **Step 5: Update the README**

In `README.md`, replace the "Run it" section (currently says "Nothing to run yet…") with:

```markdown
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
```

Also update the README status line ("**Status:** … There is no runnable application yet — implementation starts at PRD Phase 0.") to:

```markdown
**Status:** Phase 0 (desktop foundation) implemented — Electron shell, local
server, SQLite schema, jobpin-data scaffold, Windows installer. Phase 1 (job
workspace & candidate intake) is next: PRD section 10.
```

- [ ] **Step 6: Final full verification**

Run: `npm test`
Expected: all tests PASS.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add electron-builder.yml docs/phase0-install-checklist.md resources/.gitkeep README.md
git commit -m "feat: add NSIS packaging, packaged-build checklist, and README run instructions"
```

---

## Completion

Phase 0's PRD acceptance criteria map to: fresh install → app opens (Task 8 checklist 1–2) · server responds on localhost (Task 6 tests + checklist 3) · DB file exists with all 13 tables (Task 5 tests + checklist 4) · `jobpin-data/company/` scaffold created (Task 3 tests + checklist 4) · works offline (checklist 7).

After the final task: per `CLAUDE.md`, write the Phase 0 handover to `docs/handover/` and append any decisions made during implementation to `DECISIONS.md` before closing the phase.
