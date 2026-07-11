import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { DB } from '../db'
import type { JobpinPaths } from '../paths'
import { ConflictError, NotFoundError, ValidationError } from '../errors'
import {
  QUESTIONS_JSON_SCHEMA, QuestionsOutput, type QuestionsOutputT,
  ANSWER_COMMENT_JSON_SCHEMA, AnswerCommentOutput, type AnswerCommentOutputT,
  INTERVIEW_SUMMARY_JSON_SCHEMA, InterviewSummaryOutput, type InterviewSummaryOutputT
} from './schemas'
import {
  QUESTION_PROMPT_VERSION, buildQuestionPrompt,
  ANSWER_COMMENT_PROMPT_VERSION, buildAnswerCommentPrompt,
  INTERVIEW_SUMMARY_PROMPT_VERSION, buildSummaryPrompt
} from './prompts'
import type { Gateway } from './gateway'
import { persistAiOutput, type ManifestEntry } from './persist'
import { scanText } from '../ai/sensitive-terms'
import { addQuestion, getInterview, writeRecordMirror, candidateFolderFor, type InterviewDeps } from '../interviews'
import { writeCandidateFile, existsCandidateFile, readCandidateFileText } from '../candidate-fs'

export interface InterviewAiDeps { db: DB; paths: JobpinPaths; gateway: Pick<Gateway, 'complete'>; dataKey?: Buffer }

// Same mapping as analyze.ts's CONF - not exported there, so mirrored here.
const CONF = { low: 0.33, medium: 0.66, high: 1 } as const

/**
 * Tolerates the scaffold's empty `{"questions": []}` and Task 7's entry shape
 * `{text, addedAt}` - entries may be plain strings or objects; normalises to text,
 * dropping anything that doesn't resolve to a non-empty string.
 */
function parseBankQuestions(raw: string): string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  const questions = (parsed as { questions?: unknown[] } | null)?.questions
  if (!Array.isArray(questions)) return []
  return questions
    .map(q => {
      if (typeof q === 'string') return q
      if (q && typeof q === 'object' && typeof (q as { text?: unknown }).text === 'string') {
        return (q as { text: string }).text
      }
      return undefined
    })
    .map(t => t?.trim())
    .filter((t): t is string => !!t)
}

/**
 * F5.1/F5.2: generates a filtered interview question set for one round. Gathers the
 * JD, candidate resume text, the latest `candidate_analysis` output (if any), the
 * job's question bank (if any) and non-empty learned_skills.md, then asks the model
 * for a full question set. Every generated question is scanned for protected-attribute
 * / unlawful-topic content (F5.2); matches are dropped and reported, never inserted.
 * Remaining questions are appended via `addQuestion(..., source: 'generated')`,
 * provenance is recorded via `persistAiOutput` (no latest-copy - question sets don't
 * have one canonical "current" file the way an analysis does), and the record mirror
 * is rewritten once at the end.
 */
