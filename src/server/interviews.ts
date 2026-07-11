import type { DB } from './db'
import type { JobpinPaths } from './paths'
import { NotFoundError, ValidationError } from './errors'
import { writeCandidateFile } from './candidate-fs'

export interface InterviewDeps {
  db: DB
  paths: JobpinPaths
  dataKey?: Buffer
}

/** The five F5.1 categories (design spec section 4). */
export const INTERVIEW_CATEGORIES = ['standard', 'resume_specific', 'jd_risk', 'boss_favourite', 'follow_up'] as const
export type InterviewCategory = (typeof INTERVIEW_CATEGORIES)[number]

export interface InterviewRow {
  id: number
  candidateId: number
  stage: number
  mode: string
  scheduledAt: string | null
  transcriptPath: string | null
  summaryPath: string | null
  aiScore: number | null
  bossDecision: string | null
  createdAt: string
}

export interface InterviewListRow extends InterviewRow {
  hasSummary: boolean
}

export interface QuestionRow {
  id: number
  interviewId: number
  orderIndex: number
  category: string
  text: string
  source: string
  createdAt: string
}

export interface InterviewItem {
  questionId: number
  orderIndex: number
  category: string
  text: string
  source: string
  answer: {
    answerText: string | null
    bossNote: string | null
    aiComment: string | null
    confidence: number | null
    affectsRanking: boolean
  } | null
}

interface RawInterviewRow {
  id: number
  candidate_id: number
  stage: number
  mode: string
  scheduled_at: string | null
  transcript_path: string | null
  summary_path: string | null
  ai_score: number | null
  boss_decision: string | null
  created_at: string
}

interface RawQuestionRow {
  id: number
  interview_id: number
  order_index: number
  category: string
  text: string
  source: string
  created_at: string
}

interface RawItemRow {
  questionId: number
  orderIndex: number
  category: string
  text: string
  source: string
  answerId: number | null
  answerText: string | null
  bossNote: string | null
  aiComment: string | null
  confidence: number | null
  affectsRanking: number | null
}

function mapInterviewRow(row: RawInterviewRow): InterviewRow {
  return {
    id: row.id,
    candidateId: row.candidate_id,
    stage: row.stage,
    mode: row.mode,
    scheduledAt: row.scheduled_at,
    transcriptPath: row.transcript_path,
    summaryPath: row.summary_path,
    aiScore: row.ai_score,
    bossDecision: row.boss_decision,
    createdAt: row.created_at
  }
}

function mapQuestionRow(row: RawQuestionRow): QuestionRow {
  return {
    id: row.id,
    interviewId: row.interview_id,
    orderIndex: row.order_index,
    category: row.category,
    text: row.text,
    source: row.source,
    createdAt: row.created_at
  }
}

function interviewRowOr404(db: DB, interviewId: number): RawInterviewRow {
  const row = db.prepare('SELECT * FROM interviews WHERE id = ?').get(interviewId) as RawInterviewRow | undefined
  if (!row) throw new NotFoundError(`interview ${interviewId} not found`)
  return row
}

function questionRowOr404(db: DB, questionId: number): RawQuestionRow {
  const row = db.prepare('SELECT * FROM interview_questions WHERE id = ?').get(questionId) as RawQuestionRow | undefined
  if (!row) throw new NotFoundError(`interview question ${questionId} not found`)
  return row
}

/** 'jobs/<folder>/candidates/candidate_<id>' - resolved via the candidate's job. 404s if unknown. */
export function candidateFolderFor(db: DB, candidateId: number): string {
  const row = db
    .prepare('SELECT j.folder_path AS folderPath FROM candidates c JOIN jobs j ON j.id = c.job_id WHERE c.id = ?')
    .get(candidateId) as { folderPath: string } | undefined
  if (!row) throw new NotFoundError(`candidate ${candidateId} not found`)
  return `${row.folderPath}/candidates/candidate_${candidateId}`
}

/**
 * Shared guard (D-17) for write paths that would otherwise recreate a deleted candidate's
 * folder: `createInterview` here and `saveEmail` (emails.ts) both write a new file under the
 * candidate's folder as their very first side effect, so both call this before doing anything
 * else. 404s the same way for "never existed" and "deleted" - a resurrected candidate must be
 * indistinguishable, from the caller's perspective, from one that was never there.
 */
