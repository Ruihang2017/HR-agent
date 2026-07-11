import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getPaths, type JobpinPaths } from '../src/server/paths'
import { ensureScaffold } from '../src/server/scaffold'
import { openDatabase, runMigrations, type DB } from '../src/server/db'
import { migrations } from '../src/server/migrations'
import { createJob } from '../src/server/jobs'
import { addCandidateFromText, listCandidates, getCandidate } from '../src/server/candidates'
import { NotFoundError, ValidationError } from '../src/server/errors'
import { deleteCandidate } from '../src/server/deletion'
import { runRanking } from '../src/server/ranking'
import { ANALYSIS_PROMPT_VERSION } from '../src/server/ai/prompts'
import { createQueue } from '../src/server/ai/queue'
import { analyzeCandidate, type AnalyzeDeps } from '../src/server/ai/analyze'
import { saveEmail, type EmailDeps } from '../src/server/emails'
import { createInterview, type InterviewDeps } from '../src/server/interviews'
import { validAnalysisFixture } from './fixtures/analysis-output'
import { rmrfWithRetry } from './helpers'

/**
 * D-17 "resurrection" guards (Phase 4+5 final review, fix 3): once `deleteCandidate` has
 * anonymised a candidate row (status='deleted') and removed its folder, NOTHING in the system
 * may treat that candidate as live again - not the list/detail read paths, not a future ranking
 * run's exclusion list, not the analysis queue's sweep, and most importantly not an in-flight
 * analysis worker that claimed its task moments before the delete (the actual resurrection
 * race: analyzeCandidate must refuse to write a fresh analysis file into a folder that was
 * just deleted out from under it).
 */

const EMAIL_TEMPLATES_SRC = path.join(__dirname, '..', 'templates', 'au', 'emails')

let tmp: string
let db: DB
let paths: JobpinPaths
let jobId: number
let jobFolder: string

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jobpin-deleted-guards-'))
  paths = getPaths(tmp)
  ensureScaffold(paths, { emailTemplatesSrc: EMAIL_TEMPLATES_SRC })
  db = openDatabase(paths.dbFile)
  runMigrations(db, migrations)
  const job = createJob({ db, paths }, 'Barista', 'We need a friendly, reliable barista.')
  jobId = job.id
  jobFolder = job.folderPath
})

afterEach(() => {
  db.close()
  rmrfWithRetry(tmp)
})

function candFolderAbsOf(candidateId: number): string {
  return path.join(tmp, jobFolder, 'candidates', `candidate_${candidateId}`)
}

