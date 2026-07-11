import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { getPaths, type JobpinPaths } from '../src/server/paths'
import { ensureScaffold } from '../src/server/scaffold'
import { openDatabase, runMigrations, type DB } from '../src/server/db'
import { migrations } from '../src/server/migrations'
import { createJob } from '../src/server/jobs'
import { addCandidateFromText, getCandidate } from '../src/server/candidates'
import { createInterview, addQuestion, type InterviewDeps } from '../src/server/interviews'
import { sweepCandidateFiles } from '../src/server/data-migrations'
import { encryptBuffer, FILE_MAGIC } from '../src/server/cryptx'
import { rmrfWithRetry } from './helpers'

let tmp: string
let db: DB
let paths: JobpinPaths
let key: Buffer

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jobpin-sweep-'))
  paths = getPaths(tmp)
  ensureScaffold(paths)
  db = openDatabase(paths.dbFile)
  runMigrations(db, migrations)
  key = randomBytes(32)
})

afterEach(() => {
  db.close()
  rmrfWithRetry(tmp)
})

function isJpe1(absPath: string): boolean {
  return fs.readFileSync(absPath).subarray(0, FILE_MAGIC.length).equals(FILE_MAGIC)
}

function listFilesRecursive(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listFilesRecursive(full))
    else if (entry.isFile()) out.push(full)
  }
  return out
}

