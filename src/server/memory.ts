import fs from 'node:fs'
import path from 'node:path'
import type { DB } from './db'
import type { JobpinPaths } from './paths'
import { ConflictError, NotFoundError, ValidationError } from './errors'

export interface MemoryDeps {
  db: DB
  paths: JobpinPaths
}

/** Content JSON as written by Task 6's summariseInterview (`ai/interview-ai.ts`). */
interface ProposalContent {
  lesson: string
  evidence: { quote: string; source: string }[]
  refusalReason?: string
}

export interface MemoryEventRow {
  id: number
  scope: string
  scopeId: string | null
  sourceType: string | null
  sourceId: number | null
  content: string
  status: string
  approvedByBoss: boolean
  createdAt: string
}

export interface MemoryEventView {
  id: number
  status: string
  lesson: string
  evidence: { quote: string; source: string }[]
  refusalReason?: string
  sourceInterviewId: number | null
  createdAt: string
}

export interface BankEntry {
  text: string
  addedAt: string
}

interface RawMemoryEventRow {
  id: number
  scope: string
  scope_id: string | null
  source_type: string | null
  source_id: number | null
  content: string
  status: string
  approved_by_boss: number
  created_at: string
}

function mapEventRow(row: RawMemoryEventRow): MemoryEventRow {
  return {
    id: row.id,
    scope: row.scope,
    scopeId: row.scope_id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    content: row.content,
    status: row.status,
    approvedByBoss: !!row.approved_by_boss,
    createdAt: row.created_at
  }
}

function eventRowOr404(db: DB, eventId: number): RawMemoryEventRow {
  const row = db.prepare('SELECT * FROM memory_events WHERE id = ?').get(eventId) as RawMemoryEventRow | undefined
  if (!row) throw new NotFoundError(`memory event ${eventId} not found`)
  return row
}

function jobFolderOr404(db: DB, jobId: number): string {
  const row = db.prepare('SELECT folder_path FROM jobs WHERE id = ?').get(jobId) as { folder_path: string } | undefined
  if (!row) throw new NotFoundError(`job ${jobId} not found`)
  return row.folder_path
}

/**
 * Renders the append-only `learned_skills.md` block (design spec section 6 / F7.2):
 * a leading blank line, a `## <date> — from <candidate>, round <stage>` heading, and one
 * bullet with the lesson and its first evidence quote. Date is the event's own `created_at`
 * (first 10 chars, `YYYY-MM-DD`) - deterministic, never the current wall clock.
 */
function renderBlock(createdAt: string, candidateName: string, stage: number, content: ProposalContent): string {
  const date = createdAt.slice(0, 10)
  const firstQuote = content.evidence[0]?.quote ?? ''
  return `\n## ${date} — from ${candidateName}, round ${stage}\n- ${content.lesson} _(evidence: "${firstQuote}")_\n`
}

/**
 * F7.2 propose→approve→write gate. 404s an unknown event; `ConflictError` unless the row is
 * currently `pending` (covers redecide, and refused/rejected rows - they can never be decided).
 *
 * - **Reject:** status flips to `'rejected'` only; `learned_skills.md` is never touched.
 * - **Approve:** one transaction appends the rendered block to the job's `learned_skills.md`
 *   (candidate name + round resolved via `source_id` → `interviews` → `candidates`) and then
 *   flips `status='approved', approved_by_boss=1`. The fs append happens INSIDE the transaction
 *   (Phase 1/2 rollback pattern) - if it throws, the DB update never commits and the row is
 *   still `pending` for the boss to retry.
 */
export function decideProposal(deps: MemoryDeps, eventId: number, decision: 'approved' | 'rejected'): MemoryEventRow {
  const { db, paths } = deps
  if (decision !== 'approved' && decision !== 'rejected') {
    throw new ValidationError(`invalid decision "${decision}"; must be "approved" or "rejected"`)
  }
  const row = eventRowOr404(db, eventId)
  if (row.status !== 'pending') {
    throw new ConflictError(`memory event ${eventId} is not pending (status: ${row.status})`)
  }

  if (decision === 'rejected') {
    db.prepare("UPDATE memory_events SET status = 'rejected' WHERE id = ?").run(eventId)
    return mapEventRow(eventRowOr404(db, eventId))
  }

  const content = JSON.parse(row.content) as ProposalContent
  const jobId = Number(row.scope_id)
  const folderPath = jobFolderOr404(db, jobId)

  const source = db
    .prepare(
      `SELECT c.name AS name, i.stage AS stage
       FROM interviews i JOIN candidates c ON c.id = i.candidate_id
       WHERE i.id = ?`
    )
    .get(row.source_id) as { name: string; stage: number } | undefined
  /* c8 ignore next 3 */
  if (!source) {
    throw new NotFoundError(`interview ${row.source_id} not found`)
  }

  const block = renderBlock(row.created_at, source.name, source.stage, content)
  const skillsAbs = path.join(paths.dataRoot, folderPath, 'learned_skills.md')

  db.transaction(() => {
    fs.appendFileSync(skillsAbs, block, 'utf8')
    db.prepare("UPDATE memory_events SET status = 'approved', approved_by_boss = 1 WHERE id = ?").run(eventId)
  })()

  return mapEventRow(eventRowOr404(db, eventId))
}

