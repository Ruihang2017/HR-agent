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
import { addCandidateFromFile, addCandidateFromText } from '../src/server/candidates'
import { NotFoundError, ValidationError } from '../src/server/errors'
import { analyzeCandidate, type AnalyzeDeps } from '../src/server/ai/analyze'
import { validAnalysisFixture } from './fixtures/analysis-output'
import { rmrfWithRetry } from './helpers'

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures')
const read = (f: string) => new Uint8Array(fs.readFileSync(path.join(fixtures, f)))

interface Captured { system: string; user: string; kind: string; jobId?: number; candidateId?: number }

let tmp: string
let db: DB
let paths: JobpinPaths
let jobId: number
let jobFolder: string
let captured: Captured[]
let deps: AnalyzeDeps

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jobpin-analyze-'))
  paths = getPaths(tmp)
  ensureScaffold(paths)
  db = openDatabase(paths.dbFile)
  runMigrations(db, migrations)
  const job = createJob({ db, paths }, 'Barista', 'We need a friendly, reliable barista.')
  jobId = job.id
  jobFolder = job.folderPath
  captured = []
  deps = {
    db,
    paths,
    gateway: {
      complete: async (req) => {
        captured.push(req)
        return {
          output: validAnalysisFixture(),
          provider: 'openai',
          model: 'gpt-5-mini',
          usage: { prompt: 1, completion: 1 }
        }
      }
    }
  }
})

afterEach(() => {
  db.close()
  rmrfWithRetry(tmp)
})