export function assertCandidateNotDeleted(db: DB, candidateId: number): void {
  const row = db.prepare('SELECT status FROM candidates WHERE id = ?').get(candidateId) as { status: string } | undefined
  if (!row) throw new NotFoundError(`candidate ${candidateId} not found`)
  if (row.status === 'deleted') throw new NotFoundError(`candidate ${candidateId} not found`)
}

/** Every question in a round joined to its (possibly absent) answer, in order_index order. */
function loadItems(db: DB, interviewId: number): InterviewItem[] {
  const rows = db
    .prepare(
      `SELECT q.id AS questionId, q.order_index AS orderIndex, q.category, q.text, q.source,
              a.id AS answerId, a.answer_text AS answerText, a.boss_note AS bossNote,
              a.ai_comment AS aiComment, a.confidence AS confidence, a.affects_ranking AS affectsRanking
       FROM interview_questions q
       LEFT JOIN interview_answers a ON a.interview_question_id = q.id
       WHERE q.interview_id = ?
       ORDER BY q.order_index ASC`
    )
    .all(interviewId) as RawItemRow[]
  return rows.map(r => ({
    questionId: r.questionId,
    orderIndex: r.orderIndex,
    category: r.category,
    text: r.text,
    source: r.source,
    answer:
      r.answerId === null
        ? null
        : {
            answerText: r.answerText,
            bossNote: r.bossNote,
            aiComment: r.aiComment,
            confidence: r.confidence,
            affectsRanking: !!r.affectsRanking
          }
  }))
}

/**
 * Rewrites `interviews/round-<stage>-record.json` under the candidate folder from the current
 * DB state - the file-first mirror consumed by the AI pipelines (Tasks 5/6/9) and the UI.
 * Creates the `interviews/` directory as needed and sets `interviews.transcript_path` the first
 * time it is written (never overwritten afterwards). fs failures here throw and surface to the
 * caller; the DB rows that produced this write remain valid and the next mutation rewrites the file.
 */
export function writeRecordMirror(deps: InterviewDeps, interviewId: number): void {
  const { db } = deps
  const row = interviewRowOr404(db, interviewId)
  const items = loadItems(db, interviewId)
  const candFolderRel = candidateFolderFor(db, row.candidate_id)
  const interviewsDirRel = `${candFolderRel}/interviews`
  const recordRel = `${interviewsDirRel}/round-${row.stage}-record.json`
  const record = { stage: row.stage, createdAt: row.created_at, bossDecision: row.boss_decision, items }
  writeCandidateFile(deps, recordRel, JSON.stringify(record, null, 2) + '\n')
  if (row.transcript_path === null) {
    db.prepare('UPDATE interviews SET transcript_path = ? WHERE id = ?').run(recordRel, interviewId)
  }
}

/** Opens a new round for the candidate: stage = COALESCE(MAX(stage),0)+1, mode='manual'. */
export function createInterview(deps: InterviewDeps, candidateId: number): InterviewRow {
  const { db } = deps
  candidateFolderFor(db, candidateId) // 404s if the candidate is unknown
  assertCandidateNotDeleted(db, candidateId) // D-17: no new interview round for a deleted candidate

  const id = db.transaction((): number => {
    const { m } = db
      .prepare('SELECT COALESCE(MAX(stage), 0) AS m FROM interviews WHERE candidate_id = ?')
      .get(candidateId) as { m: number }
    const info = db
      .prepare("INSERT INTO interviews (candidate_id, stage, mode) VALUES (?, ?, 'manual')")
      .run(candidateId, m + 1)
    return Number(info.lastInsertRowid)
  })()

  writeRecordMirror(deps, id)
  return mapInterviewRow(interviewRowOr404(db, id))
}

/** Every round for a candidate, oldest stage first, with a summary-exists flag for the UI. */
export function listInterviews(deps: InterviewDeps, candidateId: number): InterviewListRow[] {
  const { db } = deps
  candidateFolderFor(db, candidateId) // 404s if the candidate is unknown
  const rows = db
    .prepare('SELECT * FROM interviews WHERE candidate_id = ? ORDER BY stage ASC')
    .all(candidateId) as RawInterviewRow[]
  return rows.map(r => ({ ...mapInterviewRow(r), hasSummary: r.summary_path !== null }))
}

