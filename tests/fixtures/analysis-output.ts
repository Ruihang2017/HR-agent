export function validAnalysisFixture() {
  const ev = [{ quote: '5 years running retail teams', source: 'resume' }]
  const judgment = { assessment: 'Strong match for the stated requirement.', evidence: ev, confidence: 'high' }
  const factor = { score: 82, reason: 'Meets nearly every JD requirement.', evidence: ev, confidence: 'high' }
  return JSON.parse(JSON.stringify({
    summary: 'Experienced retail manager, strong JD fit, minor gap in POS systems.',
    dimensions: {
      jd_fit: judgment, must_have_skills: judgment, bonus_skills: judgment,
      career_continuity: judgment, growth_trajectory: judgment,
      communication_style: judgment, soft_skill_evidence: judgment,
      risk_points: [judgment]
    },
    recommended_questions: ['Describe a time you managed peak-season staffing.'],
    recommendation: 'yes',
    factors: {
      jd_fit: factor, key_skills: factor, relevant_experience: factor,
      growth_trajectory: factor, boss_preference_match: factor
    },
    sensitive_flags: [{ attribute: 'marital status', note: 'mentioned in resume header' }]
  }))
}
