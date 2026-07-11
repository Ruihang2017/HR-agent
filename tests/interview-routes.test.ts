import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Hono } from 'hono'
import { getPaths, type JobpinPaths } from '../src/server/paths'
import { ensureScaffold } from '../src/server/scaffold'
import { openDatabase, runMigrations, type DB } from '../src/server/db'
import { migrations } from '../src/server/migrations'
import { createApp } from '../src/server/app'
import { createAiRuntime } from '../src/server/ai/runtime'
import { DevTokenIssuer } from '../src/server/ai/subscription'
import { validQuestionsFixture, validCommentFixture, validSummaryFixture } from './fixtures/interview-output'
import { validAnalysisFixture } from './fixtures/analysis-output'
import { rmrfWithRetry } from './helpers'

let tmp: string
let db: DB
let paths: JobpinPaths
let app: Hono
let failQuestionGenAuth: boolean

const json = (body: unknown, method: 'POST' | 'PUT' | 'PATCH' = 'POST') => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
})

const openaiBody = (content: string) =>
  JSON.stringify({
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 5, completion_tokens: 5 }
  })

const FIXTURES: Record<string, () => unknown> = {
  question_generation: validQuestionsFixture,
  answer_comment: validCommentFixture,
  interview_summary: validSummaryFixture,
  candidate_analysis: validAnalysisFixture
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jobpin-interview-routes-'))
  paths = getPaths(tmp)
  ensureScaffold(paths)
  db = openDatabase(paths.dbFile)
  runMigrations(db, migrations)
  failQuestionGenAuth = false

  const fetchFn = (async (_url: string | URL | Request, init?: RequestInit) => {
    const parsed = JSON.parse(String(init?.body)) as { response_format: { json_schema: { name: string } } }
    const name = parsed.response_format.json_schema.name
    if (failQuestionGenAuth && name === 'question_generation') {
      return new Response(JSON.stringify({ error: { message: 'invalid api key' } }), { status: 401 })
    }
    const fixture = FIXTURES[name]
    if (!fixture) throw new Error(`unexpected schema name "${name}"`)
    return new Response(openaiBody(JSON.stringify(fixture())), { status: 200 })
  }) as typeof fetch

  const ai = createAiRuntime({
    db,
    paths,
    issuer: new DevTokenIssuer({ OPENAI_API_KEY: 'sk-test' }),
    fetchFn
  })
  app = createApp({ db, paths, version: '0.1.0', ai })
})

afterEach(() => {
  db.close()
  rmrfWithRetry(tmp)
})

/** Job with a JD + one pasted-text candidate (has extracted text, ready for AI pipelines). */
async function createJobAndCandidate(): Promise<{ jobId: number; candidateId: number }> {
  const jobRes = await app.request('/jobs', json({ name: 'Barista', jd: 'Serve coffee with care' }))
  const { id: jobId } = await jobRes.json()
  const candRes = await app.request(
    `/jobs/${jobId}/candidates`,
    json({ name: 'Pat', text: 'Ten years of sales experience.' })
  )
  const { id: candidateId } = await candRes.json()
  return { jobId, candidateId }
}

describe('interview lifecycle over HTTP', () => {
  it('create -> generate -> conflict -> answer -> ai-comment -> summary -> reads', async () => {
    const { candidateId } = await createJobAndCandidate()

    const createRes = await app.request(`/candidates/${candidateId}/interviews`, json({}))
    expect(createRes.status).toBe(201)
    const created = await createRes.json()
    expect(created.interview.stage).toBe(1)
    const interviewId = created.interview.id

    const genRes = await app.request(`/interviews/${interviewId}/questions/generate`, json({}))
    expect(genRes.status).toBe(200)
    const genBody = await genRes.json()
    expect(genBody.added).toBeGreaterThan(0)
    expect(genBody.dropped).toEqual([])

    const genAgainRes = await app.request(`/interviews/${interviewId}/questions/generate`, json({}))
    expect(genAgainRes.status).toBe(409)

    const getRes = await app.request(`/interviews/${interviewId}`)
    expect(getRes.status).toBe(200)
    const gotten = await getRes.json()
    const firstQuestionId = gotten.items[0].questionId

    const answerRes = await app.request(
      `/interview-questions/${firstQuestionId}/answer`,
      json({ answerText: 'I ran the weekend schedule myself for two years.', affectsRanking: true }, 'PUT')
    )
    expect(answerRes.status).toBe(200)
    const answered = await answerRes.json()
    expect(answered.answer.answerText).toBe('I ran the weekend schedule myself for two years.')
    expect(answered.answer.affectsRanking).toBe(true)

    const commentRes = await app.request(`/interview-questions/${firstQuestionId}/ai-comment`, json({}))
    expect(commentRes.status).toBe(200)
    const commentBody = await commentRes.json()
    expect(commentBody.comment).toBe(validCommentFixture().comment)
    expect(commentBody.confidence).toBe('medium')

    const summaryRes = await app.request(`/interviews/${interviewId}/summary`, json({}))
    expect(summaryRes.status).toBe(200)
    const summaryBody = await summaryRes.json()
    expect(summaryBody.output.summary).toBe(validSummaryFixture().summary)
    expect(summaryBody.proposals.length).toBeGreaterThan(0)

    const finalGet = await app.request(`/interviews/${interviewId}`)
    const finalBody = await finalGet.json()
    const answeredItem = finalBody.items.find((i: { questionId: number }) => i.questionId === firstQuestionId)
    expect(answeredItem.answer.aiComment).toBe(validCommentFixture().comment)

    const listRes = await app.request(`/candidates/${candidateId}/interviews`)
    expect(listRes.status).toBe(200)
    const list = await listRes.json()
    expect(list).toHaveLength(1)
    expect(list[0].hasSummary).toBe(true)
  })
})

