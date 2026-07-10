import type { Hono } from 'hono'
import type { DB } from '../db'
import type { JobpinPaths } from '../paths'
import { NotFoundError, ValidationError } from '../errors'
import type { AnalysisQueue } from './queue'
import { CATALOG, disclosureFor, type Provider } from './catalog'
import { getPlan } from './subscription'
import { getAiSettings, setAiSettings } from './settings'
import { getRanking, listRankings, runRanking } from '../ranking'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export function registerAiRoutes(app: Hono, deps: { db: DB; paths: JobpinPaths; queue: AnalysisQueue }): void {
  const { db, paths, queue } = deps

  app.post('/jobs/:id/analyses', async c => {
    const jobId = Number(c.req.param('id'))
    const raw = await c.req.text()
    let body: { candidateIds?: number[] } = {}
    if (raw.trim().length > 0) {
      try {
        body = JSON.parse(raw) as { candidateIds?: number[] }
      } catch {
        throw new ValidationError('request body must be valid JSON')
      }
    }
    return c.json(queue.enqueueAnalyses(jobId, body.candidateIds), 202)
  })

  app.get('/jobs/:id/analyses', c => {
    const jobId = Number(c.req.param('id'))
    if (!db.prepare('SELECT id FROM jobs WHERE id=?').get(jobId)) throw new NotFoundError(`job ${jobId} not found`)
    const tasks = queue.listForJob(jobId)
    const latest = db.prepare(
      `SELECT candidate_id AS candidateId, MAX(id) AS latestAnalysisId FROM ai_analyses
       WHERE job_id=? AND kind='candidate_analysis' AND output_path != '' GROUP BY candidate_id`
    ).all(jobId) as { candidateId: number; latestAnalysisId: number }[]
    const latestByCandidate = Object.fromEntries(latest.map(l => [l.candidateId, l.latestAnalysisId]))
    return c.json({ tasks, latestByCandidate })
  })

  app.post('/analysis-tasks/:id/retry', c => c.json({ task: queue.retry(Number(c.req.param('id'))) }, 202))

  app.get('/candidates/:id/analysis', c => {
    const candidateId = Number(c.req.param('id'))
    const row = db.prepare(
      `SELECT id, provider, model, prompt_version AS promptVersion, output_path, created_at AS createdAt
       FROM ai_analyses WHERE candidate_id=? AND kind='candidate_analysis' AND output_path != ''
       ORDER BY id DESC LIMIT 1`
    ).get(candidateId) as { id: number; provider: string; model: string; promptVersion: string; output_path: string; createdAt: string } | undefined
    if (!row || !existsSync(join(paths.dataRoot, row.output_path))) {
      throw new NotFoundError(`no analysis for candidate ${candidateId}`)
    }
    const output = JSON.parse(readFileSync(join(paths.dataRoot, row.output_path), 'utf8'))
    return c.json({ analysisId: row.id, provider: row.provider, model: row.model, promptVersion: row.promptVersion, createdAt: row.createdAt, output })
  })

  app.post('/jobs/:id/rankings', c => {
    const result = runRanking({ db, paths }, Number(c.req.param('id')))
    return c.json(result, 201)
  })
  app.get('/jobs/:id/rankings', c => c.json(listRankings(db, Number(c.req.param('id')))))
  app.get('/rankings/:id', c => c.json(getRanking(db, Number(c.req.param('id')))))

  app.get('/ai/catalog', c => {
    const plan = getPlan()
    const providers = (Object.keys(CATALOG) as Provider[]).map(p => ({
      provider: p,
      disclosure: disclosureFor(p),
      models: CATALOG[p].filter(m => m.tiers.includes(plan.tier))
    }))
    return c.json({ plan, providers })
  })

  app.get('/ai/settings', c => c.json(getAiSettings(db)))
  app.put('/ai/settings', async c => {
    const body = (await c.req.json()) as { provider: Provider; model: string }
    setAiSettings(db, body)
    return c.json(getAiSettings(db))
  })

  app.get('/ai/usage', c => {
    const plan = getPlan()
    const used = db.prepare(
      "SELECT COALESCE(SUM(prompt_tokens + completion_tokens), 0) AS n FROM usage_events WHERE substr(created_at, 1, 7) = strftime('%Y-%m','now')"
    ).get() as { n: number }
    return c.json({ plan: plan.label, tier: plan.tier, allowanceTokens: plan.monthlyTokens, usedTokens: used.n, advisory: true })
  })
}
