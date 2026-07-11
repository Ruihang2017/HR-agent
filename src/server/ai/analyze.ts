import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { DB } from '../db'
import type { JobpinPaths } from '../paths'
import { NotFoundError, ValidationError } from '../errors'
import { ANALYSIS_JSON_SCHEMA, AnalysisOutput, type AnalysisOutputT } from './schemas'
import { ANALYSIS_PROMPT_VERSION, buildAnalysisPrompt, type AnalysisMaterials } from './prompts'
import type { Gateway } from './gateway'
import { persistAiOutput, type ManifestEntry } from './persist'

export interface AnalyzeDeps { db: DB; paths: JobpinPaths; gateway: Pick<Gateway, 'complete'> }

const CONF = { low: 0.33, medium: 0.66, high: 1 } as const

export async function analyzeCandidate(deps: AnalyzeDeps, candidateId: number): Promise<{ analysisId: number }> {
  const { db, paths } = deps
  const abs = (rel: string): string => join(paths.dataRoot, rel)

  const cand = db.prepare('SELECT * FROM candidates WHERE id = ?').get(candidateId) as
    | { id: number; job_id: number; name: string } | undefined
  if (!cand) throw new NotFoundError(`candidate ${candidateId} not found`)
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(cand.job_id) as
    { id: number; name: string; folder_path: string; jd_path: string; inject_path: string }

  // --- assemble materials + provenance manifest ------------------------
  const manifest: ManifestEntry[] = []
  const readRel = (kind: string, rel: string): string | undefined => {
    if (!existsSync(abs(rel))) return undefined
    const text = readFileSync(abs(rel), 'utf8')
    if (!text.trim()) return undefined
    manifest.push({ kind, path: rel, chars: text.length })
    return text
  }
  // The scaffold seeds boss_preferences.json as an empty stub; an empty JSON
  // object means "not configured" and must not become a ranking factor.
  const readPreferences = (): string | undefined => {
    const rel = 'company/boss_preferences.json'
    if (!existsSync(abs(rel))) return undefined
    const text = readFileSync(abs(rel), 'utf8')
    if (!text.trim()) return undefined
    try {
      const parsed = JSON.parse(text)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Object.keys(parsed).length === 0) return undefined
    } catch { /* not JSON - treat as boss-authored freetext, include it */ }
    manifest.push({ kind: 'preferences', path: rel, chars: text.length })
    return text
  }
  // Job-level configuration errors surface before candidate-level ones:
  // a missing JD is fixed once for the whole job.
  const jd = readRel('jd', job.jd_path) ?? ''
  if (!jd.trim()) {
    throw new ValidationError('job has no JD - add a job description before analysing')
  }

  const doc = db.prepare(
    "SELECT * FROM candidate_documents WHERE candidate_id = ? AND type = 'resume'"
  ).get(candidateId) as { file_path: string; extracted_text_path: string | null } | undefined
  if (!doc?.extracted_text_path || !existsSync(abs(doc.extracted_text_path))) {
    throw new ValidationError('no extracted text - resolve needs_review first')
  }

  const materials: AnalysisMaterials = {
    jobName: job.name,
    candidateName: cand.name,
    jd,
    resumeText: readRel('resume', doc.extracted_text_path) ?? '',
    inject: readRel('inject', job.inject_path),
    values: readRel('values', 'company/values.md'),
    bossPreferences: readPreferences(),
    learnedSkills: readRel('learned_skills', `${job.folder_path}/learned_skills.md`)
  }
  const refsDir = `${job.folder_path}/references`
  if (existsSync(abs(refsDir))) {
    materials.references = readdirSync(abs(refsDir))
      .filter(f => f.endsWith('.md'))
      .map(f => ({ name: f, text: readRel(`references/${f}`, `${refsDir}/${f}`) ?? '' }))
      .filter(r => r.text)
  }

  // --- model call happens BEFORE any DB write --------------------------
  const { system, user } = buildAnalysisPrompt(materials)
  const result = await deps.gateway.complete<AnalysisOutputT>({
    system, user,
    schemaName: 'candidate_analysis', jsonSchema: ANALYSIS_JSON_SCHEMA, zodSchema: AnalysisOutput,
    kind: 'candidate_analysis', jobId: job.id, candidateId
  })

  const f = result.output.factors
  const confidences = [f.jd_fit, f.key_skills, f.relevant_experience, f.growth_trajectory, f.boss_preference_match]
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .map(x => CONF[x.confidence])
  const overallConfidence = Math.min(...confidences)

  const candFolder = `${job.folder_path}/candidates/candidate_${candidateId}`
  const json = JSON.stringify(
    { ...result.output, provider: result.provider, model: result.model, promptVersion: ANALYSIS_PROMPT_VERSION, createdAt: new Date().toISOString() },
    null, 2
  )

  // --- persist row + versioned file + latest copy atomically -----------
  const { analysisId } = persistAiOutput({ db, paths }, {
    jobId: job.id, candidateId, kind: 'candidate_analysis',
    provider: result.provider, model: result.model, promptVersion: ANALYSIS_PROMPT_VERSION,
    manifest, confidence: overallConfidence, outputJson: json,
    candidateFolder: candFolder, alsoLatestCopyAs: 'ai_analysis.json'
  })
  return { analysisId }
}
