import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getPaths, type JobpinPaths } from '../src/server/paths'
import { ensureScaffold } from '../src/server/scaffold'
import { openDatabase, runMigrations, type DB } from '../src/server/db'
import { migrations } from '../src/server/migrations'
import { createJob } from '../src/server/jobs'
import { addCandidateFromText } from '../src/server/candidates'
import { ValidationError } from '../src/server/errors'
import { ANALYSIS_PROMPT_VERSION, INTERVIEW_SUMMARY_PROMPT_VERSION } from '../src/server/ai/prompts'
import { validAnalysisFixture } from './fixtures/analysis-output'
import { validSummaryFixture } from './fixtures/interview-output'
import { rmrfWithRetry } from './helpers'
import { RANKING_WEIGHTS, runRanking, listRankings, getRanking } from '../src/server/ranking'

type FactorKey = keyof typeof RANKING_WEIGHTS

interface Criteria {
  prompt_version_expected: string
  factors: { key: string; base_weight: number }[]
  excluded: string[]
  inputs: { candidate_id: number; analysis_id: number; provider: string; model: string }[]
  per_candidate: { candidate_id: number; factors: string[]; interview_analysis_id?: number }[]
}

let tmp: string
let db: DB
let paths: JobpinPaths
let jobId: number
let jobFolder: string

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jobpin-ranking-'))
  paths = getPaths(tmp)
  ensureScaffold(paths)
  db = openDatabase(paths.dbFile)
  runMigrations(db, migrations)
  const job = createJob({ db, paths }, 'Barista', 'We need a friendly, reliable barista.')
  jobId = job.id
  jobFolder = job.folderPath
})

afterEach(() => {
  db.close()
  rmrfWithRetry(tmp)
})

async function addCandidate(name: string) {
  return addCandidateFromText({ db, paths }, jobId, name, `${name} has ten years of relevant experience.`)
}

/**
 * Seeds an `ai_analyses` row + a real output file on disk, bypassing the
 * gateway entirely (per task-8 brief: tests seed rows + files directly from
 * `validAnalysisFixture()` with edited factor scores).
 */
function seedAnalysis(
  candidateId: number,
  factorEdits: Partial<Record<FactorKey, number | null>> = {},
  opts: { sensitiveFlags?: unknown[] } = {}
): number {
  const output = validAnalysisFixture()
  for (const [k, v] of Object.entries(factorEdits)) {
    output.factors[k] = v === null ? null : { ...output.factors[k], score: v }
  }
  if (opts.sensitiveFlags !== undefined) output.sensitive_flags = opts.sensitiveFlags

  const candFolderRel = `${jobFolder}/candidates/candidate_${candidateId}/analyses`
  fs.mkdirSync(path.join(tmp, candFolderRel), { recursive: true })

  const info = db
    .prepare(
      `INSERT INTO ai_analyses (job_id, candidate_id, kind, provider, model, prompt_version, input_manifest, output_path, confidence)
       VALUES (?, ?, 'candidate_analysis', 'openai', 'gpt-5-mini', ?, '[]', '', 1)`
    )
    .run(jobId, candidateId, ANALYSIS_PROMPT_VERSION)
  const id = Number(info.lastInsertRowid)
  const rel = `${candFolderRel}/analysis_${id}.json`
  fs.writeFileSync(path.join(tmp, rel), JSON.stringify(output))
  db.prepare('UPDATE ai_analyses SET output_path = ? WHERE id = ?').run(rel, id)
  return id
}

/**
 * Seeds an `ai_analyses` row (kind `interview_summary`) + a real output file on disk from
 * `validSummaryFixture()` with `interview_performance.score` edited (or nulled out), plus
 * the `interviews` row that carries the round's `stage` marker — mirrors what
 * `summariseInterview` persists in production (per task-8 brief), bypassing the gateway.
 *
 * The output payload carries `interviewId` + `stage` like production post-fix files.
 * `opts.payloadStage` overrides the stage written into the payload (to seed out-of-order
 * summaries whose payload stage differs from the newest interviews row);
 * `payloadStage: null` omits interviewId/stage entirely, emulating a pre-fix legacy file.
 */