export async function generateQuestions(
  deps: InterviewAiDeps,
  interviewId: number
): Promise<{ added: number; dropped: { text: string; terms: string[] }[] }> {
  const { db, paths } = deps
  const abs = (rel: string): string => join(paths.dataRoot, rel)
  const interviewDeps: InterviewDeps = { db, paths, dataKey: deps.dataKey }

  const interview = db.prepare('SELECT id, candidate_id FROM interviews WHERE id = ?').get(interviewId) as
    | { id: number; candidate_id: number } | undefined
  if (!interview) throw new NotFoundError(`interview ${interviewId} not found`)

  const alreadyGenerated = db
    .prepare("SELECT 1 FROM interview_questions WHERE interview_id = ? AND source = 'generated' LIMIT 1")
    .get(interviewId)
  if (alreadyGenerated) throw new ConflictError('questions already generated - add manually or start a new round')

  const cand = db.prepare('SELECT id, name, job_id FROM candidates WHERE id = ?').get(interview.candidate_id) as
    { id: number; name: string; job_id: number }
  const job = db.prepare('SELECT id, name, folder_path, jd_path FROM jobs WHERE id = ?').get(cand.job_id) as
    { id: number; name: string; folder_path: string; jd_path: string }

  // --- assemble materials + provenance manifest ------------------------
  const manifest: ManifestEntry[] = []
  // Company/job files (jd, learned_skills, bank) - plain fs, never the seam (D-17).
  const readRel = (kind: string, rel: string): string | undefined => {
    if (!existsSync(abs(rel))) return undefined
    const text = readFileSync(abs(rel), 'utf8')
    if (!text.trim()) return undefined
    manifest.push({ kind, path: rel, chars: text.length })
    return text
  }
  // Candidate-tree files (resume text, prior analysis output) - routed through the seam.
  const readCandRel = (kind: string, rel: string): string | undefined => {
    if (!existsCandidateFile(deps, rel)) return undefined
    const text = readCandidateFileText(deps, rel)
    if (!text.trim()) return undefined
    manifest.push({ kind, path: rel, chars: text.length })
    return text
  }

  // Job-level configuration errors surface before candidate-level ones:
  // a missing JD is fixed once for the whole job.
  const jd = readRel('jd', job.jd_path) ?? ''
  if (!jd.trim()) throw new ValidationError('job has no JD - add a job description before analysing')

  const doc = db
    .prepare("SELECT extracted_text_path FROM candidate_documents WHERE candidate_id = ? AND type = 'resume'")
    .get(cand.id) as { extracted_text_path: string | null } | undefined
  if (!doc?.extracted_text_path || !existsCandidateFile(deps, doc.extracted_text_path)) {
    throw new ValidationError('no extracted text - resolve needs_review first')
  }
  const resumeText = readCandRel('resume', doc.extracted_text_path) ?? ''
  const learnedSkills = readRel('learned_skills', `${job.folder_path}/learned_skills.md`)

  const candFolder = candidateFolderFor(db, cand.id)

  let analysisSummary: string | undefined
  let riskPoints: string[] | undefined
  let recommendedQuestions: string[] | undefined
  const latestAnalysis = db
    .prepare("SELECT output_path FROM ai_analyses WHERE candidate_id = ? AND kind = 'candidate_analysis' ORDER BY id DESC LIMIT 1")
    .get(cand.id) as { output_path: string | null } | undefined
  if (latestAnalysis?.output_path && existsCandidateFile(deps, latestAnalysis.output_path)) {
    const text = readCandidateFileText(deps, latestAnalysis.output_path)
    if (text.trim()) {
      manifest.push({ kind: 'analysis', path: latestAnalysis.output_path, chars: text.length })
      try {
        const parsed = JSON.parse(text) as {
          summary?: string
          dimensions?: { risk_points?: { assessment: string }[] }
          recommended_questions?: string[]
        }
        analysisSummary = parsed.summary
        riskPoints = parsed.dimensions?.risk_points?.map(r => r.assessment)
        recommendedQuestions = parsed.recommended_questions
      } catch { /* unparsable prior-analysis file - proceed without this optional context */ }
    }
  }

  const bankRel = `${job.folder_path}/question_bank.json`
  let bankQuestions: string[] | undefined
  if (existsSync(abs(bankRel))) {
    const text = readFileSync(abs(bankRel), 'utf8')
    const qs = parseBankQuestions(text)
    if (qs.length) {
      bankQuestions = qs
      manifest.push({ kind: 'bank', path: bankRel, chars: text.length })
    }
  }

  // --- model call happens BEFORE any DB write --------------------------
  const { system, user } = buildQuestionPrompt({
    jobName: job.name, candidateName: cand.name, jd, resumeText,
    analysisSummary, riskPoints, recommendedQuestions, bankQuestions, learnedSkills
  })
  const result = await deps.gateway.complete<QuestionsOutputT>({
    system, user,
    schemaName: 'question_generation', jsonSchema: QUESTIONS_JSON_SCHEMA, zodSchema: QuestionsOutput,
    kind: 'question_generation', jobId: job.id, candidateId: cand.id
  })

  // --- F5.2 post-filter: drop, never insert, any protected-attribute match --------
  const dropped: { text: string; terms: string[] }[] = []
  const clean: { category: string; text: string }[] = []
  for (const q of result.output.questions) {
    const terms = scanText(q.text)
    if (terms.length) dropped.push({ text: q.text, terms })
    else clean.push({ category: q.category, text: q.text })
  }

  const outputJson = JSON.stringify(
    { ...result.output, provider: result.provider, model: result.model, promptVersion: QUESTION_PROMPT_VERSION, createdAt: new Date().toISOString() },
    null, 2
  )

  db.transaction(() => {
    for (const q of clean) {
      addQuestion(interviewDeps, interviewId, { text: q.text, category: q.category, source: 'generated' })
    }
  })()

  persistAiOutput({ db, paths, dataKey: deps.dataKey }, {
    jobId: job.id, candidateId: cand.id, kind: 'question_generation',
    provider: result.provider, model: result.model, promptVersion: QUESTION_PROMPT_VERSION,
    manifest, confidence: null, outputJson, candidateFolder: candFolder
  })

  writeRecordMirror(interviewDeps, interviewId)

  return { added: clean.length, dropped }
}

