import type { Hono } from 'hono'
import type { DB } from '../db'
import type { JobpinPaths } from '../paths'
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
    const body = (await c.req.json()) as { bossDecision?: string }
    interviews.setBossDecision(deps, interviewId, body.bossDecision ?? '')
    return c.json({ interview: interviews.getInterview(deps, interviewId).interview })
  })

  app.post('/interviews/:id/questions/generate', async c => {
    const interviewId = Number(c.req.param('id'))
    return c.json(await generateQuestions(deps, interviewId))
  })

  app.post('/interviews/:id/questions', async c => {
    const interviewId = Number(c.req.param('id'))
    const body = (await c.req.json()) as { text?: string; category?: string }
    return c.json(interviews.addQuestion(deps, interviewId, { text: body.text ?? '', category: body.category }), 201)
  })

  app.post('/interview-questions/:id/star', c => {
    const questionId = Number(c.req.param('id'))
    const { questions } = starQuestion(deps, questionId)
    return c.json({ bank: questions })
  })

  app.put('/interview-questions/:id/answer', async c => {
    const questionId = Number(c.req.param('id'))
    const body = (await c.req.json()) as { answerText?: string; bossNote?: string; affectsRanking?: boolean }
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
