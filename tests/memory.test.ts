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
import { createInterview, addQuestion, type InterviewDeps } from '../src/server/interviews'
import { NotFoundError, ConflictError } from '../src/server/errors'
import { decideProposal, getJobMemory, starQuestion, type MemoryDeps } from '../src/server/memory'
import { rmrfWithRetry } from './helpers'

let tmp: string
let db: DB
let paths: JobpinPaths
let deps: MemoryDeps
let interviewDeps: InterviewDeps
let jobId: number
let jobFolder: string
let candidateId: number
let interviewId: number

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jobpin-memory-'))
  paths = getPaths(tmp)
  ensureScaffold(paths)
  db = openDatabase(paths.dbFile)
  runMigrations(db, migrations)
  const job = createJob({ db, paths }, 'Barista', 'We need a friendly, reliable barista.')
  jobId = job.id
  jobFolder = job.folderPath
  deps = { db, paths }
  interviewDeps = { db, paths }
  const c = await addCandidateFromText({ db, paths }, jobId, 'Pat', 'Ten years of sales.')
  candidateId = c.id
  const interview = createInterview(interviewDeps, candidateId)
  interviewId = interview.id
})

afterEach(() => {
  db.close()
  rmrfWithRetry(tmp)
})

function skillsAbs(): string {
  return path.join(tmp, jobFolder, 'learned_skills.md')
}

/** Seeds a memory_events row exactly as Task 6's summariseInterview writes it. */
function insertEvent(
  overrides: {
    jobId?: number
    interviewId?: number
    status?: string
    lesson?: string
    evidence?: { quote: string; source: string }[]
    refusalReason?: string
    createdAt?: string
  } = {}
): number {
  const content: Record<string, unknown> = {
    lesson: overrides.lesson ?? 'Ask about shift flexibility early.',
    evidence: overrides.evidence ?? [{ quote: 'I can only work mornings.', source: 'answer' }]
  }
  if (overrides.refusalReason) content.refusalReason = overrides.refusalReason
  const info = db
    .prepare(
      `INSERT INTO memory_events (scope, scope_id, source_type, source_id, content, status, approved_by_boss, created_at)
       VALUES ('job', ?, 'interview', ?, ?, ?, 0, ?)`
    )
    .run(
      String(overrides.jobId ?? jobId),
      overrides.interviewId ?? interviewId,
      JSON.stringify(content),
      overrides.status ?? 'pending',
      overrides.createdAt ?? '2024-01-15T10:00:00.000Z'
    )
  return Number(info.lastInsertRowid)
}

describe('decideProposal — approve', () => {
  it('appends the exact learned-skills block, flips status + approved_by_boss, and 409s on redecide', () => {
    const eventId = insertEvent({ createdAt: '2024-01-15T10:00:00.000Z' })

    const result = decideProposal(deps, eventId, 'approved')
    expect(result.status).toBe('approved')
    expect(result.approvedByBoss).toBe(true)

    const content = fs.readFileSync(skillsAbs(), 'utf8')
    expect(content).toBe(
      '\n## 2024-01-15 — from Pat, round 1\n' +
        '- Ask about shift flexibility early. _(evidence: "I can only work mornings.")_\n'
    )

    expect(() => decideProposal(deps, eventId, 'approved')).toThrow(ConflictError)
    expect(() => decideProposal(deps, eventId, 'rejected')).toThrow(ConflictError)
    expect(() => decideProposal(deps, 999999, 'approved')).toThrow(NotFoundError)
  })
})

describe('decideProposal — reject', () => {
  it('flips status only; learned_skills.md is byte-identical before and after', () => {
    const before = fs.readFileSync(skillsAbs(), 'utf8')
    const eventId = insertEvent()

    const result = decideProposal(deps, eventId, 'rejected')
    expect(result.status).toBe('rejected')
    expect(result.approvedByBoss).toBe(false)

    const after = fs.readFileSync(skillsAbs(), 'utf8')
    expect(after).toBe(before)
  })
})

