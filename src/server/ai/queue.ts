import type { DB } from '../db'
import type { JobpinPaths } from '../paths'
import { ConflictError, NotFoundError } from '../errors'
import { GatewayError, type Gateway } from './gateway'
import { analyzeCandidate as realAnalyze } from './analyze'

export interface TaskRow {
  id: number; job_id: number; candidate_id: number
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  error: string | null; attempts: number
  created_at: string; started_at: string | null; finished_at: string | null
}

export interface AnalysisQueue {
  enqueueAnalyses(jobId: number, candidateIds?: number[]): { enqueued: number[]; skipped: { candidateId: number; reason: string }[] }
  retry(taskId: number): TaskRow
  listForJob(jobId: number): TaskRow[]
  resetRunning(): number
  kick(): void
  idle(): Promise<void>
}

export function createQueue(deps: {
  db: DB; paths: JobpinPaths; gateway: Pick<Gateway, 'complete'>
  analyze?: typeof realAnalyze; concurrency?: number
}): AnalysisQueue {
  const { db, paths, gateway } = deps
  const analyze = deps.analyze ?? realAnalyze
  const concurrency = deps.concurrency ?? 2
  let active = 0

  const claim = (): TaskRow | undefined =>
    db.prepare(
      `UPDATE analysis_tasks
       SET status='running', attempts=attempts+1, started_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = (SELECT id FROM analysis_tasks WHERE status='queued' ORDER BY id LIMIT 1)
       RETURNING *`
    ).get() as TaskRow | undefined

  const finish = db.prepare(
    "UPDATE analysis_tasks SET status=?, error=?, finished_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?"
  )

  async function loop(): Promise<void> {
    for (;;) {
      const task = claim()
      if (!task) return
      try {
        await analyze({ db, paths, gateway }, task.candidate_id)
        finish.run('succeeded', null, task.id)
      } catch (e) {
        const msg = e instanceof GatewayError ? `${e.code}: ${e.message}` : `error: ${(e as Error).message}`
        finish.run('failed', msg, task.id)
      }
    }
  }

  const kick = (): void => {
    while (active < concurrency) {
      active++
      void loop()
        .catch(err => { console.error('analysis worker crashed:', err) })
        .finally(() => { active-- })
    }
  }

  return {
    enqueueAnalyses(jobId, candidateIds) {
      const job = db.prepare('SELECT id FROM jobs WHERE id = ?').get(jobId)
      if (!job) throw new NotFoundError(`job ${jobId} not found`)
      const explicit = candidateIds !== undefined
      const rows = db.prepare('SELECT id FROM candidates WHERE job_id = ?').all(jobId) as { id: number }[]
      const inJob = new Set(rows.map(r => r.id))
      const targets = explicit ? candidateIds : rows.map(r => r.id)

      const hasText = db.prepare(
        "SELECT 1 FROM candidate_documents WHERE candidate_id = ? AND type='resume' AND extracted_text_path IS NOT NULL"
      )
      const pendingTask = db.prepare(
        "SELECT 1 FROM analysis_tasks WHERE candidate_id = ? AND status IN ('queued','running')"
      )
      const doneTask = db.prepare(
        "SELECT 1 FROM analysis_tasks WHERE candidate_id = ? AND status = 'succeeded'"
      )
      const insert = db.prepare('INSERT INTO analysis_tasks (job_id, candidate_id) VALUES (?, ?)')

      const enqueued: number[] = []
      const skipped: { candidateId: number; reason: string }[] = []
      for (const cid of targets) {
        if (!inJob.has(cid)) { skipped.push({ candidateId: cid, reason: 'not in this job' }); continue }
        if (!hasText.get(cid)) { skipped.push({ candidateId: cid, reason: 'no extracted text' }); continue }
        if (pendingTask.get(cid)) { skipped.push({ candidateId: cid, reason: 'already queued or running' }); continue }
        if (!explicit && doneTask.get(cid)) { skipped.push({ candidateId: cid, reason: 'already analysed' }); continue }
        enqueued.push(Number(insert.run(jobId, cid).lastInsertRowid))
      }
      if (enqueued.length) kick()
      return { enqueued, skipped }
    },

    retry(taskId) {
      const task = db.prepare('SELECT * FROM analysis_tasks WHERE id = ?').get(taskId) as TaskRow | undefined
      if (!task) throw new NotFoundError(`analysis task ${taskId} not found`)
      if (task.status !== 'failed') throw new ConflictError(`task ${taskId} is ${task.status}; only failed tasks can be retried`)
      db.prepare("UPDATE analysis_tasks SET status='queued', error=NULL, finished_at=NULL WHERE id=?").run(taskId)
      kick()
      return db.prepare('SELECT * FROM analysis_tasks WHERE id = ?').get(taskId) as TaskRow
    },

    listForJob(jobId) {
      return db.prepare('SELECT * FROM analysis_tasks WHERE job_id = ? ORDER BY id').all(jobId) as TaskRow[]
    },

    resetRunning() {
      return db.prepare("UPDATE analysis_tasks SET status='queued', started_at=NULL WHERE status='running'").run().changes
    },

    kick,

    async idle() {
      for (;;) {
        const busy = db.prepare("SELECT COUNT(*) AS n FROM analysis_tasks WHERE status IN ('queued','running')").get() as { n: number }
        if (busy.n === 0 && active === 0) return
        await new Promise(r => setTimeout(r, 25))
      }
    }
  }
}