describe('analyzeCandidate', () => {
  it('happy path: persists a versioned analysis row + files with full provenance', async () => {
    const c = await addCandidateFromText({ db, paths }, jobId, 'Pat', 'Ten years of sales.')
    const { analysisId } = await analyzeCandidate(deps, c.id)
    expect(analysisId).toBeGreaterThan(0)

    const row = db.prepare('SELECT * FROM ai_analyses WHERE id = ?').get(analysisId) as {
      kind: string; provider: string; model: string; prompt_version: string
      input_manifest: string; output_path: string; confidence: number
    }
    expect(row.kind).toBe('candidate_analysis')
    expect(row.provider).toBe('openai')
    expect(row.model).toBe('gpt-5-mini')
    expect(row.prompt_version).toBe('candidate-analysis/v1')
    expect(row.confidence).toBeGreaterThan(0)
    expect(row.confidence).toBeLessThanOrEqual(1)

    const expectedRel = `${jobFolder}/candidates/candidate_${c.id}/analyses/analysis_${analysisId}.json`
    expect(row.output_path).toBe(expectedRel)
    expect(row.output_path).not.toMatch(/\\/)

    const versionedAbs = path.join(tmp, row.output_path)
    const versioned = JSON.parse(fs.readFileSync(versionedAbs, 'utf8'))
    const { provider, model, promptVersion, createdAt, ...content } = versioned
    expect(content).toEqual(validAnalysisFixture())
    expect(provider).toBe('openai')
    expect(model).toBe('gpt-5-mini')
    expect(promptVersion).toBe('candidate-analysis/v1')
    expect(typeof createdAt).toBe('string')

    const latestAbs = path.join(tmp, jobFolder, 'candidates', `candidate_${c.id}`, 'ai_analysis.json')
    expect(fs.readFileSync(latestAbs, 'utf8')).toBe(fs.readFileSync(versionedAbs, 'utf8'))

    const manifest = JSON.parse(row.input_manifest) as { kind: string; path: string; chars: number }[]
    const kinds = manifest.map(m => m.kind)
    expect(kinds).toContain('jd')
    expect(kinds).toContain('resume')
    for (const m of manifest) expect(m.chars).toBeGreaterThan(0)
  })

  it('optional materials (values, learned_skills) are included only when present', async () => {
    // Fresh job/candidate: values.md and learned_skills.md are seeded empty -> absent.
    const c1 = await addCandidateFromText({ db, paths }, jobId, 'Pat', 'Ten years of sales.')
    await analyzeCandidate(deps, c1.id)
    const req1 = captured[captured.length - 1]
    expect(req1.user).not.toContain('=== COMPANY VALUES ===')
    expect(req1.user).not.toContain('=== JOB LEARNED SKILLS ===')

    // Now populate both, and analyse a second candidate.
    fs.writeFileSync(paths.valuesFile, 'We value honesty and reliability.', 'utf8')
    fs.writeFileSync(path.join(tmp, jobFolder, 'learned_skills.md'), 'POS systems are a plus.', 'utf8')

    const c2 = await addCandidateFromText({ db, paths }, jobId, 'Sam', 'Five years in retail.')
    const { analysisId } = await analyzeCandidate(deps, c2.id)
    const req2 = captured[captured.length - 1]
    expect(req2.user).toContain('=== COMPANY VALUES ===')
    expect(req2.user).toContain('=== JOB LEARNED SKILLS ===')

    const row = db.prepare('SELECT input_manifest FROM ai_analyses WHERE id = ?').get(analysisId) as {
      input_manifest: string
    }
    const kinds = (JSON.parse(row.input_manifest) as { kind: string }[]).map(m => m.kind)
    expect(kinds).toContain('values')
    expect(kinds).toContain('learned_skills')
  })

  it('boss preferences flow through into the captured user prompt', async () => {
    fs.writeFileSync(
      paths.bossPreferencesFile,
      JSON.stringify({ prefers: 'candidates available for weekend shifts' }),
      'utf8'
    )
    const c = await addCandidateFromText({ db, paths }, jobId, 'Pat', 'Ten years of sales.')
    await analyzeCandidate(deps, c.id)
    const req = captured[captured.length - 1]
    expect(req.user).toContain('=== BOSS PREFERENCES ===')
  })

  it('rejects with ValidationError when the candidate has no extracted text', async () => {
    const c = await addCandidateFromFile({ db, paths }, jobId, 'corrupt.pdf', read('corrupt.pdf'))
    expect(c.status).toBe('needs_review')
    await expect(analyzeCandidate(deps, c.id)).rejects.toThrow(ValidationError)
    await expect(analyzeCandidate(deps, c.id)).rejects.toThrow(/no extracted text/)
  })

  it('rejects with NotFoundError for an unknown candidate', async () => {
    await expect(analyzeCandidate(deps, 999)).rejects.toThrow(NotFoundError)
  })

  it('rolls back the ai_analyses row when the filesystem write fails', async () => {
    const c = await addCandidateFromText({ db, paths }, jobId, 'Pat', 'Ten years of sales.')
    const candFolderAbs = path.join(tmp, jobFolder, 'candidates', `candidate_${c.id}`)
    // Block the analyses/ mkdirSync by pre-creating a FILE at that path.
    fs.writeFileSync(path.join(candFolderAbs, 'analyses'), 'not a directory')

    await expect(analyzeCandidate(deps, c.id)).rejects.toThrow()

    const count = db.prepare('SELECT COUNT(*) AS n FROM ai_analyses').get() as { n: number }
    expect(count.n).toBe(0)
  })

  it('re-analysis appends history: two runs produce two rows, both versioned files exist, latest wins', async () => {
    const c = await addCandidateFromText({ db, paths }, jobId, 'Pat', 'Ten years of sales.')
    const first = await analyzeCandidate(deps, c.id)
    const second = await analyzeCandidate(deps, c.id)
    expect(second.analysisId).not.toBe(first.analysisId)

    const rows = db.prepare('SELECT * FROM ai_analyses WHERE candidate_id = ? ORDER BY id').all(c.id) as {
      id: number; output_path: string
    }[]
    expect(rows).toHaveLength(2)

    const firstAbs = path.join(tmp, rows[0].output_path)
    const secondAbs = path.join(tmp, rows[1].output_path)
    expect(fs.existsSync(firstAbs)).toBe(true)
    expect(fs.existsSync(secondAbs)).toBe(true)
    expect(firstAbs).not.toBe(secondAbs)

    const latestAbs = path.join(tmp, jobFolder, 'candidates', `candidate_${c.id}`, 'ai_analysis.json')
    expect(fs.readFileSync(latestAbs, 'utf8')).toBe(fs.readFileSync(secondAbs, 'utf8'))
  })
})
