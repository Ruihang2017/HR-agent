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
import { rmrfWithRetry } from './helpers'

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
  rmrfWithRetry(tmp)
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
