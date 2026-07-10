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
