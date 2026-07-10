import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DB } from './db'
import type { JobpinPaths } from './paths'
import { NotFoundError, ValidationError } from './errors'
import { ANALYSIS_PROMPT_VERSION } from './ai/prompts'
import type { AnalysisOutputT } from './ai/schemas'

export const RANKING_WEIGHTS = {
  jd_fit: 0.35,
  key_skills: 0.25,
  relevant_experience: 0.2,
  growth_trajectory: 0.1,
  boss_preference_match: 0.1
} as const

type FactorKey = keyof typeof RANKING_WEIGHTS

interface LatestAnalysis {
  candidateId: number; analysisId: number; provider: string; model: string
  output: AnalysisOutputT
}

export function runRanking(deps: { db: DB; paths: JobpinPaths }, jobId: number): {
  rankingId: number
  items: { candidateId: number; rank: number; score: number; reason: string }[]
  excluded: { candidateId: number; reason: string }[]
} {
  const { db, paths } = deps
  if (!db.prepare('SELECT id FROM jobs WHERE id=?').get(jobId)) throw new NotFoundError(`job ${jobId} not found`)

  const candidates = db.prepare('SELECT id, created_at FROM candidates WHERE job_id=? ORDER BY created_at, id').all(jobId) as
    { id: number; created_at: string }[]

  const latestStmt = db.prepare(
    `SELECT id, provider, model, output_path FROM ai_analyses
     WHERE candidate_id=? AND kind='candidate_analysis' AND output_path != ''
     ORDER BY id DESC LIMIT 1`
  )
  const analysed: LatestAnalysis[] = []
  const excluded: { candidateId: number; reason: string }[] = []
  for (const c of candidates) {
    const row = latestStmt.get(c.id) as { id: number; provider: string; model: string; output_path: string } | undefined
    if (!row) { excluded.push({ candidateId: c.id, reason: 'no analysis' }); continue }
    const output = JSON.parse(readFileSync(join(paths.dataRoot, row.output_path), 'utf8')) as AnalysisOutputT
    analysed.push({ candidateId: c.id, analysisId: row.id, provider: row.provider, model: row.model, output })
  }
  if (analysed.length === 0) throw new ValidationError('no analysed candidates to rank')

  // boss_preference_match participates only if EVERY analysis has it (comparability).
  const everyHasPrefs = analysed.every(a => a.output.factors.boss_preference_match !== null)
  const activeKeys = (Object.keys(RANKING_WEIGHTS) as FactorKey[]).filter(
    k => k !== 'boss_preference_match' || everyHasPrefs
  )
  const weightSum = activeKeys.reduce((s, k) => s + RANKING_WEIGHTS[k], 0)
  const normalised = Object.fromEntries(activeKeys.map(k => [k, RANKING_WEIGHTS[k] / weightSum])) as Record<FactorKey, number>

  const scored = analysed.map(a => {
    const total = activeKeys.reduce((sum, k) => sum + normalised[k] * a.output.factors[k]!.score, 0)
    const best = activeKeys.reduce((m, k) => (a.output.factors[k]!.score > a.output.factors[m]!.score ? k : m), activeKeys[0])
    const firstSentence = a.output.summary.split('. ')[0].replace(/\.$/, '')
    return {
      candidateId: a.candidateId,
      analysisId: a.analysisId,
      score: Math.round(total * 10) / 10,
      reason: `${firstSentence}. Strongest factor: ${best.replaceAll('_', ' ')} (${a.output.factors[best]!.score}).`
    }
  })
  const order = new Map(candidates.map((c, i) => [c.id, i]))
  scored.sort((a, b) => b.score - a.score || order.get(a.candidateId)! - order.get(b.candidateId)!)

  const criteria = {
    prompt_version_expected: ANALYSIS_PROMPT_VERSION,
    factors: activeKeys.map(k => ({ key: k, base_weight: RANKING_WEIGHTS[k], normalised_weight: Math.round(normalised[k] * 10000) / 10000 })),
    excluded: ['interview_performance', ...(everyHasPrefs ? [] : ['boss_preference_match'])],
    inputs: analysed.map(a => ({ candidate_id: a.candidateId, analysis_id: a.analysisId, provider: a.provider, model: a.model }))
  }

  const rankingId = db.transaction((): number => {
    const info = db.prepare('INSERT INTO rankings (job_id, criteria, reason) VALUES (?, ?, ?)').run(
      jobId, JSON.stringify(criteria), `Ranked ${scored.length} candidate(s); ${excluded.length} without analysis excluded.`
    )
    const rid = Number(info.lastInsertRowid)
    const item = db.prepare('INSERT INTO ranking_items (ranking_id, candidate_id, rank, score, reason) VALUES (?, ?, ?, ?, ?)')
    scored.forEach((s, i) => item.run(rid, s.candidateId, i + 1, s.score, s.reason))
    return rid
  })()

  return {
    rankingId,
    items: scored.map((s, i) => ({ candidateId: s.candidateId, rank: i + 1, score: s.score, reason: s.reason })),
    excluded
  }
}

export function listRankings(db: DB, jobId: number): { id: number; createdAt: string; candidateCount: number }[] {
  if (!db.prepare('SELECT id FROM jobs WHERE id=?').get(jobId)) throw new NotFoundError(`job ${jobId} not found`)
  return db.prepare(
    `SELECT r.id, r.created_at AS createdAt,
       (SELECT COUNT(*) FROM ranking_items ri WHERE ri.ranking_id = r.id) AS candidateCount
     FROM rankings r WHERE r.job_id=? ORDER BY r.id DESC`
  ).all(jobId) as { id: number; createdAt: string; candidateCount: number }[]
}

export function getRanking(db: DB, rankingId: number): {
  id: number; jobId: number; createdAt: string; reason: string | null; criteria: unknown
  items: { candidateId: number; candidateName: string; rank: number; score: number; reason: string | null }[]
} {
  const r = db.prepare('SELECT * FROM rankings WHERE id=?').get(rankingId) as
    { id: number; job_id: number; created_at: string; reason: string | null; criteria: string } | undefined
  if (!r) throw new NotFoundError(`ranking ${rankingId} not found`)
  const items = db.prepare(
    `SELECT ri.candidate_id AS candidateId, c.name AS candidateName, ri.rank, ri.score, ri.reason
     FROM ranking_items ri JOIN candidates c ON c.id = ri.candidate_id
     WHERE ri.ranking_id=? ORDER BY ri.rank`
  ).all(rankingId) as { candidateId: number; candidateName: string; rank: number; score: number; reason: string | null }[]
  return { id: r.id, jobId: r.job_id, createdAt: r.created_at, reason: r.reason, criteria: JSON.parse(r.criteria), items }
}
