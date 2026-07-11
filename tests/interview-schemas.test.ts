import { describe, expect, it } from 'vitest'
import {
  InterviewEvidence,
  InterviewJudgment,
  InterviewFactorScore,
  QuestionCategory,
  QuestionsOutput,
  AnswerCommentOutput,
  InterviewSummaryOutput,
  QUESTIONS_JSON_SCHEMA,
  ANSWER_COMMENT_JSON_SCHEMA,
  INTERVIEW_SUMMARY_JSON_SCHEMA
} from '../src/server/ai/schemas'
import { validQuestionsFixture, validCommentFixture, validSummaryFixture } from './fixtures/interview-output'

describe('QuestionsOutput schema', () => {
  it('accepts a complete fixture', () => {
    expect(QuestionsOutput.safeParse(validQuestionsFixture()).success).toBe(true)
  })
  it('rejects a question with a bad category', () => {
    const bad = validQuestionsFixture()
    ;(bad.questions[0] as any).category = 'personality_quiz'
    expect(QuestionsOutput.safeParse(bad).success).toBe(false)
  })
  it('rejects fewer than 5 questions', () => {
    const bad = validQuestionsFixture()
    bad.questions = bad.questions.slice(0, 2)
    expect(QuestionsOutput.safeParse(bad).success).toBe(false)
  })
  it('rejects more than 25 questions', () => {
    const bad = validQuestionsFixture()
    const filler = bad.questions[0]
    bad.questions = Array.from({ length: 26 }, () => ({ ...filler }))
    expect(QuestionsOutput.safeParse(bad).success).toBe(false)
  })
  it('rejects an extra top-level key (strict)', () => {
    const bad = validQuestionsFixture() as any
    bad.extra = 'nope'
    expect(QuestionsOutput.safeParse(bad).success).toBe(false)
  })
  it('JSON schema stays consistent with the zod schema (top-level keys)', () => {
    const props = Object.keys((QUESTIONS_JSON_SCHEMA as any).properties)
    expect(props).toContain('questions')
    expect((QUESTIONS_JSON_SCHEMA as any).additionalProperties).toBe(false)
  })
})

describe('AnswerCommentOutput schema', () => {
  it('accepts a complete fixture', () => {
    expect(AnswerCommentOutput.safeParse(validCommentFixture()).success).toBe(true)
  })
  it('rejects a bad confidence value', () => {
    const bad = validCommentFixture() as any
    bad.confidence = 'certain'
    expect(AnswerCommentOutput.safeParse(bad).success).toBe(false)
  })
  it('rejects an extra top-level key (strict)', () => {
    const bad = validCommentFixture() as any
    bad.extra = 'nope'
    expect(AnswerCommentOutput.safeParse(bad).success).toBe(false)
  })
  it('JSON schema stays consistent with the zod schema (top-level keys)', () => {
    const props = Object.keys((ANSWER_COMMENT_JSON_SCHEMA as any).properties)
    for (const k of ['comment', 'confidence']) expect(props).toContain(k)
    expect((ANSWER_COMMENT_JSON_SCHEMA as any).additionalProperties).toBe(false)
  })
})

describe('InterviewSummaryOutput schema', () => {
  it('accepts a complete fixture', () => {
    expect(InterviewSummaryOutput.safeParse(validSummaryFixture()).success).toBe(true)
  })
  it('allows interview_performance to be null', () => {
    const ok = validSummaryFixture()
    ok.interview_performance = null
    expect(InterviewSummaryOutput.safeParse(ok).success).toBe(true)
  })
  it('rejects interview_performance.score out of range', () => {
    const bad = validSummaryFixture()
    ;(bad.interview_performance as any).score = 101
    expect(InterviewSummaryOutput.safeParse(bad).success).toBe(false)
  })
  it('rejects a memory proposal without evidence', () => {
    const bad = validSummaryFixture()
    ;(bad.memory_proposals[0] as any).evidence = []
    expect(InterviewSummaryOutput.safeParse(bad).success).toBe(false)
  })
  it('rejects more than 5 memory proposals', () => {
    const bad = validSummaryFixture()
    const filler = bad.memory_proposals[0]
    bad.memory_proposals = Array.from({ length: 6 }, () => ({ ...filler }))
    expect(InterviewSummaryOutput.safeParse(bad).success).toBe(false)
  })
  it('rejects an extra top-level key (strict)', () => {
    const bad = validSummaryFixture() as any
    bad.extra = 'nope'
    expect(InterviewSummaryOutput.safeParse(bad).success).toBe(false)
  })
  it('JSON schema stays consistent with the zod schema (top-level keys)', () => {
    const props = Object.keys((INTERVIEW_SUMMARY_JSON_SCHEMA as any).properties)
    for (const k of [
      'summary',
      'soft_skill_observations',
      'stability_inference',
      'risk_points',
      'recommended_follow_ups',
      'next_round_recommendation',
      'interview_performance',
      'memory_proposals'
    ]) {
      expect(props).toContain(k)
    }
    expect((INTERVIEW_SUMMARY_JSON_SCHEMA as any).additionalProperties).toBe(false)
  })
})

describe('shared interview building blocks', () => {
  it('InterviewEvidence accepts the interview source', () => {
    expect(InterviewEvidence.safeParse({ quote: 'q', source: 'interview' }).success).toBe(true)
  })
  it('InterviewEvidence rejects a source outside interview|resume|jd', () => {
    expect(InterviewEvidence.safeParse({ quote: 'q', source: 'references' }).success).toBe(false)
  })
  it('InterviewJudgment rejects a judgment without evidence', () => {
    expect(InterviewJudgment.safeParse({ assessment: 'a', evidence: [], confidence: 'low' }).success).toBe(false)
  })
  it('InterviewFactorScore rejects an out-of-range score', () => {
    expect(
      InterviewFactorScore.safeParse({ score: -1, reason: 'r', evidence: [{ quote: 'q', source: 'jd' }], confidence: 'low' }).success
    ).toBe(false)
  })
  it('QuestionCategory only allows the five F5.1 values', () => {
    for (const c of ['standard', 'resume_specific', 'jd_risk', 'boss_favourite', 'follow_up']) {
      expect(QuestionCategory.safeParse(c).success).toBe(true)
    }
    expect(QuestionCategory.safeParse('random').success).toBe(false)
  })
})
