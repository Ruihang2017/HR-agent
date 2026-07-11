export function validQuestionsFixture() {
  return JSON.parse(JSON.stringify({
    questions: [
      { category: 'standard', text: 'Describe your typical day managing a retail team.', rationale: 'Establishes baseline competency for the role.' },
      { category: 'resume_specific', text: 'You mention leading a POS migration - walk me through your role in that project.', rationale: 'Probes a specific resume claim for depth.' },
      { category: 'jd_risk', text: 'The JD requires weekend availability - how do you currently handle weekend scheduling?', rationale: 'Tests a risk point flagged in the prior analysis.' },
      { category: 'boss_favourite', text: 'What would you do in your first 30 days on the job?', rationale: 'A question the boss has starred as consistently useful.' },
      { category: 'follow_up', text: 'You mentioned reducing shrinkage last time - what specific steps drove that result?', rationale: 'Builds on a likely earlier answer to probe deeper.' }
    ]
  }))
}

export function validCommentFixture() {
  return JSON.parse(JSON.stringify({
    comment: 'Clear, specific answer that matches the resume claim; suggests genuine ownership of the project.',
    confidence: 'medium'
  }))
}

export function validSummaryFixture() {
  const ev = [{ quote: 'I ran the weekend schedule myself for two years.', source: 'interview' }]
  const judgment = { assessment: 'Communicates clearly and cites concrete examples.', evidence: ev, confidence: 'high' }
  return JSON.parse(JSON.stringify({
    summary: 'Strong communicator with directly relevant weekend-scheduling experience; one open risk on POS familiarity.',
    soft_skill_observations: judgment,
    stability_inference: judgment,
    risk_points: [judgment],
    recommended_follow_ups: ['Ask for a reference from the POS migration project.'],
    next_round_recommendation: { verdict: 'advance', reason: 'Strong fit on the flagged risk area; no remaining concerns.' },
    interview_performance: {
      score: 78,
      reason: 'Derived from the items the boss flagged as affecting ranking.',
      evidence: ev,
      confidence: 'high'
    },
    memory_proposals: [
      {
        lesson: 'Candidates with direct weekend-scheduling ownership tend to interview well for this role.',
        evidence: [{ quote: 'I ran the weekend schedule myself for two years.', source: 'interview' }]
      },
      {
        lesson: 'Probing POS migration specifics surfaces useful signal for this role.',
        evidence: [{ quote: 'I led the POS migration end to end.', source: 'interview' }]
      }
    ]
  }))
}