/**
 * F5.3: a short AI take on one recorded answer. 404s if the question is unknown;
 * requires a non-blank answer first (ValidationError - nothing to comment on yet).
 * The JD excerpt is capped at 2000 chars (this is a lightweight per-answer take, not
 * a full analysis). Re-commenting is allowed and expected: each call overwrites the
 * answer row's ai_comment/confidence and adds its own provenance row, then mirrors.
 */
export async function commentOnAnswer(
  deps: InterviewAiDeps,
  questionId: number
): Promise<{ comment: string; confidence: 'low' | 'medium' | 'high' }> {
  const { db, paths } = deps
  const abs = (rel: string): string => join(paths.dataRoot, rel)
  const interviewDeps: InterviewDeps = { db, paths, dataKey: deps.dataKey }

  const question = db.prepare('SELECT id, interview_id, text FROM interview_questions WHERE id = ?').get(questionId) as
    | { id: number; interview_id: number; text: string } | undefined
  if (!question) throw new NotFoundError(`interview question ${questionId} not found`)

  const answer = db
    .prepare('SELECT id, answer_text, boss_note FROM interview_answers WHERE interview_question_id = ?')
    .get(questionId) as { id: number; answer_text: string | null; boss_note: string | null } | undefined
  if (!answer?.answer_text || !answer.answer_text.trim()) {
    throw new ValidationError('answer the question before asking for an AI take')
  }

  const interview = db.prepare('SELECT id, candidate_id FROM interviews WHERE id = ?').get(question.interview_id) as
    { id: number; candidate_id: number }
  const cand = db.prepare('SELECT id, name, job_id FROM candidates WHERE id = ?').get(interview.candidate_id) as
    { id: number; name: string; job_id: number }
  const job = db.prepare('SELECT id, name, folder_path, jd_path FROM jobs WHERE id = ?').get(cand.job_id) as
    { id: number; name: string; folder_path: string; jd_path: string }

  const manifest: ManifestEntry[] = []
  const jdFull = existsSync(abs(job.jd_path)) ? readFileSync(abs(job.jd_path), 'utf8') : ''
  const jdExcerpt = jdFull.slice(0, 2000)
  if (jdExcerpt.trim()) manifest.push({ kind: 'jd', path: job.jd_path, chars: jdExcerpt.length })

  // --- model call happens BEFORE any DB write --------------------------
  const { system, user } = buildAnswerCommentPrompt({
    jobName: job.name, jdExcerpt, question: question.text, answerText: answer.answer_text,
    bossNote: answer.boss_note ?? undefined
  })
  const result = await deps.gateway.complete<AnswerCommentOutputT>({
    system, user,
    schemaName: 'answer_comment', jsonSchema: ANSWER_COMMENT_JSON_SCHEMA, zodSchema: AnswerCommentOutput,
    kind: 'answer_comment', jobId: job.id, candidateId: cand.id
  })

  const confidenceNum = CONF[result.output.confidence]
  db.prepare('UPDATE interview_answers SET ai_comment = ?, confidence = ? WHERE id = ?')
    .run(result.output.comment, confidenceNum, answer.id)

  const candFolder = candidateFolderFor(db, cand.id)
  const outputJson = JSON.stringify(
    { ...result.output, provider: result.provider, model: result.model, promptVersion: ANSWER_COMMENT_PROMPT_VERSION, createdAt: new Date().toISOString() },
    null, 2
  )
  persistAiOutput({ db, paths, dataKey: deps.dataKey }, {
    jobId: job.id, candidateId: cand.id, kind: 'answer_comment',
    provider: result.provider, model: result.model, promptVersion: ANSWER_COMMENT_PROMPT_VERSION,
    manifest, confidence: confidenceNum, outputJson, candidateFolder: candFolder
  })

  writeRecordMirror(interviewDeps, interview.id)

  return { comment: result.output.comment, confidence: result.output.confidence }
}