describe('deleted-candidate guards (D-17)', () => {
  it('listCandidates excludes a deleted candidate from its job list', async () => {
    const alive = await addCandidateFromText({ db, paths }, jobId, 'Alice', 'Alice has ten years of experience.')
    const gone = await addCandidateFromText({ db, paths }, jobId, 'Bob', 'Bob has five years of experience.')

    deleteCandidate({ db, paths }, gone.id)

    const list = listCandidates({ db, paths }, jobId)
    expect(list.map(c => c.id)).toEqual([alive.id])
  })

  it('getCandidate 404s for a deleted candidate (detail page 404s instead of rendering live actions)', async () => {
    const c = await addCandidateFromText({ db, paths }, jobId, 'Bob', 'Bob has five years of experience.')
    deleteCandidate({ db, paths }, c.id)

    expect(() => getCandidate({ db, paths }, c.id)).toThrow(NotFoundError)
  })

  it('runRanking never lists a deleted candidate in `excluded` - it is scrubbed from the scan entirely', async () => {
    const alice = await addCandidateFromText({ db, paths }, jobId, 'Alice', 'Alice has ten years of experience.')
    const bob = await addCandidateFromText({ db, paths }, jobId, 'Bob', 'Bob has five years of experience.')

    // Seed a real analysis for Alice (bypassing the gateway) so runRanking has something to rank.
    const output = validAnalysisFixture()
    const candFolderRel = `${jobFolder}/candidates/candidate_${alice.id}/analyses`
    fs.mkdirSync(path.join(tmp, candFolderRel), { recursive: true })
    const info = db
      .prepare(
        `INSERT INTO ai_analyses (job_id, candidate_id, kind, provider, model, prompt_version, input_manifest, output_path, confidence)
         VALUES (?, ?, 'candidate_analysis', 'openai', 'gpt-5-mini', ?, '[]', '', 1)`
      )
      .run(jobId, alice.id, ANALYSIS_PROMPT_VERSION)
    const analysisId = Number(info.lastInsertRowid)
    const rel = `${candFolderRel}/analysis_${analysisId}.json`
    fs.writeFileSync(path.join(tmp, rel), JSON.stringify(output))
    db.prepare('UPDATE ai_analyses SET output_path = ? WHERE id = ?').run(rel, analysisId)

    // Bob has no analysis - pre-fix he would show up in `excluded` with reason 'no analysis'.
    // Delete him; post-fix he must not appear in `excluded` at all.
    deleteCandidate({ db, paths }, bob.id)

    const result = runRanking({ db, paths }, jobId)
    expect(result.items.map(i => i.candidateId)).toEqual([alice.id])
    expect(result.excluded).toEqual([])
  })

  it('enqueueAnalyses skips a deleted candidate with reason "candidate deleted"', async () => {
    const c = await addCandidateFromText({ db, paths }, jobId, 'Pat', 'Ten years of sales.')
    deleteCandidate({ db, paths }, c.id)

    const queue = createQueue({
      db,
      paths,
      gateway: { complete: async () => { throw new Error('gateway must never be called for a deleted candidate') } }
    })
    const result = queue.enqueueAnalyses(jobId)
    expect(result.enqueued).toEqual([])
    expect(result.skipped).toEqual([{ candidateId: c.id, reason: 'candidate deleted' }])
  })

  it('THE RESURRECTION GUARD: analyzeCandidate refuses a deleted candidate before any gateway call or file write', async () => {
    const c = await addCandidateFromText({ db, paths }, jobId, 'Pat', 'Ten years of sales.')
    const folderAbs = candFolderAbsOf(c.id)
    expect(fs.existsSync(folderAbs)).toBe(true)

    deleteCandidate({ db, paths }, c.id)
    expect(fs.existsSync(folderAbs)).toBe(false) // the candidate's folder is genuinely gone

    // Simulates a worker that claimed the analysis_tasks row moments before the delete: by the
    // time analyzeCandidate actually runs, the candidate is already anonymised/removed. The
    // gateway throws if called at all, so the test fails loudly if the guard is ever bypassed.
    const deps: AnalyzeDeps = {
      db,
      paths,
      gateway: { complete: async () => { throw new Error('gateway must never be called for a deleted candidate') } }
    }
    await expect(analyzeCandidate(deps, c.id)).rejects.toThrow(ValidationError)
    await expect(analyzeCandidate(deps, c.id)).rejects.toThrow(/deleted/)

    // No analysis file/folder resurrected on disk, and no new ai_analyses row - the PII stays dead.
    expect(fs.existsSync(folderAbs)).toBe(false)
    expect(db.prepare('SELECT COUNT(*) AS n FROM ai_analyses WHERE candidate_id = ?').get(c.id)).toEqual({ n: 0 })
  })

  it('saveEmail throws for a deleted candidate - no email folder is ever recreated', async () => {
    const c = await addCandidateFromText({ db, paths }, jobId, 'Pat', 'Ten years of sales.')
    const folderAbs = candFolderAbsOf(c.id)
    deleteCandidate({ db, paths }, c.id)
    expect(fs.existsSync(folderAbs)).toBe(false)

    const deps: EmailDeps = { db, paths }
    expect(() => saveEmail(deps, c.id, 'rejection', {})).toThrow(NotFoundError)
    expect(fs.existsSync(folderAbs)).toBe(false) // the write path never got far enough to mkdir
  })

  it('createInterview throws for a deleted candidate - no interview folder is ever recreated', async () => {
    const c = await addCandidateFromText({ db, paths }, jobId, 'Pat', 'Ten years of sales.')
    const folderAbs = candFolderAbsOf(c.id)
    deleteCandidate({ db, paths }, c.id)
    expect(fs.existsSync(folderAbs)).toBe(false)

    const deps: InterviewDeps = { db, paths }
    expect(() => createInterview(deps, c.id)).toThrow(NotFoundError)
    expect(fs.existsSync(folderAbs)).toBe(false)
  })
})
