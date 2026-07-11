import { z } from 'zod'

export const Evidence = z.object({
  quote: z.string().min(1),
  source: z.enum(['resume', 'jd', 'inject', 'references', 'values', 'preferences'])
}).strict()

export const Confidence = z.enum(['low', 'medium', 'high'])

export const Judgment = z.object({
  assessment: z.string().min(1),
  evidence: z.array(Evidence).min(1),
  confidence: Confidence
}).strict()

export const FactorScore = z.object({
  score: z.number().min(0).max(100),
  reason: z.string().min(1),
  evidence: z.array(Evidence).min(1),
  confidence: Confidence
}).strict()

export const AnalysisOutput = z.object({
  summary: z.string().min(1),
  dimensions: z.object({
    jd_fit: Judgment, must_have_skills: Judgment, bonus_skills: Judgment,
    career_continuity: Judgment, growth_trajectory: Judgment,
    communication_style: Judgment, soft_skill_evidence: Judgment,
    risk_points: z.array(Judgment)
  }).strict(),
  recommended_questions: z.array(z.string().min(1)).min(1).max(8),
  recommendation: z.enum(['strong_yes', 'yes', 'maybe', 'no']),
  factors: z.object({
    jd_fit: FactorScore, key_skills: FactorScore, relevant_experience: FactorScore,
    growth_trajectory: FactorScore, boss_preference_match: FactorScore.nullable()
  }).strict(),
  sensitive_flags: z.array(z.object({ attribute: z.string().min(1), note: z.string().min(1) }).strict())
}).strict()

export type AnalysisOutputT = z.infer<typeof AnalysisOutput>

// Hand-written structural schema sent to providers (OpenAI strict mode needs
// additionalProperties:false + full required lists; fine-grained rules stay in zod).
const evidenceJs = {
  type: 'object', additionalProperties: false,
  properties: { quote: { type: 'string' }, source: { type: 'string', enum: ['resume', 'jd', 'inject', 'references', 'values', 'preferences'] } },
  required: ['quote', 'source']
}
const judgmentJs = {
  type: 'object', additionalProperties: false,
  properties: {
    assessment: { type: 'string' },
    evidence: { type: 'array', items: evidenceJs },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] }
  },
  required: ['assessment', 'evidence', 'confidence']
}
const factorJs = {
  type: 'object', additionalProperties: false,
  properties: {
    score: { type: 'number' }, reason: { type: 'string' },
    evidence: { type: 'array', items: evidenceJs },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] }
  },
  required: ['score', 'reason', 'evidence', 'confidence']
}
// --- Phase 3: interview pipelines -----------------------------------------------------

export const InterviewEvidence = z.object({
  quote: z.string().min(1),
  source: z.enum(['interview', 'resume', 'jd'])
}).strict()

export const InterviewJudgment = z.object({
  assessment: z.string().min(1),
  evidence: z.array(InterviewEvidence).min(1),
  confidence: Confidence
}).strict()

export const QuestionCategory = z.enum(['standard', 'resume_specific', 'jd_risk', 'boss_favourite', 'follow_up'])

export const QuestionsOutput = z.object({
  questions: z.array(z.object({
    category: QuestionCategory,
    text: z.string().min(1),
    rationale: z.string().min(1)
  }).strict()).min(5).max(25)
}).strict()

export const AnswerCommentOutput = z.object({
  comment: z.string().min(1),
  confidence: Confidence
}).strict()

export const InterviewFactorScore = z.object({
  score: z.number().min(0).max(100),
  reason: z.string().min(1),
  evidence: z.array(InterviewEvidence).min(1),
  confidence: Confidence
}).strict()

export const InterviewSummaryOutput = z.object({
  summary: z.string().min(1),
  soft_skill_observations: InterviewJudgment,
  stability_inference: InterviewJudgment,
  risk_points: z.array(InterviewJudgment),
  recommended_follow_ups: z.array(z.string().min(1)).max(8),
  next_round_recommendation: z.object({
    verdict: z.enum(['advance', 'reject', 'another_round']),
    reason: z.string().min(1)
  }).strict(),
  interview_performance: InterviewFactorScore.nullable(),
  memory_proposals: z.array(z.object({
    lesson: z.string().min(1),
    evidence: z.array(InterviewEvidence).min(1)
  }).strict()).max(5)
}).strict()

