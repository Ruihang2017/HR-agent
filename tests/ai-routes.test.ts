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
import type { AnalysisQueue } from '../src/server/ai/queue'
import { validAnalysisFixture } from './fixtures/analysis-output'
import { rmrfWithRetry } from './helpers'

let tmp: string
let db: DB
let paths: JobpinPaths
let app: Hono
let queue: AnalysisQueue

const openaiBody = (content: string) =>
  JSON.stringify({
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 11, completion_tokens: 7 }
  })

const json = (body: unknown, method: 'POST' | 'PUT' | 'PATCH' = 'POST') => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
})

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jobpin-ai-routes-'))
  paths = getPaths(tmp)
  ensureScaffold(paths)
  db = openDatabase(paths.dbFile)
  runMigrations(db, migrations)

  const fetchFn = (async () =>
    new Response(openaiBody(JSON.stringify(validAnalysisFixture())), { status: 200 })) as typeof fetch

  const ai = createAiRuntime({
    db,
    paths,
    issuer: new DevTokenIssuer({ OPENAI_API_KEY: 'sk-test' }),
    fetchFn
  })
  queue = ai.queue
  app = createApp({ db, paths, version: '0.1.0', ai })
})

afterEach(() => {
  db.close()
  rmrfWithRetry(tmp)
})

/** Creates a job with one text candidate, enqueues + drains an analysis. */
async function createAnalysedCandidate(): Promise<{ jobId: number; candidateId: number; taskId: number }> {
  const jobRes = await app.request('/jobs', json({ name: 'Barista', jd: 'Serve coffee with care' }))
  const { id: jobId } = await jobRes.json()
  const candRes = await app.request(
    `/jobs/${jobId}/candidates`,
    json({ name: 'Pat', text: 'Ten years of sales experience.' })
  )
  const { id: candidateId } = await candRes.json()
  const enqueueRes = await app.request(`/jobs/${jobId}/analyses`, json({}))
  const { enqueued } = await enqueueRes.json()
  await queue.idle()
  return { jobId, candidateId, taskId: enqueued[0] }
}

describe('POST /jobs/:id/analyses + GET /jobs/:id/analyses', () => {
  it('enqueues, drains, and reports success with latestAnalysisId', async () => {
    const jobRes = await app.request('/jobs', json({ name: 'Barista', jd: 'Serve coffee' }))
    const { id: jobId } = await jobRes.json()
    const candRes = await app.request(
      `/jobs/${jobId}/candidates`,
      json({ name: 'Pat', text: 'Ten years of sales experience.' })
    )
    const { id: candidateId } = await candRes.json()

    const res = await app.request(`/jobs/${jobId}/analyses`, json({}))
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.enqueued).toHaveLength(1)
    expect(body.skipped).toEqual([])

    await queue.idle()

    const listRes = await app.request(`/jobs/${jobId}/analyses`)
    expect(listRes.status).toBe(200)
    const listBody = await listRes.json()
    const task = listBody.tasks.find((t: { id: number }) => t.id === body.enqueued[0])
    expect(task.status).toBe('succeeded')
    expect(listBody.latestByCandidate[candidateId]).toBeGreaterThan(0)
  })

  it('404 for an unknown job', async () => {
    const res = await app.request('/jobs/999/analyses', json({}))
    expect(res.status).toBe(404)
  })
})

describe('GET /candidates/:id/analysis', () => {
  it('200 with output/provider/model/promptVersion once analysed; 404 otherwise', async () => {
    const { candidateId } = await createAnalysedCandidate()

    const res = await app.request(`/candidates/${candidateId}/analysis`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.output.summary).toEqual(validAnalysisFixture().summary)
    expect(body.provider).toBe('openai')
    expect(body.model).toBe('gpt-5-mini')
    expect(body.promptVersion).toBe('candidate-analysis/v1')

    expect((await app.request('/candidates/999/analysis')).status).toBe(404)

    const jobRes = await app.request('/jobs', json({ name: 'Cashier', jd: 'Handle cash' }))
    const { id: otherJobId } = await jobRes.json()
    const unanalysedRes = await app.request(
      `/jobs/${otherJobId}/candidates`,
      json({ name: 'Sam', text: 'Five years in retail.' })
    )
    const { id: unanalysedId } = await unanalysedRes.json()
    expect((await app.request(`/candidates/${unanalysedId}/analysis`)).status).toBe(404)
  })
})