describe('sweepCandidateFiles', () => {
  it('encrypts every plaintext candidate-tree file for every candidate, leaves jd.md untouched, and counts accurately', async () => {
    const job = createJob({ db, paths }, 'Barista', 'We need a friendly, reliable barista.')
    const c1 = await addCandidateFromText({ db, paths }, job.id, 'Pat', 'Ten years of sales.')
    const c2 = await addCandidateFromText({ db, paths }, job.id, 'Sam', 'Five years of retail.')

    const cand1Dir = path.join(tmp, job.folderPath, 'candidates', `candidate_${c1.id}`)
    const cand2Dir = path.join(tmp, job.folderPath, 'candidates', `candidate_${c2.id}`)
    const allFiles = [...listFilesRecursive(cand1Dir), ...listFilesRecursive(cand2Dir)]
    expect(allFiles.length).toBeGreaterThanOrEqual(6) // resume.md + resume_text.md + profile.json, x2 candidates
    for (const f of allFiles) expect(isJpe1(f)).toBe(false) // seeded plaintext (keyless writes)

    const result = sweepCandidateFiles({ db, paths, dataKey: key })
    expect(result).toEqual({ encrypted: allFiles.length, skipped: 0 })

    for (const f of allFiles) expect(isJpe1(f)).toBe(true)

    // Job-level file outside the candidate tree must never be touched by the sweep.
    const jdAbs = path.join(tmp, job.folderPath, 'jd.md')
    expect(isJpe1(jdAbs)).toBe(false)
    expect(fs.readFileSync(jdAbs, 'utf8')).toBe('We need a friendly, reliable barista.')

    // Services can read the swept files back through the seam once keyed.
    const detail = getCandidate({ db, paths, dataKey: key }, c1.id)
    expect(detail.extractedText).toBe('Ten years of sales.')
  })

  it('is idempotent: a second sweep re-encrypts nothing and reports every file as skipped', async () => {
    const job = createJob({ db, paths }, 'Barista', 'JD text')
    await addCandidateFromText({ db, paths }, job.id, 'Pat', 'Ten years of sales.')

    const first = sweepCandidateFiles({ db, paths, dataKey: key })
    expect(first.skipped).toBe(0)
    expect(first.encrypted).toBeGreaterThan(0)

    const second = sweepCandidateFiles({ db, paths, dataKey: key })
    expect(second).toEqual({ encrypted: 0, skipped: first.encrypted })
  })

  it('resumes correctly from a partial run: a pre-encrypted file is skipped, the rest are encrypted', async () => {
    const job = createJob({ db, paths }, 'Barista', 'JD text')
    const c = await addCandidateFromText({ db, paths }, job.id, 'Pat', 'Ten years of sales.')
    const candDir = path.join(tmp, job.folderPath, 'candidates', `candidate_${c.id}`)
    const allFiles = listFilesRecursive(candDir)
    expect(allFiles.length).toBeGreaterThanOrEqual(2)

    // Simulate a crash mid-sweep: one file already encrypted under the same key before the real sweep runs.
    const preEncrypted = allFiles[0]
    fs.writeFileSync(preEncrypted, encryptBuffer(key, fs.readFileSync(preEncrypted)))

    const result = sweepCandidateFiles({ db, paths, dataKey: key })
    expect(result).toEqual({ encrypted: allFiles.length - 1, skipped: 1 })
    for (const f of allFiles) expect(isJpe1(f)).toBe(true)

    const detail = getCandidate({ db, paths, dataKey: key }, c.id)
    expect(detail.extractedText).toBe('Ten years of sales.')
  })

  it('walks recursively into candidate subdirectories (e.g. interviews/)', async () => {
    const job = createJob({ db, paths }, 'Barista', 'JD text')
    const c = await addCandidateFromText({ db, paths }, job.id, 'Pat', 'Ten years of sales.')
    const interviewDeps: InterviewDeps = { db, paths } // written keyless, like a pre-Task-8 install
    const interview = createInterview(interviewDeps, c.id)
    addQuestion(interviewDeps, interview.id, { text: 'Tell me about yourself.' })
    const recordAbs = path.join(
      tmp, job.folderPath, 'candidates', `candidate_${c.id}`, 'interviews', `round-${interview.stage}-record.json`
    )
    expect(isJpe1(recordAbs)).toBe(false)

    const result = sweepCandidateFiles({ db, paths, dataKey: key })
    expect(result.skipped).toBe(0)
    expect(isJpe1(recordAbs)).toBe(true)
  })

  it('returns zero counts when there are no jobs yet', () => {
    const result = sweepCandidateFiles({ db, paths, dataKey: key })
    expect(result).toEqual({ encrypted: 0, skipped: 0 })
  })

  it('ignores leftover *.jpenc-tmp files from a crashed run: never encrypts them, and the real files still encrypt', async () => {
    const job = createJob({ db, paths }, 'Barista', 'JD text')
    const c = await addCandidateFromText({ db, paths }, job.id, 'Pat', 'Ten years of sales.')
    const candDir = path.join(tmp, job.folderPath, 'candidates', `candidate_${c.id}`)
    const realFiles = listFilesRecursive(candDir)

    // Simulate a crash mid-write from a previous run: a truncated-ciphertext temp next to a
    // still-intact plaintext original, plus an orphan temp with no surviving source file.
    const consumedTmp = path.join(candDir, 'resume_text.md.jpenc-tmp')
    const orphanTmp = path.join(candDir, 'ghost.jpenc-tmp')
    fs.writeFileSync(consumedTmp, 'truncated-garbage-from-a-crash')
    fs.writeFileSync(orphanTmp, 'orphan-garbage')

    const result = sweepCandidateFiles({ db, paths, dataKey: key })

    // Only the real files are counted and encrypted; temps are never treated as candidate files.
    expect(result).toEqual({ encrypted: realFiles.length, skipped: 0 })
    for (const f of realFiles) expect(isJpe1(f)).toBe(true)

    // The stale temp for a re-swept file is consumed by the atomic rename; the orphan is
    // left untouched (never encrypted - it is not a real candidate file).
    expect(fs.existsSync(consumedTmp)).toBe(false)
    expect(fs.readFileSync(orphanTmp, 'utf8')).toBe('orphan-garbage')

    // The original plaintext survived the simulated crash and round-trips after the real sweep.
    const detail = getCandidate({ db, paths, dataKey: key }, c.id)
    expect(detail.extractedText).toBe('Ten years of sales.')
  })

  it('never trips on .keys/ sitting alongside jobs/ at the data root', async () => {
    fs.mkdirSync(path.join(tmp, '.keys'), { recursive: true })
    fs.writeFileSync(path.join(tmp, '.keys', 'master.key'), 'not-a-candidate-file', 'utf8')
    const job = createJob({ db, paths }, 'Barista', 'JD text')
    await addCandidateFromText({ db, paths }, job.id, 'Pat', 'Ten years of sales.')

    expect(() => sweepCandidateFiles({ db, paths, dataKey: key })).not.toThrow()
    expect(fs.readFileSync(path.join(tmp, '.keys', 'master.key'), 'utf8')).toBe('not-a-candidate-file')
  })
})
