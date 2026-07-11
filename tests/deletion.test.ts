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
import { addCandidateFromText } from '../src/server/candidates'
import { createInterview, addQuestion, saveAnswer, candidateFolderFor } from '../src/server/interviews'
import { NotFoundError } from '../src/server/errors'
import { deleteCandidate, deleteJob, type DeletionDeps } from '../src/server/deletion'
import { rmrfWithRetry } from './helpers'

let tmp: string
let db: DB
let paths: JobpinPaths
let deps: DeletionDeps

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jobpin-deletion-'))
  paths = getPaths(tmp)
  ensureScaffold(paths)
  db = openDatabase(paths.dbFile)
  runMigrations(db, migrations)
  deps = { db, paths }
})

afterEach(() => {
  db.close()
  rmrfWithRetry(tmp)
})

/**
 * Seeds one job with 2 candidates (Alice, Bob), a completed interview round + answered
 * question for Alice, a `memory_events` row sourced from that interview with an evidence
 * quote, a ranking snapshot (via direct inserts, per the brief) covering both candidates,
 * and an email for Alice. Returns every id a test needs to assert on.
 */
async function seedScenario(d: DeletionDeps, jobName = 'Barista') {
  const job = createJob({ db: d.db, paths: d.paths }, jobName, 'We need a friendly barista.')
  const a = await addCandidateFromText({ db: d.db, paths: d.paths }, job.id, 'Alice', 'Alice has ten years of experience.')
  const b = await addCandidateFromText({ db: d.db, paths: d.paths }, job.id, 'Bob', 'Bob has five years of experience.')

  const interview = createInterview({ db: d.db, paths: d.paths }, a.id)
  const question = addQuestion({ db: d.db, paths: d.paths }, interview.id, { text: 'Tell me about yourself' })
  saveAnswer({ db: d.db, paths: d.paths }, question.id, {
    answerText: 'I have ten years of relevant experience',
    affectsRanking: true
  })

  const memInfo = d.db
    .prepare(
      `INSERT INTO memory_events (scope, scope_id, source_type, source_id, content, status, approved_by_boss)
       VALUES ('job', ?, 'interview', ?, ?, 'pending', 0)`
    )
    .run(
      String(job.id),
      interview.id,
      JSON.stringify({
        lesson: 'Values clear communication',
        evidence: [{ quote: 'I have ten years of relevant experience', source: 'answer' }]
      })
    )
  const memoryEventId = Number(memInfo.lastInsertRowid)

  d.db
    .prepare(
      `INSERT INTO ai_analyses (job_id, candidate_id, kind, provider, model, prompt_version, input_manifest, output_path, confidence)
       VALUES (?, ?, 'candidate_analysis', 'openai', 'gpt-5-mini', 'v1', '[]', '', 1)`
    )
    .run(job.id, a.id)
  d.db.prepare(`INSERT INTO analysis_tasks (job_id, candidate_id, status) VALUES (?, ?, 'done')`).run(job.id, a.id)

  const candAFolderRel = candidateFolderFor(d.db, a.id)
  const emailRel = `${candAFolderRel}/emails/offer-1.md`
  fs.mkdirSync(path.join(d.paths.dataRoot, `${candAFolderRel}/emails`), { recursive: true })
  fs.writeFileSync(path.join(d.paths.dataRoot, emailRel), 'Subject: Offer\n\nCongratulations.')
  d.db.prepare('INSERT INTO emails (candidate_id, type, file_path) VALUES (?, ?, ?)').run(a.id, 'offer', emailRel)

  const rankingInfo = d.db.prepare("INSERT INTO rankings (job_id, criteria, reason) VALUES (?, '[]', 'initial')").run(job.id)
  const rankingId = Number(rankingInfo.lastInsertRowid)
  const itemAInfo = d.db
    .prepare('INSERT INTO ranking_items (ranking_id, candidate_id, rank, score, reason) VALUES (?, ?, 1, 90, ?)')
    .run(rankingId, a.id, 'Alice is a strong match')
  const itemBInfo = d.db
    .prepare('INSERT INTO ranking_items (ranking_id, candidate_id, rank, score, reason) VALUES (?, ?, 2, 80, ?)')
    .run(rankingId, b.id, 'Bob is a reasonable match')

  return {
    job,
    a,
    b,
    interviewId: interview.id,
    questionId: question.id,
    memoryEventId,
    rankingId,
    itemAId: Number(itemAInfo.lastInsertRowid),
    itemBId: Number(itemBInfo.lastInsertRowid)
  }
}