describe('POST /analysis-tasks/:id/retry', () => {
  it('409 on a succeeded task; 404 on an unknown task', async () => {
    const { taskId } = await createAnalysedCandidate()
    expect((await app.request(`/analysis-tasks/${taskId}/retry`, json({}))).status).toBe(409)
    expect((await app.request('/analysis-tasks/999999/retry', json({}))).status).toBe(404)
  })
})

describe('rankings routes', () => {
  it('400 with no analyses; 201 after one; list + detail + 404 for unknown ranking', async () => {
    const emptyJobRes = await app.request('/jobs', json({ name: 'Empty Job', jd: 'JD' }))
    const { id: emptyJobId } = await emptyJobRes.json()
    expect((await app.request(`/jobs/${emptyJobId}/rankings`, json({}))).status).toBe(400)

    const { jobId, candidateId } = await createAnalysedCandidate()
    const createRes = await app.request(`/jobs/${jobId}/rankings`, json({}))
    expect(createRes.status).toBe(201)
    const created = await createRes.json()
    expect(created.items).toHaveLength(1)
    expect(created.items[0].candidateId).toBe(candidateId)
    expect(created.excluded).toEqual([])

    const listRes = await app.request(`/jobs/${jobId}/rankings`)
    expect(listRes.status).toBe(200)
    expect(await listRes.json()).toHaveLength(1)

    const detailRes = await app.request(`/rankings/${created.rankingId}`)
    expect(detailRes.status).toBe(200)
    const detail = await detailRes.json()
    expect(detail.items[0].candidateName).toBe('Pat')

    expect((await app.request('/rankings/999999')).status).toBe(404)
  })
})

describe('GET /ai/catalog', () => {
  it('lists three providers with model id/label/tiers, a disclosure, and the active plan', async () => {
    const res = await app.request('/ai/catalog')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.plan).toBeDefined()
    expect(body.providers).toHaveLength(3)
    for (const provider of body.providers) {
      expect(typeof provider.disclosure).toBe('string')
      expect(provider.disclosure.length).toBeGreaterThan(0)
      expect(provider.models.length).toBeGreaterThan(0)
      for (const model of provider.models) {
        expect(typeof model.id).toBe('string')
        expect(typeof model.label).toBe('string')
        expect(Array.isArray(model.tiers)).toBe(true)
      }
    }
  })
})

describe('AI settings routes', () => {
  it('GET returns the default; PUT persists a valid selection; off-catalog PUT is 400', async () => {
    const defaultRes = await app.request('/ai/settings')
    expect(defaultRes.status).toBe(200)
    expect(await defaultRes.json()).toEqual({ provider: 'openai', model: 'gpt-5-mini' })

    const putRes = await app.request('/ai/settings', json({ provider: 'anthropic', model: 'claude-haiku-4-5' }, 'PUT'))
    expect(putRes.status).toBe(200)
    expect(await putRes.json()).toEqual({ provider: 'anthropic', model: 'claude-haiku-4-5' })

    const getAfter = await app.request('/ai/settings')
    expect(await getAfter.json()).toEqual({ provider: 'anthropic', model: 'claude-haiku-4-5' })

    const badRes = await app.request('/ai/settings', json({ provider: 'openai', model: 'not-a-real-model' }, 'PUT'))
    expect(badRes.status).toBe(400)
  })
})

describe('GET /ai/usage', () => {
  it('reports plan, allowanceTokens, and usedTokens reflecting the analysis just run', async () => {
    await createAnalysedCandidate()
    const res = await app.request('/ai/usage')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.plan).toBeDefined()
    expect(typeof body.allowanceTokens).toBe('number')
    expect(body.usedTokens).toBe(18) // stubbed usage: 11 prompt + 7 completion
  })
})
