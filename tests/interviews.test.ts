import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getPaths, type JobpinPaths } from '../src/server/paths'
import { ensureScaffold } from '../src/server/scaffold'
import { openDatabase, runMigrations, type DB } from '../src/server/db'
import { migrations } from '../src/server/migrations'
import { createJob } from '../src/server/jobs'
import { addCandidateFromText } from '../src/server/candidates'
import { NotFoundError, ValidationError } from '../src/server/errors'
import {
  createInterview,
  listInterviews,
  getInterview,
  addQuestion,
  saveAnswer,
  setBossDecision,
  candidateFolderFor,
  type InterviewDeps
} from '../src/server/interviews'
import { rmrfWithRetry } from './helpers'

let tmp: string
let db: DB
let paths: JobpinPaths
let deps: InterviewDeps
let jobId: number
let jobFolder: string
let candidateId: number

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jobpin-interviews-'))
  paths = getPaths(tmp)
  ensureScaffold(paths)
  db = openDatabase(paths.dbFile)
  runMigrations(db, migrations)
  const job = createJob({ db, paths }, 'Barista', 'We need a friendly, reliable barista.')
  jobId = job.id
  jobFolder = job.folderPath
  deps = { db, paths }
  const c = await addCandidateFromText({ db, paths }, jobId, 'Pat', 'Ten years of sales.')
  candidateId = c.id
})

afterEach(() => {
  db.close()
  rmrfWithRetry(tmp)
})

function recordPathAbs(stage: number, forCandidate = candidateId): string {
  return path.join(tmp, jobFolder, 'candidates', `candidate_${forCandidate}`, 'interviews', `round-${stage}-record.json`)
}

describe('createInterview', () => {
  it('stage increments per candidate, is independent per candidate, mode is manual, and mirrors immediately', async () => {
    const first = createInterview(deps, candidateId)
    expect(first.stage).toBe(1)
    expect(first.mode).toBe('manual')
    expect(first.transcriptPath).not.toBeNull()
    expect(first.transcriptPath).not.toMatch(/\\/)
    expect(first.transcriptPath).toBe(
      `${jobFolder}/candidates/candidate_${candidateId}/interviews/round-1-record.json`
    )

    const second = createInterview(deps, candidateId)
    expect(second.stage).toBe(2)

    const other = await addCandidateFromText({ db, paths }, jobId, 'Sam', 'Five years in retail.')
    const otherFirst = createInterview(deps, other.id)
    expect(otherFirst.stage).toBe(1)

    const recordAbs = recordPathAbs(1)
    expect(fs.existsSync(recordAbs)).toBe(true)
    const record = JSON.parse(fs.readFileSync(recordAbs, 'utf8')) as { stage: number; items: unknown[] }
    expect(record.stage).toBe(1)
    expect(record.items).toEqual([])
  })

  it('404s for an unknown candidate', () => {
    expect(() => createInterview(deps, 999999)).toThrow(NotFoundError)
  })
})

describe('addQuestion', () => {
  it('appends with incrementing order_index, defaults category to standard, validates category, and 404s for an unknown interview', () => {
    const interview = createInterview(deps, candidateId)
    const q1 = addQuestion(deps, interview.id, { text: 'Tell me about yourself.' })
    expect(q1.orderIndex).toBe(1)
    expect(q1.category).toBe('standard')
    expect(q1.source).toBe('manual')

    const q2 = addQuestion(deps, interview.id, { text: 'Why this role?', category: 'jd_risk' })
    expect(q2.orderIndex).toBe(2)
    expect(q2.category).toBe('jd_risk')

    expect(() => addQuestion(deps, interview.id, { text: 'bad', category: 'nonsense' })).toThrow(ValidationError)
    expect(() => addQuestion(deps, 999999, { text: 'x' })).toThrow(NotFoundError)
  })
})

