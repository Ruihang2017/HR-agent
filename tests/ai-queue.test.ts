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
import { addCandidateFromFile, addCandidateFromText, type CandidateDetail } from '../src/server/candidates'
import { NotFoundError, ConflictError, ValidationError } from '../src/server/errors'
import { GatewayError } from '../src/server/ai/gateway'
import type { AnalyzeDeps } from '../src/server/ai/analyze'
import { createQueue, type AnalysisQueue, type TaskRow } from '../src/server/ai/queue'
import { rmrfWithRetry } from './helpers'

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures')
const read = (f: string) => new Uint8Array(fs.readFileSync(path.join(fixtures, f)))

interface Gate { resolve: () => void; reject: (e: Error) => void }

let tmp: string
let db: DB
let paths: JobpinPaths
let svcDeps: { db: DB; paths: JobpinPaths }
let jobId: number
let gates: Map<number, Gate>
let queue: AnalysisQueue

/** Fake analyze: pends until the test resolves/rejects the gate for this candidateId. */
function makeFakeAnalyze(): (deps: AnalyzeDeps, candidateId: number) => Promise<{ analysisId: number }> {
  return async (_deps: AnalyzeDeps, candidateId: number): Promise<{ analysisId: number }> => {
    await new Promise<void>((resolve, reject) => gates.set(candidateId, { resolve, reject }))
    return { analysisId: candidateId }
  }
}

/** Poll a predicate until true or the deadline passes (mirrors the queue's own idle() pattern). */
async function pollUntil(predicate: () => boolean, timeoutMs = 2000, stepMs = 25): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) return
    await new Promise(r => setTimeout(r, stepMs))
  }
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jobpin-queue-'))
  paths = getPaths(tmp)
  ensureScaffold(paths)
  db = openDatabase(paths.dbFile)
  runMigrations(db, migrations)
  svcDeps = { db, paths }
  const job = createJob(svcDeps, 'Barista', 'We need a friendly, reliable barista.')
  jobId = job.id
  gates = new Map()
  queue = createQueue({
    db,
    paths,
    gateway: { complete: async () => { throw new Error('not used') } },
    analyze: makeFakeAnalyze()
  })
})

afterEach(() => {
  db.close()
  rmrfWithRetry(tmp)
})

