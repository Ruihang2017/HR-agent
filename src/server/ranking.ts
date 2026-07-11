import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DB } from './db'
import type { JobpinPaths } from './paths'
import { NotFoundError, ValidationError } from './errors'
import { ANALYSIS_PROMPT_VERSION } from './ai/prompts'
import type { AnalysisOutputT, InterviewSummaryOutputT } from './ai/schemas'

export const RANKING_WEIGHTS = {
  jd_fit: 0.35,
  key_skills: 0.25,
  relevant_experience: 0.2,
  growth_trajectory: 0.1,
  boss_preference_match: 0.1,
  interview_performance: 0.2
} as const

type FactorKey = keyof typeof RANKING_WEIGHTS
// The five factors sourced from candidate_analysis output; interview_performance is
// sourced separately (per candidate, from that candidate's latest interview_summary).
type BaseFactorKey = Exclude<FactorKey, 'interview_performance'>
const BASE_FACTOR_KEYS = (Object.keys(RANKING_WEIGHTS) as FactorKey[]).filter(
  (k): k is BaseFactorKey => k !== 'interview_performance'
)

interface LatestAnalysis {
  candidateId: number; analysisId: number; provider: string; model: string
  output: AnalysisOutputT
}

interface InterviewInfo { analysisId: number; score: number; stage: number }

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
  // This remains a RUN-LEVEL, all-or-none rule — unlike interview_performance below, which
  // is decided per candidate.
  const everyHasPrefs = analysed.every(a => a.output.factors.boss_preference_match !== null)
  const baseActiveKeys = BASE_FACTOR_KEYS.filter(k => k !== 'boss_preference_match' || everyHasPrefs)

  // Per candidate: latest interview_summary analysis whose output carries a non-null
  // interview_performance. "Latest" only — an older summary with a score never overrides
  // a newer summary that flagged nothing (task-8 brief case 5).
  const interviewStmt = db.prepare(
    `SELECT id, output_path FROM ai_analyses
     WHERE candidate_id=? AND kind='interview_summary' AND output_path != ''
     ORDER BY id DESC LIMIT 1`
  )
  const stageStmt = db.prepare(
    `SELECT stage FROM interviews WHERE candidate_id=? AND summary_path IS NOT NULL ORDER BY id DESC LIMIT 1`
  )
  const interviewByCandidate = new Map<number, InterviewInfo | undefined>()
  for (const a of analysed) {
    const row = interviewStmt.get(a.candidateId) as { id: number; output_path: string } | undefined
    if (!row) { interviewByCandidate.set(a.candidateId, undefined); continue }
    const output = JSON.parse(readFileSync(join(paths.dataRoot, row.output_path), 'utf8')) as InterviewSummaryOutputT
    if (!output.interview_performance) { interviewByCandidate.set(a.candidateId, undefined); continue }
    const stageRow = stageStmt.get(a.candidateId) as { stage: number } | undefined
    if (!stageRow) { interviewByCandidate.set(a.candidateId, undefined); continue }
    interviewByCandidate.set(a.candidateId, { analysisId: row.id, score: output.interview_performance.score, stage: stageRow.stage })
  }
  const anyHasInterview = [...interviewByCandidate.values()].some(v => v !== undefined)

  const scored = analysed.map(a => {
    const interview = interviewByCandidate.get(a.candidateId)
    const activeKeys: FactorKey[] = interview ? [...baseActiveKeys, 'interview_performance'] : [...baseActiveKeys]
    const weightSum = activeKeys.reduce((s, k) => s + RANKING_WEIGHTS[k], 0)
    // Renormalisation is per candidate, over that candidate's own present factors.
    const normalised = Object.fromEntries(activeKeys.map(k => [k, RANKING_WEIGHTS[k] / weightSum])) as Record<FactorKey, number>
    const scoreOf = (k: FactorKey): number => (k === 'interview_performance' ? interview!.score : a.output.factors[k as BaseFactorKey]!.score)

    const total = activeKeys.reduce((sum, k) => sum + normalised[k] * scoreOf(k), 0)
    const best = activeKeys.reduce((m, k) => (scoreOf(k) > scoreOf(m) ? k : m), activeKeys[0])
    const firstSentence = a.output.summary.split('. ')[0].replace(/\.$/, '')
    let reason = `${firstSentence}. Strongest factor: ${best.replaceAll('_', ' ')} (${scoreOf(best)}).`
    if (interview) reason += ` Interview round ${interview.stage}: ${interview.score}.`
    return {
      candidateId: a.candidateId,
      analysisId: a.analysisId,
      interviewAnalysisId: interview?.analysisId,
      activeKeys,
      score: Math.round(total * 10) / 10,
      reason
    }
  })
  const order = new Map(candidates.map((c, i) => [c.id, i]))
  scored.sort((a, b) => b.score - a.score || order.get(a.candidateId)! - order.get(b.candidateId)!)

  const excludedFactors = [
    ...(anyHasInterview ? [] : ['interview_performance']),
    ...(everyHasPrefs ? [] : ['boss_preference_match'])
  ]
  const runLevelFactorKeys = (Object.keys(RANKING_WEIGHTS) as FactorKey[]).filter(k => !excludedFactors.includes(k))

  const criteria = {
    prompt_version_expected: ANALYSIS_PROMPT_VERSION,
    factors: runLevelFactorKeys.map(k => ({ key: k, base_weight: RANKING_WEIGHTS[k] })),
    excluded: excludedFactors,
    inputs: analysed.map(a => ({ candidate_id: a.candidateId, analysis_id: a.analysisId, provider: a.provider, model: a.model })),
    per_candidate: scored.map(s => ({
      candidate_id: s.candidateId,
      factors: s.activeKeys,
      ...(s.interviewAnalysisId !== undefined ? { interview_analysis_id: s.interviewAnalysisId } : {})
    }))
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
