import { describe, expect, it } from 'vitest'
import { AnalysisOutput, ANALYSIS_JSON_SCHEMA } from '../src/server/ai/schemas'
import { validAnalysisFixture } from './fixtures/analysis-output'

describe('AnalysisOutput schema', () => {
  it('accepts a complete fixture', () => {
    expect(AnalysisOutput.safeParse(validAnalysisFixture()).success).toBe(true)
  })
  it('rejects a judgment without evidence', () => {
    const bad = validAnalysisFixture()
    bad.dimensions.jd_fit.evidence = []
    expect(AnalysisOutput.safeParse(bad).success).toBe(false)
  })
  it('rejects out-of-range factor scores and bad enums', () => {
    const bad = validAnalysisFixture()
    bad.factors.jd_fit.score = 101
    expect(AnalysisOutput.safeParse(bad).success).toBe(false)
    const bad2 = validAnalysisFixture()
    ;(bad2 as any).recommendation = 'definitely'
    expect(AnalysisOutput.safeParse(bad2).success).toBe(false)
  })
  it('allows boss_preference_match to be null', () => {
    const ok = validAnalysisFixture()
    ok.factors.boss_preference_match = null
    expect(AnalysisOutput.safeParse(ok).success).toBe(true)
  })
  it('JSON schema stays consistent with the zod schema (top-level keys)', () => {
    const props = Object.keys((ANALYSIS_JSON_SCHEMA as any).properties)
    for (const k of ['summary', 'dimensions', 'recommended_questions', 'recommendation', 'factors', 'sensitive_flags']) {
      expect(props).toContain(k)
    }
    expect((ANALYSIS_JSON_SCHEMA as any).additionalProperties).toBe(false)
  })
})