/** One line of `factor: score` pairs pulled from the candidate's latest analysis, for prompt context. */
function factorsOneLiner(analysisJson: string): string | undefined {
  try {
    const parsed = JSON.parse(analysisJson) as {
      recommendation?: string
      factors?: Record<string, { score: number } | null>
    }
    const entries = Object.entries(parsed.factors ?? {}).filter((e): e is [string, { score: number }] => e[1] !== null)
    if (!entries.length) return undefined
    const line = entries.map(([k, v]) => `${k}: ${v.score}`).join(', ')
    return parsed.recommendation ? `${line} (recommendation: ${parsed.recommendation})` : line
  } catch {
    return undefined // unparsable prior-analysis file - proceed without this optional context
  }
}

/** Renders the round summary markdown per the fixed section order (F5.4). */
function renderSummaryMd(stage: number, candidateName: string, o: InterviewSummaryOutputT): string {
  const lines: string[] = [`# Interview round ${stage} — ${candidateName}`, '']
  lines.push('## Summary', o.summary, '')
  lines.push('## Soft skills', o.soft_skill_observations.assessment, '')
  lines.push('## Stability', o.stability_inference.assessment, '')
  lines.push('## Risk points')
  if (o.risk_points.length) for (const r of o.risk_points) lines.push(`- ${r.assessment}`)
  else lines.push('(none identified)')
  lines.push('')
  lines.push('## Recommended follow-ups')
  if (o.recommended_follow_ups.length) for (const f of o.recommended_follow_ups) lines.push(`- ${f}`)
  else lines.push('(none)')
  lines.push('')
  lines.push('## Next round')
  lines.push(`**${o.next_round_recommendation.verdict}** — ${o.next_round_recommendation.reason}`)
  lines.push('')
  lines.push('## Interview performance')
  lines.push(
    o.interview_performance
      ? `Score ${o.interview_performance.score} — ${o.interview_performance.reason} (from flagged items)`
      : 'no items were flagged — no ranking factor'
  )
  return lines.join('\n') + '\n'
}

/**
 * F5.4: summarises a completed interview round. 404s if the interview is unknown;
 * requires at least one answered item (ConflictError - nothing to summarise yet).
 * Context is every item on the round (flagged items marked [AFFECTS-RANKING] by
 * buildSummaryPrompt), the JD, resume text, and a one-line digest of the candidate's
 * latest prior analysis factors if one exists.
 *
 * Persistence, in order:
 *  1. `persistAiOutput` records provenance in its own transaction (own rollback).
 *  2-4. One transaction: render+write the summary md, set summary_path/ai_score on the
 *     interview row, supersede this interview's prior PENDING memory_events rows as
 *     'rejected' (read-modify-write their JSON content to note the supersession), then
 *     screen and insert each new memory_proposal (F7.3 - `scanText` over the lesson +
 *     its evidence quotes; a match refuses the row and records why, never lets it stand
 *     as pending). fs write is inside the transaction (Phase 2 rollback pattern): a
 *     failure removes the partially-written md file and the transaction rolls back the
 *     row/memory_events changes with it. A failure here still leaves the step-1
 *     provenance row in place - acceptable and documented, matching persistAiOutput's
 *     own-tx contract.
 *  5. Mirror.
 */
