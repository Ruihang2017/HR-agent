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
import { analyzeCandidate, type AnalyzeDeps } from '../src/server/ai/analyze'
import { generateQuestions, summariseInterview, type InterviewAiDeps } from '../src/server/ai/interview-ai'
import type { Gateway } from '../src/server/ai/gateway'
import { createInterview, addQuestion, saveAnswer, type InterviewDeps } from '../src/server/interviews'
import { runRanking } from '../src/server/ranking'
import { saveEmail, getEmail, type EmailDeps } from '../src/server/emails'
import { readCandidateFile } from '../src/server/candidate-fs'
import { FILE_MAGIC } from '../src/server/cryptx'
import { validAnalysisFixture } from './fixtures/analysis-output'
import { validQuestionsFixture, validSummaryFixture } from './fixtures/interview-output'
import { rmrfWithRetry } from './helpers'

const EMAIL_TEMPLATES_SRC = path.join(__dirname, '..', 'templates', 'au', 'emails')

let tmp: string
let db: DB
let paths: JobpinPaths
let key: Buffer
let jobId: number
let jobFolder: string

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jobpin-encryption-'))
  paths = getPaths(tmp)
  ensureScaffold(paths, { emailTemplatesSrc: EMAIL_TEMPLATES_SRC })
  db = openDatabase(paths.dbFile)
  runMigrations(db, migrations)
  key = randomBytes(32)
  const job = createJob({ db, paths }, 'Barista', 'We need a friendly, reliable barista.')
  jobId = job.id
  jobFolder = job.folderPath
})

afterEach(() => {
  db.close()
  rmrfWithRetry(tmp)
})

function rawBytes(rel: string): Buffer {
  return fs.readFileSync(path.join(tmp, rel))
}

function isJpe1(rel: string): boolean {
  return rawBytes(rel).subarray(0, 4).equals(FILE_MAGIC)
}