/**
 * Job memory read (F7.1/F7.2): current `learned_skills.md` content ('' if the file is
 * missing) plus every job-scoped memory event, newest first, with its content JSON parsed
 * into the view shape.
 */
export function getJobMemory(deps: MemoryDeps, jobId: number): { learnedSkills: string; events: MemoryEventView[] } {
  const { db, paths } = deps
  const folderPath = jobFolderOr404(db, jobId)

  const skillsAbs = path.join(paths.dataRoot, folderPath, 'learned_skills.md')
  const learnedSkills = fs.existsSync(skillsAbs) ? fs.readFileSync(skillsAbs, 'utf8') : ''

  const rows = db
    .prepare("SELECT * FROM memory_events WHERE scope = 'job' AND scope_id = ? ORDER BY created_at DESC, id DESC")
    .all(String(jobId)) as RawMemoryEventRow[]

  const events: MemoryEventView[] = rows.map(r => {
    let content: Partial<ProposalContent>
    try {
      content = JSON.parse(r.content) as Partial<ProposalContent>
    } catch {
      content = {}
    }
    return {
      id: r.id,
      status: r.status,
      lesson: content.lesson ?? '',
      evidence: content.evidence ?? [],
      ...(content.refusalReason ? { refusalReason: content.refusalReason } : {}),
      sourceInterviewId: r.source_id,
      createdAt: r.created_at
    }
  })

  return { learnedSkills, events }
}

/**
 * Normalises `question_bank.json` entries into `{text, addedAt}`, tolerating the scaffold's
 * empty `{"questions": []}` and legacy plain-string entries (addedAt unknown - '', since no
 * historical timestamp exists for them).
 */
function normaliseBank(raw: string): BankEntry[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  const questions = (parsed as { questions?: unknown[] } | null)?.questions
  if (!Array.isArray(questions)) return []

  const out: BankEntry[] = []
  for (const q of questions) {
    let text: string | undefined
    let addedAt = ''
    if (typeof q === 'string') {
      text = q
    } else if (q && typeof q === 'object' && typeof (q as { text?: unknown }).text === 'string') {
      text = (q as { text: string }).text
      if (typeof (q as { addedAt?: unknown }).addedAt === 'string') addedAt = (q as { addedAt: string }).addedAt
    }
    const trimmed = text?.trim()
    if (trimmed) out.push({ text: trimmed, addedAt })
  }
  return out
}

/**
 * Adds one question to its job's `question_bank.json` (direct boss action, no gate - design
 * spec section 6). 404s an unknown question; dedupes case-insensitively on trimmed text
 * (starring an already-banked question is a no-op besides the read/normalise/rewrite).
 * `addedAt` comes from the DB clock (`strftime`), not `new Date()`, so tests stay deterministic.
 */
export function starQuestion(deps: MemoryDeps, questionId: number): { questions: BankEntry[] } {
  const { db, paths } = deps
  const row = db
    .prepare(
      `SELECT q.text AS text, j.folder_path AS folderPath
       FROM interview_questions q
       JOIN interviews i ON i.id = q.interview_id
       JOIN candidates c ON c.id = i.candidate_id
       JOIN jobs j ON j.id = c.job_id
       WHERE q.id = ?`
    )
    .get(questionId) as { text: string; folderPath: string } | undefined
  if (!row) throw new NotFoundError(`interview question ${questionId} not found`)

  const bankAbs = path.join(paths.dataRoot, row.folderPath, 'question_bank.json')
  const raw = fs.existsSync(bankAbs) ? fs.readFileSync(bankAbs, 'utf8') : '{"questions": []}'
  const questions = normaliseBank(raw)

  const text = row.text.trim()
  const exists = questions.some(q => q.text.toLowerCase() === text.toLowerCase())
  if (!exists) {
    const { now } = db.prepare("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') AS now").get() as { now: string }
    questions.push({ text, addedAt: now })
  }

  fs.writeFileSync(bankAbs, JSON.stringify({ questions }, null, 2) + '\n', 'utf8')
  return { questions }
}