export function getInterview(deps: InterviewDeps, interviewId: number): { interview: InterviewRow; items: InterviewItem[] } {
  const { db } = deps
  const interview = mapInterviewRow(interviewRowOr404(db, interviewId))
  return { interview, items: loadItems(db, interviewId) }
}

/** Appends a question: order_index = MAX+1, category defaults to 'standard' and is validated. */
export function addQuestion(
  deps: InterviewDeps,
  interviewId: number,
  q: { text: string; category?: string; source?: 'manual' | 'generated' }
): QuestionRow {
  const { db } = deps
  interviewRowOr404(db, interviewId) // 404s if the interview is unknown

  const category = q.category ?? 'standard'
  if (!(INTERVIEW_CATEGORIES as readonly string[]).includes(category)) {
    throw new ValidationError(`invalid category "${category}"; must be one of ${INTERVIEW_CATEGORIES.join(', ')}`)
  }
  const text = (q.text ?? '').trim()
  if (!text) throw new ValidationError('question text is required')
  const source = q.source ?? 'manual'

  const id = db.transaction((): number => {
    const { m } = db
      .prepare('SELECT COALESCE(MAX(order_index), 0) AS m FROM interview_questions WHERE interview_id = ?')
      .get(interviewId) as { m: number }
    const info = db
      .prepare(
        'INSERT INTO interview_questions (interview_id, order_index, category, text, source) VALUES (?, ?, ?, ?, ?)'
      )
      .run(interviewId, m + 1, category, text, source)
    return Number(info.lastInsertRowid)
  })()

  writeRecordMirror(deps, interviewId)
  return mapQuestionRow(questionRowOr404(db, id))
}

/** Upserts the 1:1 answer row for a question: inserts on first save, else updates only the provided fields. */
export function saveAnswer(
  deps: InterviewDeps,
  questionId: number,
  patch: { answerText?: string; bossNote?: string; affectsRanking?: boolean }
): InterviewItem {
  const { db } = deps
  const question = questionRowOr404(db, questionId) // 404s if the question is unknown

  db.transaction(() => {
    const existing = db
      .prepare('SELECT id FROM interview_answers WHERE interview_question_id = ?')
      .get(questionId) as { id: number } | undefined

    if (!existing) {
      db.prepare(
        'INSERT INTO interview_answers (interview_question_id, answer_text, boss_note, affects_ranking) VALUES (?, ?, ?, ?)'
      ).run(questionId, patch.answerText ?? null, patch.bossNote ?? null, patch.affectsRanking ? 1 : 0)
      return
    }

    const sets: string[] = []
    const params: (string | number)[] = []
    if (patch.answerText !== undefined) {
      sets.push('answer_text = ?')
      params.push(patch.answerText)
    }
    if (patch.bossNote !== undefined) {
      sets.push('boss_note = ?')
      params.push(patch.bossNote)
    }
    if (patch.affectsRanking !== undefined) {
      sets.push('affects_ranking = ?')
      params.push(patch.affectsRanking ? 1 : 0)
    }
    if (sets.length === 0) return
    params.push(existing.id)
    db.prepare(`UPDATE interview_answers SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  })()

  writeRecordMirror(deps, question.interview_id)
  const item = loadItems(db, question.interview_id).find(i => i.questionId === questionId)
  /* c8 ignore next */
  if (!item) throw new NotFoundError(`interview question ${questionId} not found`)
  return item
}

/** Boss decision is free text set only by the boss (F4.4), kept separate from every AI output. */
export function setBossDecision(deps: InterviewDeps, interviewId: number, decision: string): void {
  const { db } = deps
  interviewRowOr404(db, interviewId) // 404s if the interview is unknown
  const trimmed = (decision ?? '').trim()
  if (!trimmed) throw new ValidationError('boss decision is required')
  db.prepare('UPDATE interviews SET boss_decision = ? WHERE id = ?').run(trimmed, interviewId)
  writeRecordMirror(deps, interviewId)
}