describe('PATCH /interviews/:id boss decision', () => {
  it('200 sets the decision; empty body is 400', async () => {
    const { candidateId } = await createJobAndCandidate()
    const createRes = await app.request(`/candidates/${candidateId}/interviews`, json({}))
    const { interview } = await createRes.json()

    const okRes = await app.request(`/interviews/${interview.id}`, json({ bossDecision: 'advance to round 2' }, 'PATCH'))
    expect(okRes.status).toBe(200)
    const okBody = await okRes.json()
    expect(okBody.interview.bossDecision).toBe('advance to round 2')

    const badRes = await app.request(`/interviews/${interview.id}`, json({ bossDecision: '' }, 'PATCH'))
    expect(badRes.status).toBe(400)
  })
})

describe('starring, memory decisions, and job memory read', () => {
  it('star 200 with bank; approve/reject 200 then 409; GET job memory shape', async () => {
    const { jobId, candidateId } = await createJobAndCandidate()
    const createRes = await app.request(`/candidates/${candidateId}/interviews`, json({}))
    const { interview } = await createRes.json()
    await app.request(`/interviews/${interview.id}/questions/generate`, json({}))
    const getRes = await app.request(`/interviews/${interview.id}`)
    const gotten = await getRes.json()
    const questionId = gotten.items[0].questionId

    const starRes = await app.request(`/interview-questions/${questionId}/star`, json({}))
    expect(starRes.status).toBe(200)
    const starBody = await starRes.json()
    expect(Array.isArray(starBody.bank)).toBe(true)
    expect(starBody.bank.length).toBeGreaterThan(0)

    // answer + summarise to produce memory proposals
    const q1 = gotten.items[0].questionId
    await app.request(`/interview-questions/${q1}/answer`, json({ answerText: 'I ran the weekend schedule myself for two years.' }, 'PUT'))
    const summaryRes = await app.request(`/interviews/${interview.id}/summary`, json({}))
    const summaryBody = await summaryRes.json()
    const proposalId = summaryBody.proposals.find((p: { status: string }) => p.status === 'pending').id

    const approveRes = await app.request(`/memory-events/${proposalId}/approve`, json({}))
    expect(approveRes.status).toBe(200)
    const approveBody = await approveRes.json()
    expect(approveBody.event.status).toBe('approved')

    const approveAgainRes = await app.request(`/memory-events/${proposalId}/approve`, json({}))
    expect(approveAgainRes.status).toBe(409)

    const memRes = await app.request(`/jobs/${jobId}/memory`)
    expect(memRes.status).toBe(200)
    const memBody = await memRes.json()
    expect(typeof memBody.learnedSkills).toBe('string')
    expect(memBody.learnedSkills).toContain('Pat')
    expect(Array.isArray(memBody.events)).toBe(true)
    expect(memBody.events.some((e: { status: string }) => e.status === 'approved')).toBe(true)
  })

  it('reject 200 then 409 on a second decision', async () => {
    const { candidateId } = await createJobAndCandidate()
    const createRes = await app.request(`/candidates/${candidateId}/interviews`, json({}))
    const { interview } = await createRes.json()
    const q = await app.request(`/interviews/${interview.id}/questions`, json({ text: 'How do you handle conflict?' }))
    const question = await q.json()
    await app.request(`/interview-questions/${question.id}/answer`, json({ answerText: 'I ran the weekend schedule myself for two years.' }, 'PUT'))
    const summaryRes = await app.request(`/interviews/${interview.id}/summary`, json({}))
    const summaryBody = await summaryRes.json()
    const proposalId = summaryBody.proposals.find((p: { status: string }) => p.status === 'pending').id

    const rejectRes = await app.request(`/memory-events/${proposalId}/reject`, json({}))
    expect(rejectRes.status).toBe(200)
    expect((await rejectRes.json()).event.status).toBe('rejected')

    const rejectAgainRes = await app.request(`/memory-events/${proposalId}/reject`, json({}))
    expect(rejectAgainRes.status).toBe(409)
  })
})