function seedInterviewSummary(
  candidateId: number,
  stage: number,
  score: number | null,
  opts: { payloadStage?: number | null } = {}
): number {
  const output = validSummaryFixture()
  output.interview_performance = score === null ? null : { ...output.interview_performance, score }

  const interviewInfo = db.prepare(
    `INSERT INTO interviews (candidate_id, stage, mode, summary_path, ai_score) VALUES (?, ?, 'manual', ?, ?)`
  ).run(candidateId, stage, `${jobFolder}/candidates/candidate_${candidateId}/interviews/round-${stage}-summary.md`, score)
  if (opts.payloadStage !== null) {
    output.interviewId = Number(interviewInfo.lastInsertRowid)
    output.stage = opts.payloadStage ?? stage
  }

  const candFolderRel = `${jobFolder}/candidates/candidate_${candidateId}/analyses`
  fs.mkdirSync(path.join(tmp, candFolderRel), { recursive: true })

  const info = db
    .prepare(
      `INSERT INTO ai_analyses (job_id, candidate_id, kind, provider, model, prompt_version, input_manifest, output_path, confidence)
       VALUES (?, ?, 'interview_summary', 'openai', 'gpt-5-mini', ?, '[]', '', 1)`
    )
    .run(jobId, candidateId, INTERVIEW_SUMMARY_PROMPT_VERSION)
  const id = Number(info.lastInsertRowid)
  const rel = `${candFolderRel}/analysis_${id}.json`
  fs.writeFileSync(path.join(tmp, rel), JSON.stringify(output))
  db.prepare('UPDATE ai_analyses SET output_path = ? WHERE id = ?').run(rel, id)

  return id
}