describe('deleteCandidate', () => {
  it('1. anonymises the candidate row, scrubs its ranking_items reason (rank/score kept), purges child rows, scrubs memory_events quotes, removes the folder, and leaves no maintenance flag - the OTHER candidate is untouched', async () => {
    const s = await seedScenario(deps)
    const folderAbs = path.join(paths.dataRoot, candidateFolderFor(db, s.a.id))
    expect(fs.existsSync(folderAbs)).toBe(true)

    deleteCandidate(deps, s.a.id)

    expect(fs.existsSync(folderAbs)).toBe(false)

    const candidateRow = db
      .prepare('SELECT name, email, phone, status FROM candidates WHERE id = ?')
      .get(s.a.id) as { name: string; email: string | null; phone: string | null; status: string }
    expect(candidateRow).toEqual({ name: 'Deleted candidate', email: null, phone: null, status: 'deleted' })

    const itemA = db.prepare('SELECT rank, score, reason FROM ranking_items WHERE id = ?').get(s.itemAId) as {
      rank: number
      score: number
      reason: string
    }
    expect(itemA).toEqual({ rank: 1, score: 90, reason: '[removed - candidate deleted]' })

    const itemB = db.prepare('SELECT rank, score, reason FROM ranking_items WHERE id = ?').get(s.itemBId) as {
      rank: number
      score: number
      reason: string
    }
    expect(itemB).toEqual({ rank: 2, score: 80, reason: 'Bob is a reasonable match' })

    expect(db.prepare('SELECT COUNT(*) AS c FROM interviews WHERE candidate_id = ?').get(s.a.id)).toEqual({ c: 0 })
    expect(db.prepare('SELECT COUNT(*) AS c FROM interview_questions WHERE interview_id = ?').get(s.interviewId)).toEqual({
      c: 0
    })
    expect(
      db.prepare('SELECT COUNT(*) AS c FROM interview_answers WHERE interview_question_id = ?').get(s.questionId)
    ).toEqual({ c: 0 })
    expect(db.prepare('SELECT COUNT(*) AS c FROM candidate_documents WHERE candidate_id = ?').get(s.a.id)).toEqual({
      c: 0
    })
    expect(db.prepare('SELECT COUNT(*) AS c FROM ai_analyses WHERE candidate_id = ?').get(s.a.id)).toEqual({ c: 0 })
    expect(db.prepare('SELECT COUNT(*) AS c FROM analysis_tasks WHERE candidate_id = ?').get(s.a.id)).toEqual({ c: 0 })

    const memRow = db.prepare('SELECT content FROM memory_events WHERE id = ?').get(s.memoryEventId) as {
      content: string
    }
    const content = JSON.parse(memRow.content) as { lesson: string; evidence: { quote: string; source: string }[] }
    expect(content.lesson).toBe('Values clear communication')
    expect(content.evidence).toEqual([{ quote: '[removed]', source: 'answer' }])

    expect(db.prepare('SELECT COUNT(*) AS c FROM maintenance_flags').get()).toEqual({ c: 0 })

    // Bob (the other candidate) is completely untouched.
    const bobRow = db.prepare('SELECT name, email, status FROM candidates WHERE id = ?').get(s.b.id) as {
      name: string
      email: string | null
      status: string
    }
    expect(bobRow).toEqual({ name: 'Bob', email: null, status: 'new' })
  })

  it('2. after deletion, a plain UPDATE ranking_items SET score=... STILL aborts (flag cleaned up -> 11.1-5 regression holds)', async () => {
    const s = await seedScenario(deps)
    deleteCandidate(deps, s.a.id)

    expect(() => db.prepare('UPDATE ranking_items SET score = 55 WHERE id = ?').run(s.itemAId)).toThrow(/immutable/)
    expect(() => db.prepare('UPDATE ranking_items SET score = 55 WHERE id = ?').run(s.itemBId)).toThrow(/immutable/)
  })

  it('404s for an unknown candidate id', () => {
    expect(() => deleteCandidate(deps, 999999)).toThrow(NotFoundError)
  })
})