describe('saveAnswer', () => {
  it('inserts on first save, then updates only the provided fields on later saves; affectsRanking round-trips as boolean', () => {
    const interview = createInterview(deps, candidateId)
    const q = addQuestion(deps, interview.id, { text: 'Tell me about yourself.' })

    const afterInsert = saveAnswer(deps, q.id, { answerText: 'Ten years of retail.', bossNote: 'strong answer' })
    expect(afterInsert.answer).toEqual({
      answerText: 'Ten years of retail.',
      bossNote: 'strong answer',
      aiComment: null,
      confidence: null,
      affectsRanking: false
    })

    const afterUpdate = saveAnswer(deps, q.id, { answerText: 'Updated: ten years of retail.' })
    expect(afterUpdate.answer?.answerText).toBe('Updated: ten years of retail.')
    expect(afterUpdate.answer?.bossNote).toBe('strong answer') // preserved, not overwritten by the patch

    const afterFlag = saveAnswer(deps, q.id, { affectsRanking: true })
    expect(afterFlag.answer?.affectsRanking).toBe(true)
    expect(afterFlag.answer?.answerText).toBe('Updated: ten years of retail.') // still preserved

    expect(() => saveAnswer(deps, 999999, { answerText: 'x' })).toThrow(NotFoundError)
  })
})

describe('mirror consistency', () => {
  it('round-<stage>-record.json reflects every mutation and matches getInterview exactly', () => {
    const interview = createInterview(deps, candidateId)
    addQuestion(deps, interview.id, { text: 'Q1' })
    const q2 = addQuestion(deps, interview.id, { text: 'Q2', category: 'follow_up' })
    saveAnswer(deps, q2.id, { answerText: 'A2', affectsRanking: true })

    const { items } = getInterview(deps, interview.id)
    const record = JSON.parse(fs.readFileSync(recordPathAbs(interview.stage), 'utf8')) as { items: unknown[] }
    expect(record.items).toEqual(items)
  })
})

describe('setBossDecision', () => {
  it('persists the decision and mirrors it; rejects empty string; 404s unknown interview', () => {
    const interview = createInterview(deps, candidateId)
    setBossDecision(deps, interview.id, 'advance to next round')

    const { interview: reloaded } = getInterview(deps, interview.id)
    expect(reloaded.bossDecision).toBe('advance to next round')
    const record = JSON.parse(fs.readFileSync(recordPathAbs(interview.stage), 'utf8')) as { bossDecision: string | null }
    expect(record.bossDecision).toBe('advance to next round')

    expect(() => setBossDecision(deps, interview.id, '')).toThrow(ValidationError)
    expect(() => setBossDecision(deps, 999999, 'x')).toThrow(NotFoundError)
  })
})

describe('getInterview', () => {
  it('joins items in order with a null answer for unanswered questions, and 404s unknown interview', () => {
    const interview = createInterview(deps, candidateId)
    const q1 = addQuestion(deps, interview.id, { text: 'Q1' })
    const q2 = addQuestion(deps, interview.id, { text: 'Q2' })
    saveAnswer(deps, q1.id, { answerText: 'A1' })

    const { items } = getInterview(deps, interview.id)
    expect(items).toHaveLength(2)
    expect(items[0].questionId).toBe(q1.id)
    expect(items[0].orderIndex).toBe(1)
    expect(items[0].answer?.answerText).toBe('A1')
    expect(items[1].questionId).toBe(q2.id)
    expect(items[1].answer).toBeNull()

    expect(() => getInterview(deps, 999999)).toThrow(NotFoundError)
  })
})

describe('listInterviews', () => {
  it('lists every round for a candidate with a hasSummary flag, and 404s unknown candidate', () => {
    createInterview(deps, candidateId)
    createInterview(deps, candidateId)
    const list = listInterviews(deps, candidateId)
    expect(list).toHaveLength(2)
    expect(list[0].stage).toBe(1)
    expect(list[1].stage).toBe(2)
    expect(list[0].hasSummary).toBe(false)

    expect(() => listInterviews(deps, 999999)).toThrow(NotFoundError)
  })
})

describe('candidateFolderFor', () => {
  it('returns jobs/<folder>/candidates/candidate_<id> and 404s unknown candidate', () => {
    expect(candidateFolderFor(db, candidateId)).toBe(`${jobFolder}/candidates/candidate_${candidateId}`)
    expect(() => candidateFolderFor(db, 999999)).toThrow(NotFoundError)
  })
})
