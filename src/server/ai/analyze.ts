import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { DB } from '../db'
import type { JobpinPaths } from '../paths'
import { NotFoundError, ValidationError } from '../errors'
import { ANALYSIS_JSON_SCHEMA, AnalysisOutput, type AnalysisOutputT } from './schemas'
import { ANALYSIS_PROMPT_VERSION, buildAnalysisPrompt, type AnalysisMaterials } from './prompts'
import type { Gateway } from './gateway'

export interface AnalyzeDeps { db: DB; paths: JobpinPaths; gateway: Pick<Gateway, 'complete'> }

interface ManifestEntry { kind: string; path: string; chars: number }

const CONF = { low: 0.33, medium: 0.66, high: 1 } as const

export async function analyzeCandidate(deps: AnalyzeDeps, candidateId: number): Promise<{ analysisId: number }> {
  const { db, paths } = deps
  const abs = (rel: string): string => join(paths.dataRoot, rel)

  const cand = db.prepare('SELECT * FROM candidates WHERE id = ?').get(candidateId) as
    | { id: number; job_id: number; name: string } | undefined
  if (!cand) throw new NotFoundError(`candidate ${candidateId} not found`)
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(cand.job_id) as
    { id: number; name: string; folder_path: string; jd_path: string; inject_path: string }
  const doc = db.prepare(
    "SELECT * FROM candidate_documents WHERE candidate_id = ? AND type = 'resume'"
  ).get(candidateId) as { file_path: string; extracted_text_path: string | null } | undefined
  if (!doc?.extracted_text_path || !existsSync(abs(doc.extracted_text_path))) {
    throw new ValidationError('no extracted text - resolve needs_review first')
  }

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
  const materials: AnalysisMaterials = {
    jobName: job.name,
    candidateName: cand.name,
    jd: readRel('jd', job.jd_path) ?? '',
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
  if (!materials.jd.trim()) {
    throw new ValidationError('job has no JD - add a job description before analysing')
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
  let versionedRel = ''
  const insert = db.transaction((): number => {
    const info = db.prepare(
      `INSERT INTO ai_analyses (job_id, candidate_id, kind, provider, model, prompt_version, input_manifest, output_path, confidence)
       VALUES (?, ?, 'candidate_analysis', ?, ?, ?, ?, '', ?)`
    ).run(job.id, candidateId, result.provider, result.model, ANALYSIS_PROMPT_VERSION, JSON.stringify(manifest), overallConfidence)
    const id = Number(info.lastInsertRowid)
    versionedRel = `${candFolder}/analyses/analysis_${id}.json`
    mkdirSync(dirname(abs(versionedRel)), { recursive: true })
    writeFileSync(abs(versionedRel), json)
    writeFileSync(abs(`${candFolder}/ai_analysis.json`), json)
    db.prepare('UPDATE ai_analyses SET output_path = ? WHERE id = ?').run(versionedRel, id)
    return id
  })
  try {
    return { analysisId: insert() }
  } catch (e) {
    if (versionedRel && existsSync(abs(versionedRel))) rmSync(abs(versionedRel), { force: true })
    throw e
  }
}