export type QuestionsOutputT = z.infer<typeof QuestionsOutput>
export type AnswerCommentOutputT = z.infer<typeof AnswerCommentOutput>
export type InterviewSummaryOutputT = z.infer<typeof InterviewSummaryOutput>

// Hand-written structural mirrors for the interview pipelines - same discipline as ANALYSIS_JSON_SCHEMA.
const interviewEvidenceJs = {
  type: 'object', additionalProperties: false,
  properties: { quote: { type: 'string' }, source: { type: 'string', enum: ['interview', 'resume', 'jd'] } },
  required: ['quote', 'source']
}
const interviewJudgmentJs = {
  type: 'object', additionalProperties: false,
  properties: {
    assessment: { type: 'string' },
    evidence: { type: 'array', items: interviewEvidenceJs },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] }
  },
  required: ['assessment', 'evidence', 'confidence']
}
const interviewFactorJs = {
  type: 'object', additionalProperties: false,
  properties: {
    score: { type: 'number' }, reason: { type: 'string' },
    evidence: { type: 'array', items: interviewEvidenceJs },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] }
  },
  required: ['score', 'reason', 'evidence', 'confidence']
}

export const QUESTIONS_JSON_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          category: { type: 'string', enum: ['standard', 'resume_specific', 'jd_risk', 'boss_favourite', 'follow_up'] },
          text: { type: 'string' },
          rationale: { type: 'string' }
        },
        required: ['category', 'text', 'rationale']
      }
    }
  },
  required: ['questions']
}

export const ANSWER_COMMENT_JSON_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    comment: { type: 'string' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] }
  },
  required: ['comment', 'confidence']
}

export const INTERVIEW_SUMMARY_JSON_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    soft_skill_observations: interviewJudgmentJs,
    stability_inference: interviewJudgmentJs,
    risk_points: { type: 'array', items: interviewJudgmentJs },
    recommended_follow_ups: { type: 'array', items: { type: 'string' } },
    next_round_recommendation: {
      type: 'object', additionalProperties: false,
      properties: {
        verdict: { type: 'string', enum: ['advance', 'reject', 'another_round'] },
        reason: { type: 'string' }
      },
      required: ['verdict', 'reason']
    },
    interview_performance: { anyOf: [interviewFactorJs, { type: 'null' }] },
    memory_proposals: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          lesson: { type: 'string' },
          evidence: { type: 'array', items: interviewEvidenceJs }
        },
        required: ['lesson', 'evidence']
      }
    }
  },
  required: [
    'summary', 'soft_skill_observations', 'stability_inference', 'risk_points',
    'recommended_follow_ups', 'next_round_recommendation', 'interview_performance', 'memory_proposals'
  ]
}

export const ANALYSIS_JSON_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    dimensions: {
      type: 'object', additionalProperties: false,
      properties: {
        jd_fit: judgmentJs, must_have_skills: judgmentJs, bonus_skills: judgmentJs,
        career_continuity: judgmentJs, growth_trajectory: judgmentJs,
        communication_style: judgmentJs, soft_skill_evidence: judgmentJs,
        risk_points: { type: 'array', items: judgmentJs }
      },
      required: ['jd_fit', 'must_have_skills', 'bonus_skills', 'career_continuity', 'growth_trajectory', 'communication_style', 'soft_skill_evidence', 'risk_points']
    },
    recommended_questions: { type: 'array', items: { type: 'string' } },
    recommendation: { type: 'string', enum: ['strong_yes', 'yes', 'maybe', 'no'] },
    factors: {
      type: 'object', additionalProperties: false,
      properties: {
        jd_fit: factorJs, key_skills: factorJs, relevant_experience: factorJs,
        growth_trajectory: factorJs,
        boss_preference_match: { anyOf: [factorJs, { type: 'null' }] }
      },
      required: ['jd_fit', 'key_skills', 'relevant_experience', 'growth_trajectory', 'boss_preference_match']
    },
    sensitive_flags: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: { attribute: { type: 'string' }, note: { type: 'string' } },
        required: ['attribute', 'note']
      }
    }
  },
  required: ['summary', 'dimensions', 'recommended_questions', 'recommendation', 'factors', 'sensitive_flags']
}