describe('decideProposal — approve rollback', () => {
  it('rolls the status back to pending when the fs write fails', () => {
    fs.rmSync(skillsAbs(), { force: true }) // remove the scaffold-created file
    fs.mkdirSync(skillsAbs()) // block the append with a directory at the same path

    const eventId = insertEvent()
    expect(() => decideProposal(deps, eventId, 'approved')).toThrow()

    const row = db
      .prepare('SELECT status, approved_by_boss AS approvedByBoss FROM memory_events WHERE id = ?')
      .get(eventId) as { status: string; approvedByBoss: number }
    expect(row.status).toBe('pending')
    expect(row.approvedByBoss).toBe(0)
  })
})

describe('decideProposal — already-decided rows', () => {
  it('409s deciding a refused row and an already-rejected row', () => {
    const refusedId = insertEvent({ status: 'refused', refusalReason: 'mentions protected attribute: age' })
    expect(() => decideProposal(deps, refusedId, 'approved')).toThrow(ConflictError)

    const rejectedId = insertEvent({ status: 'rejected' })
    expect(() => decideProposal(deps, rejectedId, 'approved')).toThrow(ConflictError)
  })
})

describe('getJobMemory', () => {
  it('shapes events newest-first, reports "" for a missing file, and 404s an unknown job', () => {
    // Inserted in this order (newer gets the smaller id) so a correct ordering by
    // created_at - not insertion/id order - is the only way to pass this assertion.
    const newer = insertEvent({ createdAt: '2024-01-15T10:00:00.000Z', lesson: 'newer lesson' })
    const older = insertEvent({ createdAt: '2024-01-10T09:00:00.000Z', lesson: 'older lesson' })
    decideProposal(deps, newer, 'approved')

    const mem = getJobMemory(deps, jobId)
    expect(mem.events.map(e => e.id)).toEqual([newer, older])
    expect(mem.events[0]).toEqual({
      id: newer,
      status: 'approved',
      lesson: 'newer lesson',
      evidence: [{ quote: 'I can only work mornings.', source: 'answer' }],
      sourceInterviewId: interviewId,
      createdAt: '2024-01-15T10:00:00.000Z'
    })
    expect(mem.events[1].status).toBe('pending')
    expect(mem.learnedSkills).toContain('newer lesson')

    const other = createJob({ db, paths }, 'Empty Job')
    fs.rmSync(path.join(tmp, other.folderPath, 'learned_skills.md'), { force: true })
    expect(getJobMemory(deps, other.id).learnedSkills).toBe('')
    expect(getJobMemory(deps, other.id).events).toEqual([])

    expect(() => getJobMemory(deps, 999999)).toThrow(NotFoundError)
  })
})

describe('starQuestion', () => {
  it('adds to the empty scaffold bank, dedupes case-insensitively, and 404s an unknown question', () => {
    const q1 = addQuestion(interviewDeps, interviewId, { text: 'Tell me about a conflict you resolved.' })
    const first = starQuestion(deps, q1.id)
    expect(first.questions).toHaveLength(1)
    expect(first.questions[0].text).toBe('Tell me about a conflict you resolved.')
    expect(first.questions[0].addedAt).toBeTruthy()

    const q2 = addQuestion(interviewDeps, interviewId, { text: '  TELL ME ABOUT A CONFLICT YOU RESOLVED.  ' })
    const second = starQuestion(deps, q2.id)
    expect(second.questions).toHaveLength(1) // case/whitespace-insensitive dedupe

    const onDisk = JSON.parse(fs.readFileSync(path.join(tmp, jobFolder, 'question_bank.json'), 'utf8')) as {
      questions: { text: string; addedAt: string }[]
    }
    expect(onDisk.questions).toEqual(second.questions)

    expect(() => starQuestion(deps, 999999)).toThrow(NotFoundError)
  })
})