describe('deleteJob', () => {
  it('3. cascades: job/candidates/rankings/ranking_items/emails all gone, job folder gone, flag cleaned up - a second job is untouched', async () => {
    const s1 = await seedScenario(deps, 'Barista')
    const s2 = await seedScenario(deps, 'Sales Manager') // second job, fully independent
    const folder1Abs = path.join(paths.dataRoot, s1.job.folderPath)
    const folder2Abs = path.join(paths.dataRoot, s2.job.folderPath)
    expect(fs.existsSync(folder1Abs)).toBe(true)

    deleteJob(deps, s1.job.id)

    expect(fs.existsSync(folder1Abs)).toBe(false)
    expect(db.prepare('SELECT * FROM jobs WHERE id = ?').get(s1.job.id)).toBeUndefined()
    expect(db.prepare('SELECT COUNT(*) AS c FROM candidates WHERE job_id = ?').get(s1.job.id)).toEqual({ c: 0 })
    expect(db.prepare('SELECT * FROM rankings WHERE id = ?').get(s1.rankingId)).toBeUndefined()
    expect(db.prepare('SELECT COUNT(*) AS c FROM ranking_items WHERE ranking_id = ?').get(s1.rankingId)).toEqual({
      c: 0
    })
    expect(db.prepare('SELECT COUNT(*) AS c FROM emails WHERE candidate_id = ?').get(s1.a.id)).toEqual({ c: 0 })
    expect(db.prepare('SELECT COUNT(*) AS c FROM maintenance_flags').get()).toEqual({ c: 0 })

    // Second job's data is completely untouched.
    expect(fs.existsSync(folder2Abs)).toBe(true)
    expect(db.prepare('SELECT * FROM jobs WHERE id = ?').get(s2.job.id)).toBeTruthy()
    expect(db.prepare('SELECT COUNT(*) AS c FROM candidates WHERE job_id = ?').get(s2.job.id)).toEqual({ c: 2 })
    expect(db.prepare('SELECT * FROM rankings WHERE id = ?').get(s2.rankingId)).toBeTruthy()
    expect(db.prepare('SELECT COUNT(*) AS c FROM ranking_items WHERE ranking_id = ?').get(s2.rankingId)).toEqual({
      c: 2
    })
    expect(db.prepare('SELECT COUNT(*) AS c FROM emails WHERE candidate_id = ?').get(s2.a.id)).toEqual({ c: 1 })
  })

  it('404s for an unknown job id', () => {
    expect(() => deleteJob(deps, 999999)).toThrow(NotFoundError)
  })
})

describe('keyed deps', () => {
  it('5. keyless AND keyed deps both work (folder removal + row ops are independent of candidate-file encryption)', async () => {
    const keyedDeps: DeletionDeps = { db, paths, dataKey: randomBytes(32) }
    const s = await seedScenario(keyedDeps)
    const folderAbs = path.join(paths.dataRoot, candidateFolderFor(db, s.a.id))

    deleteCandidate(keyedDeps, s.a.id)

    expect(fs.existsSync(folderAbs)).toBe(false)
    const candidateRow = db.prepare('SELECT status FROM candidates WHERE id = ?').get(s.a.id) as { status: string }
    expect(candidateRow.status).toBe('deleted')
    expect(db.prepare('SELECT COUNT(*) AS c FROM maintenance_flags').get()).toEqual({ c: 0 })

    const jobFolderAbs = path.join(paths.dataRoot, s.job.folderPath)
    deleteJob(keyedDeps, s.job.id)
    expect(fs.existsSync(jobFolderAbs)).toBe(false)
    expect(db.prepare('SELECT * FROM jobs WHERE id = ?').get(s.job.id)).toBeUndefined()
    expect(db.prepare('SELECT COUNT(*) AS c FROM maintenance_flags').get()).toEqual({ c: 0 })
  })
})