describe('runRanking / listRankings / getRanking', () => {
  it('1. composes a weighted total per candidate and orders the snapshot by score descending', async () => {
    const a = await addCandidate('Alice')
    const b = await addCandidate('Bob')
    const c = await addCandidate('Cara')
    seedAnalysis(a.id, { jd_fit: 80, key_skills: 70, relevant_experience: 60, growth_trajectory: 50, boss_preference_match: 90 })
    seedAnalysis(b.id, { jd_fit: 60, key_skills: 60, relevant_experience: 60, growth_trajectory: 60, boss_preference_match: 60 })
    seedAnalysis(c.id, { jd_fit: 90, key_skills: 90, relevant_experience: 90, growth_trajectory: 90, boss_preference_match: 10 })

    const result = runRanking({ db, paths }, jobId)

    expect(result.items.map(i => i.candidateId)).toEqual([c.id, a.id, b.id])
    expect(result.items.map(i => i.rank)).toEqual([1, 2, 3])
    const scoreFor = (id: number): number => result.items.find(i => i.candidateId === id)!.score
    expect(scoreFor(a.id)).toBe(71.5)
    expect(scoreFor(b.id)).toBe(60)
    expect(scoreFor(c.id)).toBe(82)

    const ranking = getRanking(db, result.rankingId)
    const criteria = ranking.criteria as Criteria
    expect(criteria.factors).toHaveLength(5)
    expect(criteria.excluded).toContain('interview_performance')
    expect(criteria.excluded).not.toContain('boss_preference_match')
    for (const id of [a.id, b.id, c.id]) {
      expect(criteria.inputs.some(inp => inp.candidate_id === id)).toBe(true)
    }
  })

  it('2. excludes boss_preference_match for the whole run when any latest analysis has it null (all-or-none)', async () => {
    const a = await addCandidate('Alice')
    const b = await addCandidate('Bob')
    seedAnalysis(a.id, { boss_preference_match: null })
    seedAnalysis(b.id, {})

    const result = runRanking({ db, paths }, jobId)
    const criteria = getRanking(db, result.rankingId).criteria as Criteria

    expect(criteria.excluded).toContain('boss_preference_match')
    expect(criteria.factors.map(f => f.key)).not.toContain('boss_preference_match')
    // Base weights are run-level and unaffected by (now per-candidate) renormalisation.
    const weightSum = criteria.factors.reduce((s, f) => s + f.base_weight, 0)
    expect(weightSum).toBeCloseTo(0.9, 3)
  })

  it('3. renormalises remaining weights over their own sum when boss_preference is excluded', async () => {
    const a = await addCandidate('Alice')
    const b = await addCandidate('Bob')
    seedAnalysis(a.id, { jd_fit: 80, key_skills: 60, relevant_experience: 70, growth_trajectory: 90, boss_preference_match: null })
    seedAnalysis(b.id, { boss_preference_match: null })

    const result = runRanking({ db, paths }, jobId)
    const criteria = getRanking(db, result.rankingId).criteria as Criteria

    const jdFit = criteria.factors.find(f => f.key === 'jd_fit')!
    expect(jdFit.base_weight).toBe(0.35)

    // total = (0.35*80 + 0.25*60 + 0.20*70 + 0.10*90) / 0.90 = 66 / 0.9 = 73.333... -> 73.3
    const expectedTotal = Math.round(((0.35 * 80 + 0.25 * 60 + 0.2 * 70 + 0.1 * 90) / 0.9) * 10) / 10
    const item = result.items.find(i => i.candidateId === a.id)!
    expect(item.score).toBe(expectedTotal)
    expect(item.score).toBe(73.3)
  })

  it('4. excludes candidates with no analysis and reports them, never silently dropping them', async () => {
    const a = await addCandidate('Alice')
    const b = await addCandidate('Bob')
    const c = await addCandidate('Cara') // no analysis seeded
    seedAnalysis(a.id, {})
    seedAnalysis(b.id, {})

    const result = runRanking({ db, paths }, jobId)
    expect(result.items).toHaveLength(2)
    expect(result.excluded).toEqual([{ candidateId: c.id, reason: 'no analysis' }])

    const ranking = getRanking(db, result.rankingId)
    expect(ranking.items).toHaveLength(2)
  })

  it('5. throws ValidationError when zero candidates have an analysis', async () => {
    await addCandidate('Alice')
    await addCandidate('Bob')

    expect(() => runRanking({ db, paths }, jobId)).toThrow(ValidationError)
    expect(() => runRanking({ db, paths }, jobId)).toThrow(/no analysed candidates/)
  })

  it('6. uses the latest analysis per candidate when several exist', async () => {
    const a = await addCandidate('Alice')
    const older = seedAnalysis(a.id, {
      jd_fit: 50, key_skills: 50, relevant_experience: 50, growth_trajectory: 50, boss_preference_match: 50
    })
    const newer = seedAnalysis(a.id, {
      jd_fit: 90, key_skills: 90, relevant_experience: 90, growth_trajectory: 90, boss_preference_match: 90
    })

    const result = runRanking({ db, paths }, jobId)
    expect(result.items[0].score).toBe(90)

    const criteria = getRanking(db, result.rankingId).criteria as Criteria
    const input = criteria.inputs.find(inp => inp.candidate_id === a.id)!
    expect(input.analysis_id).toBe(newer)
    expect(input.analysis_id).not.toBe(older)
  })

  it('7. appends a new snapshot on re-run without altering the first', async () => {
    const a = await addCandidate('Alice')
    seedAnalysis(a.id, { jd_fit: 50, key_skills: 50, relevant_experience: 50, growth_trajectory: 50, boss_preference_match: 50 })

    const first = runRanking({ db, paths }, jobId)
    const second = runRanking({ db, paths }, jobId)
    expect(second.rankingId).not.toBe(first.rankingId)

    const list = listRankings(db, jobId)
    expect(list).toHaveLength(2)
    // Newest-first ordering — compare without sorting first.
    expect(list.map(r => r.id)).toEqual([second.rankingId, first.rankingId])
    // candidateCount must equal each snapshot's item count (1 candidate, Alice, in both runs).
    expect(list[0].candidateCount).toBe(1)
    expect(list[1].candidateCount).toBe(1)

    const firstAgain = getRanking(db, first.rankingId)
    expect(firstAgain.items).toHaveLength(1)
    expect(firstAgain.items[0].score).toBe(50)
  })

  it('8. rejects direct UPDATE and DELETE on ranking snapshots (immutability trigger)', async () => {
    const a = await addCandidate('Alice')
    seedAnalysis(a.id, {})
    const result = runRanking({ db, paths }, jobId)

    expect(() => db.prepare('UPDATE rankings SET reason = ? WHERE id = ?').run('tampered', result.rankingId))
      .toThrow(/immutable/)
    expect(() => db.prepare('DELETE FROM ranking_items WHERE ranking_id = ?').run(result.rankingId))
      .toThrow(/immutable/)
  })

  it('9. never lets sensitive_flags affect the score', async () => {
    const a = await addCandidate('Alice')
    const b = await addCandidate('Bob')
    const factors = { jd_fit: 77, key_skills: 55, relevant_experience: 66, growth_trajectory: 44, boss_preference_match: 88 }
    seedAnalysis(a.id, factors, { sensitiveFlags: [] })
    seedAnalysis(b.id, factors, {
      sensitiveFlags: [
        { attribute: 'race', note: 'explicitly mentioned; must not be used for decisions' },
        { attribute: 'age', note: 'candidate disclosed their age' },
        { attribute: 'disability', note: 'candidate disclosed a disability' }
      ]
    })

    const result = runRanking({ db, paths }, jobId)
    const scoreA = result.items.find(i => i.candidateId === a.id)!.score
    const scoreB = result.items.find(i => i.candidateId === b.id)!.score
    expect(scoreA).toBe(scoreB)
  })

  it('10. breaks identical scores by candidate creation order (earlier candidate ranks first)', async () => {
    const a = await addCandidate('Alice')
    const b = await addCandidate('Bob')
    const factors = { jd_fit: 70, key_skills: 70, relevant_experience: 70, growth_trajectory: 70, boss_preference_match: 70 }
    // Seed Bob's analysis first; insertion order of analyses must not affect the tie-break.
    seedAnalysis(b.id, factors)
    seedAnalysis(a.id, factors)

    const result = runRanking({ db, paths }, jobId)
    expect(result.items[0]).toMatchObject({ candidateId: a.id, rank: 1 })
    expect(result.items[1]).toMatchObject({ candidateId: b.id, rank: 2 })
  })

  it('11. scores an interviewed candidate over six per-candidate-renormalised factors', async () => {
    const a = await addCandidate('Alice')
    const b = await addCandidate('Bob')
    const factors = { jd_fit: 80, key_skills: 80, relevant_experience: 80, growth_trajectory: 80, boss_preference_match: 80 }
    // Seed ALL analyses with boss_preference_match present so the run-level rule includes it.
    seedAnalysis(a.id, factors)
    seedAnalysis(b.id, factors)
    seedInterviewSummary(a.id, 1, 100)

    const result = runRanking({ db, paths }, jobId)
    const scoreFor = (id: number): number => result.items.find(i => i.candidateId === id)!.score

    // (0.35+0.25+0.20+0.10+0.10)*80/1.20 + 0.20*100/1.20 = 83.333... -> 83.3
    expect(scoreFor(a.id)).toBe(83.3)
    // Bob is un-interviewed: renormalises over the base five only, sum=1 -> unchanged from Phase 2.
    expect(scoreFor(b.id)).toBe(80)
  })

  it('12. un-interviewed candidates in a mixed run score EXACTLY as Phase 2 (regression)', async () => {
    const a = await addCandidate('Alice')
    const b = await addCandidate('Bob')
    const c = await addCandidate('Cara')
    // Identical seeding to existing test 1, whose pre-computed Phase 2 scores were 71.5 / 60 / 82.
    seedAnalysis(a.id, { jd_fit: 80, key_skills: 70, relevant_experience: 60, growth_trajectory: 50, boss_preference_match: 90 })
    seedAnalysis(b.id, { jd_fit: 60, key_skills: 60, relevant_experience: 60, growth_trajectory: 60, boss_preference_match: 60 })
    seedAnalysis(c.id, { jd_fit: 90, key_skills: 90, relevant_experience: 90, growth_trajectory: 90, boss_preference_match: 10 })
    // Only Bob is interviewed; Alice and Cara must be completely unaffected.
    seedInterviewSummary(b.id, 1, 40)

    const result = runRanking({ db, paths }, jobId)
    const scoreFor = (id: number): number => result.items.find(i => i.candidateId === id)!.score

    expect(scoreFor(a.id)).toBe(71.5)
    expect(scoreFor(c.id)).toBe(82)
    // Bob, interviewed: (1.0*60 + 0.2*40) / 1.2 = 68 / 1.2 = 56.666... -> 56.7 (differs from Phase 2's 60).
    expect(scoreFor(b.id)).toBe(56.7)
  })

  it('13. lists per_candidate factor sets with interview_analysis_id only on the interviewed candidate', async () => {
    const a = await addCandidate('Alice')
    const b = await addCandidate('Bob')
    seedAnalysis(a.id, {})
    seedAnalysis(b.id, {})
    const interviewAnalysisId = seedInterviewSummary(a.id, 1, 85)

    const result = runRanking({ db, paths }, jobId)
    const criteria = getRanking(db, result.rankingId).criteria as Criteria

    const aEntry = criteria.per_candidate.find(p => p.candidate_id === a.id)!
    const bEntry = criteria.per_candidate.find(p => p.candidate_id === b.id)!
    expect(aEntry.factors).toContain('interview_performance')
    expect(aEntry.interview_analysis_id).toBe(interviewAnalysisId)
    expect(bEntry.factors).not.toContain('interview_performance')
    expect(bEntry.interview_analysis_id).toBeUndefined()

    // At least one ranked candidate carries interview_performance -> not run-level excluded.
    expect(criteria.excluded).not.toContain('interview_performance')
    expect(criteria.factors.map(f => f.key)).toContain('interview_performance')
  })

  it('14. latest-round-wins: the newer interview_summary analysis and score drive the run', async () => {
    const a = await addCandidate('Alice')
    seedAnalysis(a.id, { jd_fit: 70, key_skills: 70, relevant_experience: 70, growth_trajectory: 70, boss_preference_match: 70 })
    const older = seedInterviewSummary(a.id, 1, 50)
    const newer = seedInterviewSummary(a.id, 2, 90)

    const result = runRanking({ db, paths }, jobId)
    const criteria = getRanking(db, result.rankingId).criteria as Criteria
    const entry = criteria.per_candidate.find(p => p.candidate_id === a.id)!

    expect(entry.interview_analysis_id).toBe(newer)
    expect(entry.interview_analysis_id).not.toBe(older)
    // (1.0*70 + 0.2*90) / 1.2 = 88 / 1.2 = 73.333... -> 73.3 (uses the newer score of 90, not 50).
    const item = result.items.find(i => i.candidateId === a.id)!
    expect(item.score).toBe(73.3)
    expect(item.reason).toContain('Interview round 2: 90.')
    expect(item.reason).not.toContain('Interview round 1: 50.')
  })

  it('15. treats a null interview_performance (nothing flagged) as un-interviewed', async () => {
    const a = await addCandidate('Alice')
    seedAnalysis(a.id, { jd_fit: 70, key_skills: 70, relevant_experience: 70, growth_trajectory: 70, boss_preference_match: 70 })
    seedInterviewSummary(a.id, 1, null)

    const result = runRanking({ db, paths }, jobId)
    const criteria = getRanking(db, result.rankingId).criteria as Criteria
    const entry = criteria.per_candidate.find(p => p.candidate_id === a.id)!

    expect(entry.factors).not.toContain('interview_performance')
    expect(entry.interview_analysis_id).toBeUndefined()
    expect(criteria.excluded).toContain('interview_performance')
    const item = result.items.find(i => i.candidateId === a.id)!
    expect(item.score).toBe(70)
    expect(item.reason).not.toContain('Interview round')
  })

  it('16. appends the interview marker to reason only for interviewed candidates', async () => {
    const a = await addCandidate('Alice')
    const b = await addCandidate('Bob')
    seedAnalysis(a.id, {})
    seedAnalysis(b.id, {})
    seedInterviewSummary(a.id, 3, 88)

    const result = runRanking({ db, paths }, jobId)
    const itemA = result.items.find(i => i.candidateId === a.id)!
    const itemB = result.items.find(i => i.candidateId === b.id)!

    expect(itemA.reason).toMatch(/ Interview round 3: 88\.$/)
    expect(itemB.reason).not.toContain('Interview round')
  })

  it('17. out-of-order summaries: the stage label comes from the winning analysis payload, not the newest interviews row', async () => {
    const a = await addCandidate('Alice')
    seedAnalysis(a.id, { jd_fit: 70, key_skills: 70, relevant_experience: 70, growth_trajectory: 70, boss_preference_match: 70 })
    // Rounds created in order (round 1 gets the older interviews id, round 2 the newer),
    // then summarised OUT of order: round 2 first (older analysis), round 1 last (newer
    // analysis, payload stage 1). The payload stage is authoritative for the label.
    seedInterviewSummary(a.id, 1, 50, { payloadStage: 2 })
    const newer = seedInterviewSummary(a.id, 2, 90, { payloadStage: 1 })

    const result = runRanking({ db, paths }, jobId)
    const criteria = getRanking(db, result.rankingId).criteria as Criteria

    expect(criteria.per_candidate.find(p => p.candidate_id === a.id)!.interview_analysis_id).toBe(newer)
    const item = result.items.find(i => i.candidateId === a.id)!
    // (1.0*70 + 0.2*90) / 1.2 = 73.333... -> 73.3; labelled with the payload's round 1,
    // NOT round 2 (the interviews row with the newest id).
    expect(item.score).toBe(73.3)
    expect(item.reason).toContain('Interview round 1: 90.')
    expect(item.reason).not.toContain('Interview round 2')
  })

  it('18. pre-fix summary outputs without a stage field fall back to the interviews-row stage', async () => {
    const a = await addCandidate('Alice')
    seedAnalysis(a.id, { jd_fit: 70, key_skills: 70, relevant_experience: 70, growth_trajectory: 70, boss_preference_match: 70 })
    seedInterviewSummary(a.id, 2, 85, { payloadStage: null }) // legacy file: no interviewId/stage

    const result = runRanking({ db, paths }, jobId)
    const item = result.items.find(i => i.candidateId === a.id)!
    expect(item.reason).toContain('Interview round 2: 85.')
  })
})
