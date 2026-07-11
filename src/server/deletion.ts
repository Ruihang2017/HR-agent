import path from 'node:path'
import type { DB } from './db'
import type { JobpinPaths } from './paths'
import { NotFoundError } from './errors'
import { candidateFolderFor } from './interviews'
import { rmrfWithRetry } from './fsx'

/**
 * Phase 5 data-protection deletion service (D-17). Two operations, both wrapped in exactly
 * one `db.transaction` that opens a `maintenance_flags` gate (migration 0004) immediately
 * before the one write it exists for and closes it immediately after - see
 * `src/server/migrations/0004_snapshot_maintenance.ts` for why the gate exists and what it
 * protects (PRD invariant 11.1-5: ranking snapshots are otherwise immutable by trigger).
 *
 * `deleteCandidate` **anonymises**: the candidate row survives (name/email/phone scrubbed,
 * status='deleted') so its ranking_items rows stay referentially valid and their rank/score
 * remain part of the historical snapshot - only `reason` is scrubbed, via the
 * 'allow-reason-scrub' gate. `deleteJob` **cascades**: every candidate, every snapshot for
 * the job, and the job itself are deleted outright, via the 'allow-snapshot-delete' gate.
 *
 * Both write the DB transaction FIRST (the durable record) and remove the filesystem folder
 * SECOND, outside the transaction: a folder-removal failure must never roll back an already
 * committed anonymisation/cascade, so it is logged and rethrown for the UI to surface while
 * the DB is left in its (already consistent) post-transaction state.
 */
export interface DeletionDeps {
  db: DB
  paths: JobpinPaths
  dataKey?: Buffer
}

interface ProposalContent {
  lesson: string
  evidence: { quote: string; source: string }[]
  refusalReason?: string
}

function jobFolderOr404(db: DB, jobId: number): string {
  const row = db.prepare('SELECT folder_path FROM jobs WHERE id = ?').get(jobId) as { folder_path: string } | undefined
  if (!row) throw new NotFoundError(`job ${jobId} not found`)
  return row.folder_path
}

/** `content.evidence[*].quote` -> '[removed]' for every memory_events row sourced from these interview ids; lesson/refusalReason untouched. */
function scrubMemoryEvents(db: DB, interviewIds: number[]): void {
  if (interviewIds.length === 0) return
  const placeholders = interviewIds.map(() => '?').join(', ')
  const rows = db
    .prepare(`SELECT id, content FROM memory_events WHERE source_type = 'interview' AND source_id IN (${placeholders})`)
    .all(...interviewIds) as { id: number; content: string }[]
  const update = db.prepare('UPDATE memory_events SET content = ? WHERE id = ?')
  for (const row of rows) {
    const content = JSON.parse(row.content) as ProposalContent
    content.evidence = content.evidence.map(e => ({ ...e, quote: '[removed]' }))
    update.run(JSON.stringify(content), row.id)
  }
}

/**
 * Purges every child row scoped to one candidate: the interview cascade
 * (interview_answers -> interview_questions -> interviews, in that order so the FK checks
 * on each DELETE never see a dangling reference), candidate_documents, ai_analyses,
 * analysis_tasks - then scrubs (never deletes) that candidate's memory_events. Shared by
 * `deleteCandidate` (candidate row survives, anonymised) and `deleteJob` (candidate row is
 * deleted afterwards by the caller) - this function never touches the candidates row itself,
 * ranking_items, or emails.
 */
function purgeCandidateChildren(db: DB, candidateId: number): void {
  const interviewIds = (
    db.prepare('SELECT id FROM interviews WHERE candidate_id = ?').all(candidateId) as { id: number }[]
  ).map(r => r.id)

  if (interviewIds.length > 0) {
    const placeholders = interviewIds.map(() => '?').join(', ')
    db.prepare(
      `DELETE FROM interview_answers WHERE interview_question_id IN
         (SELECT id FROM interview_questions WHERE interview_id IN (${placeholders}))`
    ).run(...interviewIds)
    db.prepare(`DELETE FROM interview_questions WHERE interview_id IN (${placeholders})`).run(...interviewIds)
  }
  db.prepare('DELETE FROM interviews WHERE candidate_id = ?').run(candidateId)
  db.prepare('DELETE FROM candidate_documents WHERE candidate_id = ?').run(candidateId)
  db.prepare('DELETE FROM ai_analyses WHERE candidate_id = ?').run(candidateId)
  db.prepare('DELETE FROM analysis_tasks WHERE candidate_id = ?').run(candidateId)

  scrubMemoryEvents(db, interviewIds)
}

