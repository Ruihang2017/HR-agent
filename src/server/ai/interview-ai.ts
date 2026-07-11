import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DB } from '../db'
import type { JobpinPaths } from '../paths'
import { ConflictError, NotFoundError, ValidationError } from '../errors'
import { QUESTIONS_JSON_SCHEMA, QuestionsOutput, type QuestionsOutputT } from './schemas'
import { QUESTION_PROMPT_VERSION, buildQuestionPrompt } from './prompts'
import type { Gateway } from './gateway'
import { persistAiOutput, type ManifestEntry } from './persist'
import { scanText } from '../ai/sensitive-terms'
import { addQuestion, writeRecordMirror, candidateFolderFor, type InterviewDeps } from '../interviews'

export interface InterviewAiDeps { db: DB; paths: JobpinPaths; gateway: Pick<Gateway, 'complete'> }

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
  const interviewDeps: InterviewDeps = { db, paths }

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
  const readRel = (kind: string, rel: string): string | undefined => {
    if (!existsSync(abs(rel))) return undefined
    const text = readFileSync(abs(rel), 'utf8')
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
  if (!doc?.extracted_text_path || !existsSync(abs(doc.extracted_text_path))) {
    throw new ValidationError('no extracted text - resolve needs_review first')
  }
  const resumeText = readRel('resume', doc.extracted_text_path) ?? ''
  const learnedSkills = readRel('learned_skills', `${job.folder_path}/learned_skills.md`)

  const candFolder = candidateFolderFor(db, cand.id)

  let analysisSummary: string | undefined
  let riskPoints: string[] | undefined
  let recommendedQuestions: string[] | undefined
  const latestAnalysis = db
    .prepare("SELECT output_path FROM ai_analyses WHERE candidate_id = ? AND kind = 'candidate_analysis' ORDER BY id DESC LIMIT 1")
    .get(cand.id) as { output_path: string | null } | undefined
  if (latestAnalysis?.output_path && existsSync(abs(latestAnalysis.output_path))) {
    const text = readFileSync(abs(latestAnalysis.output_path), 'utf8')
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

  persistAiOutput({ db, paths }, {
    jobId: job.id, candidateId: cand.id, kind: 'question_generation',
    provider: result.provider, model: result.model, promptVersion: QUESTION_PROMPT_VERSION,
    manifest, confidence: null, outputJson, candidateFolder: candFolder
  })

  writeRecordMirror(interviewDeps, interviewId)

  return { added: clean.length, dropped }
}