export async function summariseInterview(
  deps: InterviewAiDeps,
  interviewId: number
): Promise<{
  analysisId: number
  output: InterviewSummaryOutputT
  proposals: { id: number; status: 'pending' | 'refused'; lesson: string; evidence: { quote: string; source: string }[]; refusalReason?: string }[]
}> {
  const { db, paths } = deps
  const abs = (rel: string): string => join(paths.dataRoot, rel)
  const interviewDeps: InterviewDeps = { db, paths, dataKey: deps.dataKey }

  const { interview, items } = getInterview(interviewDeps, interviewId) // 404s if unknown

  const answeredCount = items.filter(i => i.answer?.answerText?.trim()).length
  if (answeredCount === 0) throw new ConflictError('record at least one answer before summarising')

  const cand = db.prepare('SELECT id, name, job_id FROM candidates WHERE id = ?').get(interview.candidateId) as
    { id: number; name: string; job_id: number }
  const job = db.prepare('SELECT id, name, folder_path, jd_path FROM jobs WHERE id = ?').get(cand.job_id) as
    { id: number; name: string; folder_path: string; jd_path: string }

  // --- assemble materials + provenance manifest ------------------------
  const manifest: ManifestEntry[] = []
  // Job file (jd) - plain fs, never the seam (D-17).
  const readRel = (kind: string, rel: string): string | undefined => {
    if (!existsSync(abs(rel))) return undefined
    const text = readFileSync(abs(rel), 'utf8')
    if (!text.trim()) return undefined
    manifest.push({ kind, path: rel, chars: text.length })
    return text
  }
  // Candidate-tree files (resume text, prior analysis output) - routed through the seam.
  const readCandRel = (kind: string, rel: string): string | undefined => {
    if (!existsCandidateFile(deps, rel)) return undefined
    const text = readCandidateFileText(deps, rel)
    if (!text.trim()) return undefined
    manifest.push({ kind, path: rel, chars: text.length })
    return text
  }
  const jd = readRel('jd', job.jd_path) ?? ''

  const doc = db
    .prepare("SELECT extracted_text_path FROM candidate_documents WHERE candidate_id = ? AND type = 'resume'")
    .get(cand.id) as { extracted_text_path: string | null } | undefined
  const resumeText = (doc?.extracted_text_path && readCandRel('resume', doc.extracted_text_path)) || ''

  let analysisFactorsSummary: string | undefined
  const latestAnalysis = db
    .prepare("SELECT output_path FROM ai_analyses WHERE candidate_id = ? AND kind = 'candidate_analysis' ORDER BY id DESC LIMIT 1")
    .get(cand.id) as { output_path: string | null } | undefined
  if (latestAnalysis?.output_path && existsCandidateFile(deps, latestAnalysis.output_path)) {
    const text = readCandidateFileText(deps, latestAnalysis.output_path)
    if (text.trim()) {
      manifest.push({ kind: 'analysis', path: latestAnalysis.output_path, chars: text.length })
      analysisFactorsSummary = factorsOneLiner(text)
    }
  }

  const promptItems = items.map(i => ({
    category: i.category,
    text: i.text,
    answerText: i.answer?.answerText ?? null,
    bossNote: i.answer?.bossNote ?? null,
    aiComment: i.answer?.aiComment ?? null,
    affectsRanking: i.answer?.affectsRanking ?? false
  }))

  // --- model call happens BEFORE any DB write --------------------------
  const { system, user } = buildSummaryPrompt({
    jobName: job.name, candidateName: cand.name, jd, resumeText, items: promptItems, analysisFactorsSummary
  })
  const result = await deps.gateway.complete<InterviewSummaryOutputT>({
    system, user,
    schemaName: 'interview_summary', jsonSchema: INTERVIEW_SUMMARY_JSON_SCHEMA, zodSchema: InterviewSummaryOutput,
    kind: 'interview_summary', jobId: job.id, candidateId: cand.id
  })
  // I-2 fix: code-enforce acceptance 12.3 - a summary must never carry a ranking factor when
  // nothing on the round was flagged, regardless of what the model returned (prompt-trusted
  // was not enough). Checked against the same `items` used to build the prompt, matching the
  // local shape (`i.answer?.affectsRanking`). Mutate a copy, never `result.output` itself, so
  // every downstream read (persistence, md render, ai_score, the returned output) sees one
  // consistent enforced value.
  const noneFlagged = !items.some(i => i.answer?.affectsRanking)
  const out: InterviewSummaryOutputT = noneFlagged && result.output.interview_performance
    ? { ...result.output, interview_performance: null }
    : result.output

  const candFolder = candidateFolderFor(db, cand.id)
  // interviewId + stage make the output file self-describing: downstream consumers
  // (ranking) read which round the summary belongs to from the file itself instead of
  // re-deriving it from the interviews table, which can desync when rounds are
  // summarised out of order.
  const outputJson = JSON.stringify(
    {
      ...out, interviewId, stage: interview.stage,
      provider: result.provider, model: result.model, promptVersion: INTERVIEW_SUMMARY_PROMPT_VERSION, createdAt: new Date().toISOString()
    },
    null, 2
  )

  // --- step 1: provenance row + versioned file, own tx/rollback --------
  const { analysisId } = persistAiOutput({ db, paths, dataKey: deps.dataKey }, {
    jobId: job.id, candidateId: cand.id, kind: 'interview_summary',
    provider: result.provider, model: result.model, promptVersion: INTERVIEW_SUMMARY_PROMPT_VERSION,
    manifest, confidence: out.interview_performance ? CONF[out.interview_performance.confidence] : null,
    outputJson, candidateFolder: candFolder
  })

  // --- steps 2-4: one transaction; fs write inside; rollback removes the md on failure --
  const md = renderSummaryMd(interview.stage, cand.name, out)
  const summaryRel = `${candFolder}/interviews/round-${interview.stage}-summary.md`
  const proposals: { id: number; status: 'pending' | 'refused'; lesson: string; evidence: { quote: string; source: string }[]; refusalReason?: string }[] = []
  let summaryWritten = false
  try {
    db.transaction(() => {
      writeCandidateFile(deps, summaryRel, md)
      summaryWritten = true

      db.prepare('UPDATE interviews SET summary_path = ?, ai_score = ? WHERE id = ?')
        .run(summaryRel, out.interview_performance ? out.interview_performance.score : null, interviewId)

      // Supersede this interview's prior pending proposals - a re-summary replaces them.
      const priorPending = db
        .prepare("SELECT id, content FROM memory_events WHERE source_type = 'interview' AND source_id = ? AND status = 'pending'")
        .all(interviewId) as { id: number; content: string }[]
      for (const row of priorPending) {
        let content: Record<string, unknown>
        try { content = JSON.parse(row.content) as Record<string, unknown> } catch { content = {} }
        content.refusalReason = 'superseded by re-summary'
        db.prepare("UPDATE memory_events SET status = 'rejected', content = ? WHERE id = ?")
          .run(JSON.stringify(content), row.id)
      }

      // F7.3: screen each new proposal before it can stand as a pending memory candidate.
      for (const p of out.memory_proposals) {
        const quotes = p.evidence.map(e => e.quote).join(' ')
        const terms = scanText(`${p.lesson} ${quotes}`)
        const refused = terms.length > 0
        const content: { lesson: string; evidence: { quote: string; source: string }[]; refusalReason?: string } = {
          lesson: p.lesson, evidence: p.evidence
        }
        if (refused) content.refusalReason = `mentions protected attribute: ${terms.join(', ')}`
        const status: 'pending' | 'refused' = refused ? 'refused' : 'pending'
        const info = db
          .prepare(
            `INSERT INTO memory_events (scope, scope_id, source_type, source_id, content, status, approved_by_boss)
             VALUES ('job', ?, 'interview', ?, ?, ?, 0)`
          )
          .run(String(job.id), interviewId, JSON.stringify(content), status)
        proposals.push({
          id: Number(info.lastInsertRowid), status, lesson: p.lesson, evidence: p.evidence,
          ...(content.refusalReason ? { refusalReason: content.refusalReason } : {})
        })
      }
    })()
  } catch (e) {
    if (summaryWritten && existsCandidateFile(deps, summaryRel)) rmSync(abs(summaryRel), { force: true })
    throw e
  }

  // --- step 5: mirror ---------------------------------------------------
  writeRecordMirror(interviewDeps, interviewId)

  return { analysisId, output: out, proposals }
}