describe('manual question add', () => {
  it('201 with source manual; 400 on blank text', async () => {
    const { candidateId } = await createJobAndCandidate()
    const createRes = await app.request(`/candidates/${candidateId}/interviews`, json({}))
    const { interview } = await createRes.json()

    const okRes = await app.request(`/interviews/${interview.id}/questions`, json({ text: 'Tell me about a time you led a team.' }))
    expect(okRes.status).toBe(201)
    const okBody = await okRes.json()
    expect(okBody.source).toBe('manual')

    const badRes = await app.request(`/interviews/${interview.id}/questions`, json({ text: '' }))
    expect(badRes.status).toBe(400)
  })
})

describe('GatewayError -> 502', () => {
  it('question generation auth failure surfaces as 502 with code auth; analysis flow untouched', async () => {
    const { jobId, candidateId } = await createJobAndCandidate()
    const createRes = await app.request(`/candidates/${candidateId}/interviews`, json({}))
    const { interview } = await createRes.json()

    failQuestionGenAuth = true
    const genRes = await app.request(`/interviews/${interview.id}/questions/generate`, json({}))
    expect(genRes.status).toBe(502)
    const genBody = await genRes.json()
    expect(genBody.code).toBe('auth')
    expect(typeof genBody.error).toBe('string')

    // existing analysis-queue behaviour (Phase 2) is untouched by the new mapping - the stub
    // only fails 401 for question_generation, so a plain analysis enqueue still succeeds.
    const enqueueRes = await app.request(`/jobs/${jobId}/analyses`, json({}))
    expect(enqueueRes.status).toBe(202)
  })
})

describe('malformed JSON bodies -> 400, never 500', () => {
  const notJson = (method: 'POST' | 'PUT' | 'PATCH') => ({
    method,
    headers: { 'Content-Type': 'application/json' },
    body: '{not json'
  })

  it('PATCH decision, POST question, and PUT answer all 400 with no rows written', async () => {
    const { candidateId } = await createJobAndCandidate()
    const createRes = await app.request(`/candidates/${candidateId}/interviews`, json({}))
    const { interview } = await createRes.json()
    const qRes = await app.request(`/interviews/${interview.id}/questions`, json({ text: 'How do you handle conflict?' }))
    const question = await qRes.json()

    const patchRes = await app.request(`/interviews/${interview.id}`, notJson('PATCH'))
    expect(patchRes.status).toBe(400)
    expect((await patchRes.json()).error).toBe('request body must be valid JSON')
    const row = db.prepare('SELECT boss_decision FROM interviews WHERE id = ?').get(interview.id) as { boss_decision: string | null }
    expect(row.boss_decision).toBeNull()

    const postRes = await app.request(`/interviews/${interview.id}/questions`, notJson('POST'))
    expect(postRes.status).toBe(400)
    const count = db.prepare('SELECT COUNT(*) AS n FROM interview_questions WHERE interview_id = ?').get(interview.id) as { n: number }
    expect(count.n).toBe(1) // only the well-formed question above

    const putRes = await app.request(`/interview-questions/${question.id}/answer`, notJson('PUT'))
    expect(putRes.status).toBe(400)
    const answers = db.prepare('SELECT COUNT(*) AS n FROM interview_answers WHERE interview_question_id = ?').get(question.id) as { n: number }
    expect(answers.n).toBe(0)
  })
})

describe('404s for unknown ids', () => {
  it('every :id route 404s on an unknown id', async () => {
    expect((await app.request('/candidates/999/interviews', json({}))).status).toBe(404)
    expect((await app.request('/candidates/999/interviews')).status).toBe(404)
    expect((await app.request('/interviews/999')).status).toBe(404)
    expect((await app.request('/interviews/999', json({ bossDecision: 'x' }, 'PATCH'))).status).toBe(404)
    expect((await app.request('/interviews/999/questions/generate', json({}))).status).toBe(404)
    expect((await app.request('/interviews/999/questions', json({ text: 'x' }))).status).toBe(404)
    expect((await app.request('/interview-questions/999/star', json({}))).status).toBe(404)
    expect((await app.request('/interview-questions/999/answer', json({ answerText: 'x' }, 'PUT'))).status).toBe(404)
    expect((await app.request('/interview-questions/999/ai-comment', json({}))).status).toBe(404)
    expect((await app.request('/interviews/999/summary', json({}))).status).toBe(404)
    expect((await app.request('/memory-events/999/approve', json({}))).status).toBe(404)
    expect((await app.request('/memory-events/999/reject', json({}))).status).toBe(404)
    expect((await app.request('/jobs/999/memory')).status).toBe(404)
  })
})