/**
 * Anonymises one candidate (PRD D-17): scrubs PII off the `candidates` row (name/email/phone,
 * status='deleted') rather than deleting it, so its ranking_items rows keep a valid FK and
 * their rank/score stand as-is in every past snapshot - only `reason` is scrubbed, gated
 * behind 'allow-reason-scrub' (migration 0004). Purges every other child row and scrubs
 * memory_events evidence quotes sourced from this candidate's interviews. `learned_skills.md`
 * (job-level, approved knowledge) is never touched. The candidate's folder is removed via
 * `rmrfWithRetry` AFTER the transaction commits - a removal failure logs and rethrows without
 * undoing the already-durable anonymisation.
 */
export function deleteCandidate(deps: DeletionDeps, candidateId: number): void {
  const { db, paths } = deps
  const candidateFolderRel = candidateFolderFor(db, candidateId) // 404s if unknown

  db.transaction(() => {
    db.prepare("INSERT INTO maintenance_flags (flag) VALUES ('allow-reason-scrub')").run()
    db.prepare("UPDATE ranking_items SET reason = '[removed - candidate deleted]' WHERE candidate_id = ?").run(
      candidateId
    )
    purgeCandidateChildren(db, candidateId)
    db.prepare(
      "UPDATE candidates SET name = 'Deleted candidate', email = NULL, phone = NULL, status = 'deleted' WHERE id = ?"
    ).run(candidateId)
    db.prepare("DELETE FROM maintenance_flags WHERE flag = 'allow-reason-scrub'").run()
  })()

  const folderAbs = path.join(paths.dataRoot, candidateFolderRel)
  try {
    rmrfWithRetry(folderAbs)
  } catch (e) {
    console.error(`deleteCandidate: failed to remove candidate folder "${folderAbs}" after anonymisation`, e)
    throw e
  }
}

/**
 * Cascades a full job deletion (PRD D-17): every candidate's child rows are purged (the same
 * purge as `deleteCandidate`, minus the ranking_items reason scrub and the candidates
 * anonymise-in-place - there is no point anonymising a row about to be deleted), then the
 * whole snapshot history (ranking_items, rankings) and every candidate/email/the job row
 * itself are deleted outright, gated behind 'allow-snapshot-delete' (migration 0004). The job
 * folder (including `learned_skills.md`) is removed via `rmrfWithRetry` AFTER the transaction
 * commits, same fail-loud-after-commit discipline as `deleteCandidate`.
 */
export function deleteJob(deps: DeletionDeps, jobId: number): void {
  const { db, paths } = deps
  const folderRel = jobFolderOr404(db, jobId) // 404s if unknown

  db.transaction(() => {
    const candidateIds = (
      db.prepare('SELECT id FROM candidates WHERE job_id = ?').all(jobId) as { id: number }[]
    ).map(r => r.id)
    for (const candidateId of candidateIds) purgeCandidateChildren(db, candidateId)

    db.prepare("INSERT INTO maintenance_flags (flag) VALUES ('allow-snapshot-delete')").run()
    db.prepare('DELETE FROM ranking_items WHERE ranking_id IN (SELECT id FROM rankings WHERE job_id = ?)').run(jobId)
    db.prepare('DELETE FROM rankings WHERE job_id = ?').run(jobId)

    if (candidateIds.length > 0) {
      const placeholders = candidateIds.map(() => '?').join(', ')
      db.prepare(`DELETE FROM emails WHERE candidate_id IN (${placeholders})`).run(...candidateIds)
    }
    db.prepare('DELETE FROM candidates WHERE job_id = ?').run(jobId)
    db.prepare('DELETE FROM jobs WHERE id = ?').run(jobId)
    db.prepare("DELETE FROM maintenance_flags WHERE flag = 'allow-snapshot-delete'").run()
  })()

  const folderAbs = path.join(paths.dataRoot, folderRel)
  try {
    rmrfWithRetry(folderAbs)
  } catch (e) {
    console.error(`deleteJob: failed to remove job folder "${folderAbs}" after cascade delete`, e)
    throw e
  }
}
