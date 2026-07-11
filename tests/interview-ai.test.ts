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
import { createInterview, addQuestion, type InterviewDeps } from '../src/server/interviews'
import { NotFoundError, ValidationError, ConflictError } from '../src/server/errors'
import { analyzeCandidate, type AnalyzeDeps } from '../src/server/ai/analyze'
import { generateQuestions, type InterviewAiDeps } from '../src/server/ai/interview-ai'
import { validQuestionsFixture } from './fixtures/interview-output'
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
let questionsToReturn: ReturnType<typeof validQuestionsFixture>
let deps: InterviewAiDeps
let interviewDeps: InterviewDeps

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jobpin-interview-ai-'))
  paths = getPaths(tmp)
  ensureScaffold(paths)
  db = openDatabase(paths.dbFile)
  runMigrations(db, migrations)
  const job = createJob({ db, paths }, 'Barista', 'We need a friendly, reliable barista.')
  jobId = job.id
  jobFolder = job.folderPath
  captured = []
  questionsToReturn = validQuestionsFixture()
  interviewDeps = { db, paths }
  deps = {
    db,
    paths,
    gateway: {
      complete: async (req) => {
        captured.push(req)
        return {
          output: questionsToReturn,
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

describe('generateQuestions', () => {
  it('happy path: inserts rows in order, records provenance with full manifest, mirrors the record, returns added/dropped', async () => {
    fs.writeFileSync(
      path.join(tmp, jobFolder, 'question_bank.json'),
      JSON.stringify({ questions: [{ text: 'What would you do in week one?', addedAt: '2026-01-01T00:00:00Z' }] }),
      'utf8'
    )
    const c = await addCandidateFromText({ db, paths }, jobId, 'Pat', 'Ten years of sales.')
    const interview = createInterview(interviewDeps, c.id)

    const result = await generateQuestions(deps, interview.id)
    expect(result).toEqual({ added: 5, dropped: [] })

    const rows = db
      .prepare('SELECT order_index, category, text, source FROM interview_questions WHERE interview_id = ? ORDER BY order_index ASC')
      .all(interview.id) as { order_index: number; category: string; text: string; source: string }[]
    expect(rows).toHaveLength(5)
    expect(rows.map(r => r.category)).toEqual(['standard', 'resume_specific', 'jd_risk', 'boss_favourite', 'follow_up'])
    expect(rows.map(r => r.text)).toEqual(questionsToReturn.questions.map((q: { text: string }) => q.text))
    for (const r of rows) expect(r.source).toBe('generated')

    const analysisRow = db
      .prepare("SELECT * FROM ai_analyses WHERE candidate_id = ? AND kind = 'question_generation'")
      .get(c.id) as {
      id: number; provider: string; model: string; prompt_version: string
      input_manifest: string; output_path: string; confidence: number | null
    }
    expect(analysisRow.provider).toBe('openai')
    expect(analysisRow.model).toBe('gpt-5-mini')
    expect(analysisRow.prompt_version).toBe('question-generation/v1')
    expect(analysisRow.confidence).toBeNull()
    expect(analysisRow.output_path).not.toBe('')
    expect(analysisRow.output_path).not.toMatch(/\\/)

    const versionedAbs = path.join(tmp, analysisRow.output_path)
    expect(fs.existsSync(versionedAbs)).toBe(true)
    const versioned = JSON.parse(fs.readFileSync(versionedAbs, 'utf8'))
    expect(versioned.questions).toEqual(questionsToReturn.questions)

    const kinds = (JSON.parse(analysisRow.input_manifest) as { kind: string }[]).map(m => m.kind)
    expect(kinds).toContain('jd')
    expect(kinds).toContain('resume')
    expect(kinds).toContain('bank')

    const recordAbs = path.join(tmp, jobFolder, 'candidates', `candidate_${c.id}`, 'interviews', `round-${interview.stage}-record.json`)
    const record = JSON.parse(fs.readFileSync(recordAbs, 'utf8')) as { items: { text: string; source: string }[] }
    expect(record.items).toHaveLength(5)
    for (const item of record.items) expect(item.source).toBe('generated')
  })

  it('filter: drops a planted protected-attribute question, inserts the rest, and reports the drop', async () => {
    const base = validQuestionsFixture()
    base.questions.push({ category: 'standard', text: 'How old are you?', rationale: 'Curious about tenure.' })
    questionsToReturn = base

    const c = await addCandidateFromText({ db, paths }, jobId, 'Pat', 'Ten years of sales.')
    const interview = createInterview(interviewDeps, c.id)

    const result = await generateQuestions(deps, interview.id)
    expect(result.added).toBe(5)
    expect(result.dropped).toEqual([{ text: 'How old are you?', terms: ['age'] }])

    const rows = db
      .prepare('SELECT text FROM interview_questions WHERE interview_id = ?')
      .all(interview.id) as { text: string }[]
    expect(rows.map(r => r.text)).not.toContain('How old are you?')
    expect(rows).toHaveLength(5)
  })

  it('a second generation call conflicts; a prior manual question does not block generation', async () => {
    const c = await addCandidateFromText({ db, paths }, jobId, 'Pat', 'Ten years of sales.')
    const interview = createInterview(interviewDeps, c.id)
    addQuestion(interviewDeps, interview.id, { text: 'Manually added question', category: 'standard' })

    await expect(generateQuestions(deps, interview.id)).resolves.toEqual({ added: 5, dropped: [] })
    await expect(generateQuestions(deps, interview.id)).rejects.toThrow(ConflictError)
    await expect(generateQuestions(deps, interview.id)).rejects.toThrow(/questions already generated - add manually or start a new round/)
  })

  it('rejects with ValidationError when the job has no JD', async () => {
    const jobNoJd = createJob({ db, paths }, 'No JD Job')
    const c = await addCandidateFromText({ db, paths }, jobNoJd.id, 'Pat', 'Ten years of sales.')
    const interview = createInterview(interviewDeps, c.id)
    await expect(generateQuestions(deps, interview.id)).rejects.toThrow(ValidationError)
    await expect(generateQuestions(deps, interview.id)).rejects.toThrow(/no JD/)
  })

  it('rejects with ValidationError when the candidate has no extracted text', async () => {
    const c = await addCandidateFromFile({ db, paths }, jobId, 'corrupt.pdf', read('corrupt.pdf'))
    expect(c.status).toBe('needs_review')
    const interview = createInterview(interviewDeps, c.id)
    await expect(generateQuestions(deps, interview.id)).rejects.toThrow(ValidationError)
    await expect(generateQuestions(deps, interview.id)).rejects.toThrow(/no extracted text/)
  })

  it('rejects with NotFoundError for an unknown interview', async () => {
    await expect(generateQuestions(deps, 999)).rejects.toThrow(NotFoundError)
  })

  it('guard order: no JD AND no extracted text surfaces the job-level JD error first', async () => {
    const jobNoJd = createJob({ db, paths }, 'No JD Job')
    const c = await addCandidateFromFile({ db, paths }, jobNoJd.id, 'corrupt.pdf', read('corrupt.pdf'))
    expect(c.status).toBe('needs_review')
    const interview = createInterview(interviewDeps, c.id)
    await expect(generateQuestions(deps, interview.id)).rejects.toThrow(ValidationError)
    await expect(generateQuestions(deps, interview.id)).rejects.toThrow(/no JD/)
  })

  it('bank round-trip: an empty bank omits the QUESTION BANK block; a seeded bank includes it', async () => {
    const c1 = await addCandidateFromText({ db, paths }, jobId, 'Pat', 'Ten years of sales.')
    const interview1 = createInterview(interviewDeps, c1.id)
    await generateQuestions(deps, interview1.id)
    expect(captured[captured.length - 1].user).not.toContain('=== QUESTION BANK ===')

    fs.writeFileSync(
      path.join(tmp, jobFolder, 'question_bank.json'),
      JSON.stringify({ questions: ['What would you do first?'] }),
      'utf8'
    )
    const c2 = await addCandidateFromText({ db, paths }, jobId, 'Sam', 'Five years in retail.')
    const interview2 = createInterview(interviewDeps, c2.id)
    await generateQuestions(deps, interview2.id)
    const req2 = captured[captured.length - 1]
    expect(req2.user).toContain('=== QUESTION BANK ===')
    expect(req2.user).toContain('What would you do first?')
  })

  it('prior candidate_analysis output (summary, risk points, recommended questions) flows into the prompt when present', async () => {
    const analyzeDeps: AnalyzeDeps = {
      db, paths,
      gateway: {
        complete: async () => ({
          output: validAnalysisFixture(),
          provider: 'openai', model: 'gpt-5-mini', usage: { prompt: 1, completion: 1 }
        })
      }
    }
    const c = await addCandidateFromText({ db, paths }, jobId, 'Pat', 'Ten years of sales.')
    await analyzeCandidate(analyzeDeps, c.id)
    const interview = createInterview(interviewDeps, c.id)

    await generateQuestions(deps, interview.id)
    const req = captured[captured.length - 1]
    expect(req.user).toContain('=== PRIOR ANALYSIS SUMMARY ===')
    expect(req.user).toContain(validAnalysisFixture().summary)
    expect(req.user).toContain('=== PRIOR ANALYSIS RISK POINTS ===')
    expect(req.user).toContain('=== PRIOR ANALYSIS RECOMMENDED QUESTIONS ===')

    const analysisRow = db
      .prepare("SELECT input_manifest FROM ai_analyses WHERE candidate_id = ? AND kind = 'question_generation'")
      .get(c.id) as { input_manifest: string }
    const kinds = (JSON.parse(analysisRow.input_manifest) as { kind: string }[]).map(m => m.kind)
    expect(kinds).toContain('analysis')
  })
})
