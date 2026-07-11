import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Hono } from 'hono'
import type { DB } from '../db'
import type { JobpinPaths } from '../paths'
import { NotFoundError } from '../errors'
import { parseJsonBody } from '../http'
import type { Gateway } from './gateway'
import * as interviews from '../interviews'
import { generateQuestions, commentOnAnswer, summariseInterview } from './interview-ai'
import { decideProposal, getJobMemory, starQuestion } from '../memory'

export interface InterviewRoutesDeps {
  db: DB
  paths: JobpinPaths
  gateway: Pick<Gateway, 'complete'>
}

/**
 * Design spec section 8: the interview-loop + memory REST surface. Every handler is thin
 * (parse params/body -> call the service -> c.json); typed service errors (Validation/NotFound/
 * Conflict/Gateway) bubble to the shared `onError` mapping installed by `registerJobRoutes`
 * (routes.ts), so no error handling lives here.
 */
export function registerInterviewRoutes(app: Hono, deps: InterviewRoutesDeps): void {
  app.post('/candidates/:id/interviews', c => {
    const candidateId = Number(c.req.param('id'))
    return c.json({ interview: interviews.createInterview(deps, candidateId) }, 201)
  })

  app.get('/candidates/:id/interviews', c => {
    const candidateId = Number(c.req.param('id'))
    return c.json(interviews.listInterviews(deps, candidateId))
  })

  app.get('/interviews/:id', c => {
    const interviewId = Number(c.req.param('id'))
    return c.json(interviews.getInterview(deps, interviewId))
  })

  app.patch('/interviews/:id', async c => {
    const interviewId = Number(c.req.param('id'))
    const body = await parseJsonBody<{ bossDecision: string }>(c)
    interviews.setBossDecision(deps, interviewId, body.bossDecision ?? '')
    return c.json({ interview: interviews.getInterview(deps, interviewId).interview })
  })

  app.post('/interviews/:id/questions/generate', async c => {
    const interviewId = Number(c.req.param('id'))
    return c.json(await generateQuestions(deps, interviewId))
  })

  app.post('/interviews/:id/questions', async c => {
    const interviewId = Number(c.req.param('id'))
    const body = await parseJsonBody<{ text: string; category: string }>(c)
    return c.json(interviews.addQuestion(deps, interviewId, { text: body.text ?? '', category: body.category }), 201)
  })

  app.post('/interview-questions/:id/star', c => {
    const questionId = Number(c.req.param('id'))
    const { questions } = starQuestion(deps, questionId)
    return c.json({ bank: questions })
  })

  app.put('/interview-questions/:id/answer', async c => {
    const questionId = Number(c.req.param('id'))
    const body = await parseJsonBody<{ answerText: string; bossNote: string; affectsRanking: boolean }>(c)
    return c.json(interviews.saveAnswer(deps, questionId, body))
  })

  app.post('/interview-questions/:id/ai-comment', async c => {
    const questionId = Number(c.req.param('id'))
    return c.json(await commentOnAnswer(deps, questionId))
  })

  app.post('/interviews/:id/summary', async c => {
    const interviewId = Number(c.req.param('id'))
    return c.json(await summariseInterview(deps, interviewId))
  })

  /**
   * The stored-summary read (I-3): lets the UI re-render the last narrative on page load
   * without re-calling the model. 404s if the interview is unknown or has never been
   * summarised (`summary_path` still null). The candidate's `interview_summary` rows are
   * self-describing (each embeds the `interviewId` it belongs to - see interview-ai.ts),
   * so a candidate with multiple interview rounds still resolves to the right one: newest
   * row first, first one whose embedded id matches wins. Rows written before that field
   * existed have no `interviewId` at all; since this interview's `summary_path` is already
   * known non-null, the newest such legacy row is the best available match.
   */
  app.get('/interviews/:id/summary', c => {
    const interviewId = Number(c.req.param('id'))
    const { interview } = interviews.getInterview(deps, interviewId) // 404s if the interview is unknown
    if (interview.summaryPath === null) throw new NotFoundError(`interview ${interviewId} has no summary yet`)

    const rows = deps.db
      .prepare(
        `SELECT id, created_at AS createdAt, output_path AS outputPath
         FROM ai_analyses WHERE candidate_id = ? AND kind = 'interview_summary' AND output_path != ''
         ORDER BY id DESC`
      )
      .all(interview.candidateId) as { id: number; createdAt: string; outputPath: string }[]

    const parsed = rows
      .filter(r => existsSync(join(deps.paths.dataRoot, r.outputPath)))
      .map(r => ({
        id: r.id,
        createdAt: r.createdAt,
        output: JSON.parse(readFileSync(join(deps.paths.dataRoot, r.outputPath), 'utf8')) as { interviewId?: number }
      }))

    const match =
      parsed.find(r => r.output.interviewId === interviewId) ??
      parsed.find(r => r.output.interviewId === undefined)
    if (!match) throw new NotFoundError(`no summary output found for interview ${interviewId}`)

    const proposalRows = deps.db
      .prepare(
        `SELECT id, content FROM memory_events
         WHERE source_type = 'interview' AND source_id = ? AND status = 'pending'
         ORDER BY id ASC`
      )
      .all(interviewId) as { id: number; content: string }[]
    const proposals = proposalRows.map(p => {
      const content = JSON.parse(p.content) as { lesson: string; evidence: { quote: string; source: string }[] }
      return { id: p.id, status: 'pending' as const, lesson: content.lesson, evidence: content.evidence }
    })

    return c.json({ analysisId: match.id, createdAt: match.createdAt, output: match.output, proposals })
  })

  app.post('/memory-events/:id/approve', c => {
    const eventId = Number(c.req.param('id'))
    return c.json({ event: decideProposal(deps, eventId, 'approved') })
  })

  app.post('/memory-events/:id/reject', c => {
    const eventId = Number(c.req.param('id'))
    return c.json({ event: decideProposal(deps, eventId, 'rejected') })
  })

  app.get('/jobs/:id/memory', c => {
    const jobId = Number(c.req.param('id'))
    return c.json(getJobMemory(deps, jobId))
  })
}