describe('candidate-tree encryption end-to-end (keyed deps)', () => {
  it('addCandidateFromText writes encrypted resume_text.md + profile.json while jd.md stays plain, and getCandidate decrypts', async () => {
    const c = await addCandidateFromText({ db, paths, dataKey: key }, jobId, 'Pat', 'Ten years of sales.')
    const folderAbs = `${jobFolder}/candidates/candidate_${c.id}`

    expect(isJpe1(`${folderAbs}/resume.md`)).toBe(true)
    expect(isJpe1(`${folderAbs}/resume_text.md`)).toBe(true)
    expect(isJpe1(`${folderAbs}/profile.json`)).toBe(true)

    // The job's JD lives outside the candidate tree and must never be touched by the seam.
    const jdRaw = fs.readFileSync(path.join(tmp, jobFolder, 'jd.md'), 'utf8')
    expect(jdRaw).toBe('We need a friendly, reliable barista.')
    expect(isJpe1(`${jobFolder}/jd.md`)).toBe(false)

    const detail = getCandidate({ db, paths, dataKey: key }, c.id)
    expect(detail.extractedText).toBe('Ten years of sales.')

    // Without the key, the same encrypted file must never be silently readable.
    expect(() => readCandidateFile({ paths }, `${folderAbs}/resume_text.md`)).toThrow(
      'file is encrypted but no data key is available'
    )
  })

  it('analyzeCandidate round-trips under a key: versioned + latest-copy analysis files are encrypted on disk', async () => {
    const c = await addCandidateFromText({ db, paths, dataKey: key }, jobId, 'Pat', 'Ten years of sales.')
    const deps: AnalyzeDeps = {
      db, paths, dataKey: key,
      gateway: {
        complete: async () => ({
          output: validAnalysisFixture(),
          provider: 'openai', model: 'gpt-5-mini', usage: { prompt: 1, completion: 1 }
        })
      }
    }
    const { analysisId } = await analyzeCandidate(deps, c.id)
    const row = db.prepare('SELECT output_path FROM ai_analyses WHERE id = ?').get(analysisId) as { output_path: string }

    expect(isJpe1(row.output_path)).toBe(true)
    const latestRel = `${jobFolder}/candidates/candidate_${c.id}/ai_analysis.json`
    expect(isJpe1(latestRel)).toBe(true)

    const decrypted = JSON.parse(
      readCandidateFile({ paths, dataKey: key }, row.output_path).toString('utf8')
    )
    const { provider, model, promptVersion, createdAt, ...content } = decrypted
    expect(content).toEqual(validAnalysisFixture())
    expect(provider).toBe('openai')

    // Ranking also reads the versioned analysis file through the seam.
    const result = runRanking({ db, paths, dataKey: key }, jobId)
    expect(result.items).toHaveLength(1)
    expect(result.items[0].candidateId).toBe(c.id)
  })

  it('saveEmail writes an encrypted file under the candidate folder; getEmail decrypts it back', async () => {
    const c = await addCandidateFromText({ db, paths, dataKey: key }, jobId, 'Pat', 'Ten years of sales.')
    const deps: EmailDeps = { db, paths, dataKey: key }
    const saved = saveEmail(deps, c.id, 'rejection', {})

    expect(isJpe1(saved.filePath)).toBe(true)

    const detail = getEmail(deps, saved.id)
    expect(detail.content).toContain(`Subject: ${saved.subject}`)
    expect(detail.content).toContain(saved.body)
  })

  it('the interview record mirror is written encrypted, and stays encrypted across mutations', async () => {
    const c = await addCandidateFromText({ db, paths, dataKey: key }, jobId, 'Pat', 'Ten years of sales.')
    const interviewDeps: InterviewDeps = { db, paths, dataKey: key }
    const interview = createInterview(interviewDeps, c.id)
    const recordRel = `${jobFolder}/candidates/candidate_${c.id}/interviews/round-${interview.stage}-record.json`
    expect(isJpe1(recordRel)).toBe(true)

    const q = addQuestion(interviewDeps, interview.id, { text: 'Tell me about yourself.' })
    saveAnswer(interviewDeps, q.id, { answerText: 'Ten years in retail.' })
    expect(isJpe1(recordRel)).toBe(true) // still encrypted after a rewrite, not left plain
  })

  it('generateQuestions + summariseInterview write their provenance and summary files encrypted', async () => {
    const c = await addCandidateFromText({ db, paths, dataKey: key }, jobId, 'Pat', 'Ten years of sales.')
    const interviewDeps: InterviewDeps = { db, paths, dataKey: key }
    const interview = createInterview(interviewDeps, c.id)

    let nextOutput: unknown = validQuestionsFixture()
    const aiDeps: InterviewAiDeps = {
      db, paths, dataKey: key,
      gateway: {
        complete: (async (req: unknown) => {
          void req
          return { output: nextOutput, provider: 'openai', model: 'gpt-5-mini', usage: { prompt: 1, completion: 1 } }
        }) as Pick<Gateway, 'complete'>['complete']
      }
    }
    await generateQuestions(aiDeps, interview.id)
    const genRow = db
      .prepare("SELECT output_path FROM ai_analyses WHERE candidate_id = ? AND kind = 'question_generation'")
      .get(c.id) as { output_path: string }
    expect(isJpe1(genRow.output_path)).toBe(true)

    const rows = db.prepare('SELECT id FROM interview_questions WHERE interview_id = ? ORDER BY order_index').all(interview.id) as { id: number }[]
    saveAnswer(interviewDeps, rows[0].id, { answerText: 'I led the weekend roster for two years.', affectsRanking: true })

    nextOutput = validSummaryFixture()
    await summariseInterview(aiDeps, interview.id)
    const row = db.prepare('SELECT summary_path FROM interviews WHERE id = ?').get(interview.id) as { summary_path: string }
    expect(isJpe1(row.summary_path)).toBe(true)
  })

  it('legacy passthrough: a candidate written keyless before the key existed is still readable through keyed deps', async () => {
    const legacy = await addCandidateFromText({ db, paths }, jobId, 'Legacy Lee', 'Five years of legacy sales.')
    const folderAbs = `${jobFolder}/candidates/candidate_${legacy.id}`
    expect(isJpe1(`${folderAbs}/resume_text.md`)).toBe(false) // written plain, no key at the time

    const detail = getCandidate({ db, paths, dataKey: key }, legacy.id)
    expect(detail.extractedText).toBe('Five years of legacy sales.')
  })
})
