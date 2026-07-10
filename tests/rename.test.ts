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