describe('AnalysisQueue', () => {
  it('enqueue all-new: enqueues candidates with text, skips those without', async () => {
    const c1 = await addCandidateFromText(svcDeps, jobId, 'Pat', 'Ten years of sales.')
    const c2 = await addCandidateFromText(svcDeps, jobId, 'Sam', 'Five years in retail.')
    const c3 = await addCandidateFromFile(svcDeps, jobId, 'corrupt.pdf', read('corrupt.pdf'))
    expect(c3.status).toBe('needs_review')

    const result = queue.enqueueAnalyses(jobId)

    // enqueued holds new analysis_tasks ids (not candidate ids) - map back to verify membership.
    expect(result.enqueued).toHaveLength(2)
    const enqueuedCandidateIds = queue
      .listForJob(jobId)
      .filter(r => result.enqueued.includes(r.id))
      .map(r => r.candidate_id)
      .sort((a, b) => a - b)
    expect(enqueuedCandidateIds).toEqual([c1.id, c2.id].sort((a, b) => a - b))
    expect(result.skipped).toEqual([{ candidateId: c3.id, reason: 'no extracted text' }])
  })

  it('dedupe: enqueuing a candidate already queued/running is skipped', async () => {
    const c = await addCandidateFromText(svcDeps, jobId, 'Pat', 'Ten years of sales.')

    const first = queue.enqueueAnalyses(jobId, [c.id])
    expect(first.enqueued).toHaveLength(1)
    expect(first.skipped).toEqual([])

    const second = queue.enqueueAnalyses(jobId, [c.id])
    expect(second.enqueued).toEqual([])
    expect(second.skipped).toEqual([{ candidateId: c.id, reason: 'already queued or running' }])

    gates.get(c.id)!.resolve()
    await queue.idle()
  })

  it('all-new skips already-analysed candidates; an explicit id re-enqueues them', async () => {
    const c = await addCandidateFromText(svcDeps, jobId, 'Pat', 'Ten years of sales.')
    queue.enqueueAnalyses(jobId, [c.id])
    gates.get(c.id)!.resolve()
    await queue.idle()

    const allNew = queue.enqueueAnalyses(jobId)
    expect(allNew.enqueued).toEqual([])
    expect(allNew.skipped).toEqual([{ candidateId: c.id, reason: 'already analysed' }])

    const explicit = queue.enqueueAnalyses(jobId, [c.id])
    expect(explicit.enqueued).toHaveLength(1)
    expect(explicit.skipped).toEqual([])

    gates.get(c.id)!.resolve()
    await queue.idle()
  })

  it('worker success bookkeeping: succeeded, attempts=1, started_at/finished_at set', async () => {
    const c = await addCandidateFromText(svcDeps, jobId, 'Pat', 'Ten years of sales.')
    const { enqueued } = queue.enqueueAnalyses(jobId, [c.id])
    const taskId = enqueued[0]

    gates.get(c.id)!.resolve()
    await queue.idle()

    const row = queue.listForJob(jobId).find(r => r.id === taskId)!
    expect(row.status).toBe('succeeded')
    expect(row.attempts).toBe(1)
    expect(row.error).toBeNull()
    expect(row.started_at).not.toBeNull()
    expect(row.finished_at).not.toBeNull()
  })

  it('records the GatewayError code and message when analyze rejects', async () => {
    const c = await addCandidateFromText(svcDeps, jobId, 'Pat', 'Ten years of sales.')
    const { enqueued } = queue.enqueueAnalyses(jobId, [c.id])
    const taskId = enqueued[0]

    gates.get(c.id)!.reject(new GatewayError('rate_limit', 'slow down'))
    await queue.idle()

    const row = queue.listForJob(jobId).find(r => r.id === taskId)!
    expect(row.status).toBe('failed')
    expect(row.error).toBe('rate_limit: slow down')
    expect(row.attempts).toBe(1)
  })

  it('caps concurrency at 2: exactly 2 running while the rest stay queued, then all succeed', async () => {
    const cands: CandidateDetail[] = []
    for (let i = 0; i < 4; i++) {
      cands.push(await addCandidateFromText(svcDeps, jobId, `Cand${i}`, `Resume text number ${i}.`))
    }
    const { enqueued } = queue.enqueueAnalyses(jobId, cands.map(c => c.id))
    expect(enqueued).toHaveLength(4)

    await pollUntil(() => {
      const rows = queue.listForJob(jobId)
      return rows.filter(r => r.status === 'running').length === 2 && rows.filter(r => r.status === 'queued').length === 2
    })
    const midRows = queue.listForJob(jobId)
    expect(midRows.filter(r => r.status === 'running')).toHaveLength(2)
    expect(midRows.filter(r => r.status === 'queued')).toHaveLength(2)

    // Resolve gates as they appear (the next 2 aren't claimed - and don't get a gate - until the first 2 finish).
    await pollUntil(() => {
      for (const c of cands) {
        const g = gates.get(c.id)
        if (g) {
          g.resolve()
          gates.delete(c.id)
        }
      }
      return queue.listForJob(jobId).every(r => r.status === 'succeeded')
    })
    await queue.idle()

    const finalRows = queue.listForJob(jobId)
    expect(finalRows.every(r => r.status === 'succeeded')).toBe(true)
  })

  it('resetRunning requeues rows stuck in "running" (boot recovery)', async () => {
    const c = await addCandidateFromText(svcDeps, jobId, 'Pat', 'Ten years of sales.')
    const info = db
      .prepare("INSERT INTO analysis_tasks (job_id, candidate_id, status, started_at) VALUES (?, ?, 'running', ?)")
      .run(jobId, c.id, new Date().toISOString())
    const taskId = Number(info.lastInsertRowid)

    const n = queue.resetRunning()
    expect(n).toBe(1)

    const row = queue.listForJob(jobId).find(r => r.id === taskId)!
    expect(row.status).toBe('queued')
    expect(row.started_at).toBeNull()
  })

  it('retry semantics: retries a failed task and clears its error; retrying a non-failed task conflicts', async () => {
    const c = await addCandidateFromText(svcDeps, jobId, 'Pat', 'Ten years of sales.')
    const { enqueued } = queue.enqueueAnalyses(jobId, [c.id])
    const taskId = enqueued[0]

    gates.get(c.id)!.reject(new GatewayError('rate_limit', 'slow down'))
    await queue.idle()
    expect(queue.listForJob(jobId).find(r => r.id === taskId)!.status).toBe('failed')

    // retry() re-queues then calls kick(), which (with no other work in flight) claims it
    // synchronously - so by the time we read it back it may already show 'running'.
    const retried = queue.retry(taskId)
    expect(retried.status).not.toBe('failed')
    expect(retried.error).toBeNull()

    gates.get(c.id)!.resolve()
    await queue.idle()
    const succeededRow = queue.listForJob(jobId).find(r => r.id === taskId)!
    expect(succeededRow.status).toBe('succeeded')

    expect(() => queue.retry(taskId)).toThrow(ConflictError)
  })

  it('rejects enqueueing analyses for a job with no JD (Bug B)', async () => {
    const jobNoJd = createJob(svcDeps, 'No JD Job')
    await addCandidateFromText(svcDeps, jobNoJd.id, 'Pat', 'Ten years of sales.')
    expect(() => queue.enqueueAnalyses(jobNoJd.id)).toThrow(ValidationError)
    expect(() => queue.enqueueAnalyses(jobNoJd.id)).toThrow(/no JD/)
  })

  it('membership: a candidate from another job is skipped; an unknown job throws NotFoundError', async () => {
    const otherJob = createJob(svcDeps, 'Cashier', 'Some JD')
    const otherCand = await addCandidateFromText(svcDeps, otherJob.id, 'Alex', 'Some resume text.')

    const result = queue.enqueueAnalyses(jobId, [otherCand.id])
    expect(result.enqueued).toEqual([])
    expect(result.skipped).toEqual([{ candidateId: otherCand.id, reason: 'not in this job' }])

    expect(() => queue.enqueueAnalyses(999999)).toThrow(NotFoundError)
  })
})
