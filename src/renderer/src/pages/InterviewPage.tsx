import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { Link, useParams } from 'react-router-dom'
import { apiJson } from '../api'
import StatusBadge, { type Tone } from '../components/StatusBadge'

type Confidence = 'low' | 'medium' | 'high'
const CONF: Record<Confidence, number> = { low: 0.33, medium: 0.66, high: 1 }
/** Reverses the server's low/medium/high -> REAL mapping (ai/interview-ai.ts CONF) for display. */
function confidenceLabel(v: number): Confidence {
  return v >= 0.9 ? 'high' : v >= 0.5 ? 'medium' : 'low'
}
const CONFIDENCE_TONE: Record<Confidence, Tone> = { high: 'ok', medium: 'warn', low: 'danger' }

interface InterviewRow {
  id: number; candidateId: number; stage: number; mode: string; scheduledAt: string | null
  transcriptPath: string | null; summaryPath: string | null; aiScore: number | null
  bossDecision: string | null; createdAt: string
}
interface AnswerState {
  answerText: string | null; bossNote: string | null; aiComment: string | null
  confidence: number | null; affectsRanking: boolean
}
interface InterviewItem {
  questionId: number; orderIndex: number; category: string; text: string; source: string
  answer: AnswerState | null
}
interface InterviewDetail { interview: InterviewRow; items: InterviewItem[] }
interface CandidateMini { id: number; jobId: number; name: string }
interface JobMini { id: number; name: string }

interface Evidence { quote: string; source: string }
interface InterviewJudgment { assessment: string; evidence: Evidence[]; confidence: Confidence }
interface InterviewFactorScore { score: number; reason: string; evidence: Evidence[]; confidence: Confidence }
type Verdict = 'advance' | 'reject' | 'another_round'
interface SummaryOutput {
  summary: string
  soft_skill_observations: InterviewJudgment
  stability_inference: InterviewJudgment
  risk_points: InterviewJudgment[]
  recommended_follow_ups: string[]
  next_round_recommendation: { verdict: Verdict; reason: string }
  interview_performance: InterviewFactorScore | null
  memory_proposals: { lesson: string; evidence: Evidence[] }[]
}
interface Proposal { id: number; status: string; lesson: string; evidence: Evidence[]; refusalReason?: string }
interface SummaryResp { analysisId: number; output: SummaryOutput; proposals: Proposal[] }
interface GenerateResult { added: number; dropped: { text: string; terms: string[] }[] }

const CATEGORIES = ['standard', 'resume_specific', 'jd_risk', 'boss_favourite', 'follow_up'] as const

function formatCategory(cat: string): string {
  return cat.replace(/_/g, ' ')
}

const VERDICT_LABEL: Record<Verdict, string> = { advance: 'Advance', reject: 'Reject', another_round: 'Another round' }
const VERDICT_TONE: Record<Verdict, Tone> = { advance: 'ok', another_round: 'warn', reject: 'danger' }

const card: CSSProperties = {
  background: 'var(--c-surface)', border: '1px solid var(--c-border)',
  borderRadius: 'var(--radius)', padding: 'var(--sp-4)', marginBottom: 'var(--sp-5)'
}
const actionBtn: CSSProperties = {
  border: '1px solid var(--c-border)', background: 'var(--c-surface)',
  padding: 'var(--sp-1) var(--sp-3)', borderRadius: 'var(--radius-sm)'
}
const primaryBtn: CSSProperties = {
  background: 'var(--c-accent)', color: 'var(--c-on-accent)', border: 'none',
  padding: 'var(--sp-2) var(--sp-4)', borderRadius: 'var(--radius-sm)'
}
const inputStyle: CSSProperties = {
  border: '1px solid var(--c-border)', borderRadius: 'var(--radius-sm)', padding: 'var(--sp-2)',
  width: '100%', background: 'var(--c-surface)', color: 'var(--c-text)'
}

export default function InterviewPage() {
  const { id } = useParams()
  const interviewId = Number(id)

  const [detail, setDetail] = useState<InterviewDetail | null>(null)
  const [items, setItems] = useState<InterviewItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [candidate, setCandidate] = useState<CandidateMini | null>(null)
  const [job, setJob] = useState<JobMini | null>(null)

  const [bossDecisionDraft, setBossDecisionDraft] = useState('')
  const [bossDecisionBusy, setBossDecisionBusy] = useState(false)
  const [bossDecisionError, setBossDecisionError] = useState<string | null>(null)

  const [generateBusy, setGenerateBusy] = useState(false)
  const [generateResult, setGenerateResult] = useState<GenerateResult | null>(null)
  const [generateError, setGenerateError] = useState<string | null>(null)

  const [addOpen, setAddOpen] = useState(false)
  const [addText, setAddText] = useState('')
  const [addCategory, setAddCategory] = useState<(typeof CATEGORIES)[number]>('standard')
  const [addBusy, setAddBusy] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  const [drafts, setDrafts] = useState<Record<number, { answerText: string; bossNote: string }>>({})
  const [fieldError, setFieldError] = useState<Record<number, string | null>>({})
  const [starred, setStarred] = useState<Record<number, boolean>>({})
  const [aiTakeBusy, setAiTakeBusy] = useState<Record<number, boolean>>({})
  const [aiTakeError, setAiTakeError] = useState<Record<number, string | null>>({})

  const [summary, setSummary] = useState<SummaryResp | null>(null)
  const [summaryBusy, setSummaryBusy] = useState(false)
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [proposalBusy, setProposalBusy] = useState<Record<number, boolean>>({})
  const [proposalError, setProposalError] = useState<Record<number, string | null>>({})

  const fetchDetail = useCallback(() => {
    apiJson<InterviewDetail>(`/interviews/${interviewId}`)
      .then(d => {
        setDetail(d)
        setItems(d.items)
        setBossDecisionDraft(d.interview.bossDecision ?? '')
        setDrafts(prev => {
          const next = { ...prev }
          for (const item of d.items) {
            if (!(item.questionId in next)) {
              next[item.questionId] = { answerText: item.answer?.answerText ?? '', bossNote: item.answer?.bossNote ?? '' }
            }
          }
          return next
        })
      })
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
  }, [interviewId])
  useEffect(fetchDetail, [fetchDetail])

  useEffect(() => {
    if (!detail) return
    apiJson<CandidateMini>(`/candidates/${detail.interview.candidateId}`)
      .then(c => {
        setCandidate(c)
        apiJson<JobMini>(`/jobs/${c.jobId}`).then(setJob).catch(() => {})
      })
      .catch(() => {})
  }, [detail?.interview.candidateId])

  async function saveBossDecision() {
    if (!detail) return
    const trimmed = bossDecisionDraft.trim()
    if (!trimmed || trimmed === (detail.interview.bossDecision ?? '')) return
    setBossDecisionBusy(true); setBossDecisionError(null)
    try {
      const res = await apiJson<{ interview: InterviewRow }>(`/interviews/${interviewId}`, {
        method: 'PATCH', body: JSON.stringify({ bossDecision: trimmed })
      })
      setDetail(d => (d ? { ...d, interview: res.interview } : d))
    } catch (e) {
      setBossDecisionError(e instanceof Error ? e.message : String(e))
    } finally {
      setBossDecisionBusy(false)
    }
  }

  const alreadyGenerated = items.some(i => i.source === 'generated')

  async function generateQuestions() {
    setGenerateBusy(true); setGenerateError(null)
    try {
      const res = await apiJson<GenerateResult>(`/interviews/${interviewId}/questions/generate`, { method: 'POST' })
      setGenerateResult(res)
      fetchDetail()
    } catch (e) {
      setGenerateError(e instanceof Error ? e.message : String(e))
    } finally {
      setGenerateBusy(false)
    }
  }

  async function submitAddQuestion() {
    if (!addText.trim()) return
    setAddBusy(true); setAddError(null)
    try {
      await apiJson(`/interviews/${interviewId}/questions`, {
        method: 'POST', body: JSON.stringify({ text: addText.trim(), category: addCategory })
      })
      setAddText(''); setAddCategory('standard'); setAddOpen(false)
      fetchDetail()
    } catch (e) {
      setAddError(e instanceof Error ? e.message : String(e))
    } finally {
      setAddBusy(false)
    }
  }

  async function starQuestion(questionId: number) {
    try {
      await apiJson(`/interview-questions/${questionId}/star`, { method: 'POST' })
      setStarred(prev => ({ ...prev, [questionId]: true }))
    } catch (e) {
      setFieldError(prev => ({ ...prev, [questionId]: e instanceof Error ? e.message : String(e) }))
    }
  }

  async function saveField(questionId: number, patch: { answerText?: string; bossNote?: string; affectsRanking?: boolean }) {
    try {
      const updated = await apiJson<InterviewItem>(`/interview-questions/${questionId}/answer`, {
        method: 'PUT', body: JSON.stringify(patch)
      })
      setItems(prev => prev.map(it => (it.questionId === questionId ? updated : it)))
      setDrafts(prev => ({
        ...prev,
        [questionId]: { answerText: updated.answer?.answerText ?? '', bossNote: updated.answer?.bossNote ?? '' }
      }))
      setFieldError(prev => ({ ...prev, [questionId]: null }))
    } catch (e) {
      setFieldError(prev => ({ ...prev, [questionId]: e instanceof Error ? e.message : String(e) }))
    }
  }

  async function aiTake(questionId: number) {
    setAiTakeBusy(prev => ({ ...prev, [questionId]: true }))
    setAiTakeError(prev => ({ ...prev, [questionId]: null }))
    try {
      const res = await apiJson<{ comment: string; confidence: Confidence }>(
        `/interview-questions/${questionId}/ai-comment`, { method: 'POST' }
      )
      setItems(prev => prev.map(it =>
        it.questionId === questionId && it.answer
          ? { ...it, answer: { ...it.answer, aiComment: res.comment, confidence: CONF[res.confidence] } }
          : it
      ))
    } catch (e) {
      setAiTakeError(prev => ({ ...prev, [questionId]: e instanceof Error ? e.message : String(e) }))
    } finally {
      setAiTakeBusy(prev => ({ ...prev, [questionId]: false }))
    }
  }

  const hasAnyAnswer = items.some(i => i.answer?.answerText?.trim())

  async function summarise() {
    setSummaryBusy(true); setSummaryError(null)
    try {
      const res = await apiJson<SummaryResp>(`/interviews/${interviewId}/summary`, { method: 'POST' })
      setSummary(res)
      fetchDetail()
    } catch (e) {
      setSummaryError(e instanceof Error ? e.message : String(e))
    } finally {
      setSummaryBusy(false)
    }
  }

  async function decideProposal(proposalId: number, decision: 'approve' | 'reject') {
    setProposalBusy(prev => ({ ...prev, [proposalId]: true }))
    setProposalError(prev => ({ ...prev, [proposalId]: null }))
    try {
      await apiJson(`/memory-events/${proposalId}/${decision}`, { method: 'POST' })
      setSummary(s =>
        s
          ? { ...s, proposals: s.proposals.map(p => (p.id === proposalId ? { ...p, status: decision === 'approve' ? 'approved' : 'rejected' } : p)) }
          : s
      )
    } catch (e) {
      setProposalError(prev => ({ ...prev, [proposalId]: e instanceof Error ? e.message : String(e) }))
    } finally {
      setProposalBusy(prev => ({ ...prev, [proposalId]: false }))
    }
  }

  if (!detail) return <p style={{ color: 'var(--c-text-2)' }}>{error ?? 'Loading…'}</p>
  const { interview } = detail

  return (
    <div style={{ maxWidth: 820 }}>
      <p style={{ marginTop: 0 }}>
        {candidate ? <Link to={`/candidates/${candidate.id}`}>← {candidate.name}</Link> : <Link to="/">← back</Link>}
      </p>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>Round {interview.stage}</h1>
        {job && <span style={{ color: 'var(--c-text-2)' }}>{job.name}</span>}
      </div>
      <p style={{ color: 'var(--c-text-2)' }}>Started {interview.createdAt.slice(0, 10)}</p>

      {error && <p style={{ color: 'var(--c-danger)' }}>{error}</p>}

      <div style={card}>
        <label style={{ display: 'block', fontSize: 'var(--text-sm)', color: 'var(--c-text-2)', marginBottom: 'var(--sp-2)' }}>
          Boss decision
        </label>
        <input value={bossDecisionDraft} onChange={e => setBossDecisionDraft(e.target.value)}
          onBlur={saveBossDecision} placeholder="e.g. advance to round 2" style={inputStyle} />
        {bossDecisionBusy && <p style={{ color: 'var(--c-text-2)', fontSize: 'var(--text-sm)', margin: 'var(--sp-2) 0 0' }}>Saving…</p>}
        {bossDecisionError && <p style={{ color: 'var(--c-danger)', fontSize: 'var(--text-sm)', margin: 'var(--sp-2) 0 0' }}>{bossDecisionError}</p>}
      </div>

      <div style={card}>
        <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap', alignItems: 'center' }}>
          <button disabled={generateBusy || alreadyGenerated} onClick={generateQuestions}
            style={{ ...actionBtn, opacity: generateBusy || alreadyGenerated ? 0.5 : 1 }}>
            {generateBusy ? 'Generating…' : 'Generate questions'}
          </button>
          <button onClick={() => setAddOpen(v => !v)} style={actionBtn}>
            {addOpen ? 'Cancel' : 'Add question'}
          </button>
        </div>

        {generateResult && (
          <p style={{ color: 'var(--c-text-2)', fontSize: 'var(--text-sm)', margin: 'var(--sp-2) 0 0' }}>
            added {generateResult.added}
          </p>
        )}
        {generateResult && generateResult.dropped.length > 0 && (
          <p style={{
            background: 'var(--c-warn-bg)', color: 'var(--c-warn-text)', padding: 'var(--sp-2) var(--sp-3)',
            borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-sm)', margin: 'var(--sp-2) 0 0'
          }}>
            dropped {generateResult.dropped.length} unlawful: {Array.from(new Set(generateResult.dropped.flatMap(d => d.terms))).join(', ')}
          </p>
        )}
        {generateError && (
          <p style={{ color: 'var(--c-danger)', fontSize: 'var(--text-sm)', margin: 'var(--sp-2) 0 0', display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
            {generateError}
            <button onClick={generateQuestions} style={actionBtn}>Retry</button>
          </p>
        )}

        {addOpen && (
          <div style={{ marginTop: 'var(--sp-3)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)', maxWidth: 420 }}>
            <input value={addText} onChange={e => setAddText(e.target.value)} placeholder="Question text" style={inputStyle} />
            <select value={addCategory} onChange={e => setAddCategory(e.target.value as (typeof CATEGORIES)[number])} style={inputStyle}>
              {CATEGORIES.map(cat => <option key={cat} value={cat}>{formatCategory(cat)}</option>)}
            </select>
            <div>
              <button disabled={addBusy || !addText.trim()} onClick={submitAddQuestion}
                style={{ ...primaryBtn, opacity: addBusy || !addText.trim() ? 0.5 : 1 }}>
                {addBusy ? 'Adding…' : 'Add'}
              </button>
            </div>
            {addError && <p style={{ color: 'var(--c-danger)', fontSize: 'var(--text-sm)' }}>{addError}</p>}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)', marginBottom: 'var(--sp-5)' }}>
        {items.length === 0 && <p style={{ color: 'var(--c-text-2)' }}>No questions yet.</p>}
        {items.map(item => {
          const draft = drafts[item.questionId] ?? { answerText: '', bossNote: '' }
          const hasAnswer = !!draft.answerText.trim()
          return (
            <div key={item.questionId} style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--sp-2)' }}>
                <StatusBadge status={item.category} label={formatCategory(item.category)} />
                <button onClick={() => starQuestion(item.questionId)} disabled={!!starred[item.questionId]}
                  style={{
                    ...actionBtn,
                    ...(starred[item.questionId] ? { color: 'var(--c-accent)', borderColor: 'var(--c-accent)' } : {})
                  }}>
                  {starred[item.questionId] ? '★ Starred' : '☆ Star'}
                </button>
              </div>
              <p style={{ fontWeight: 600, margin: '0 0 var(--sp-3)' }}>{item.text}</p>

              <label style={{ display: 'block', fontSize: 'var(--text-sm)', color: 'var(--c-text-2)', marginBottom: 'var(--sp-1)' }}>Answer</label>
              <textarea rows={3} value={draft.answerText}
                onChange={e => setDrafts(prev => ({ ...prev, [item.questionId]: { ...prev[item.questionId], answerText: e.target.value } }))}
                onBlur={() => saveField(item.questionId, { answerText: draft.answerText })}
                style={{ ...inputStyle, marginBottom: 'var(--sp-2)' }} />

              <label style={{ display: 'block', fontSize: 'var(--text-sm)', color: 'var(--c-text-2)', marginBottom: 'var(--sp-1)' }}>Boss note</label>
              <input value={draft.bossNote}
                onChange={e => setDrafts(prev => ({ ...prev, [item.questionId]: { ...prev[item.questionId], bossNote: e.target.value } }))}
                onBlur={() => saveField(item.questionId, { bossNote: draft.bossNote })}
                style={{ ...inputStyle, marginBottom: 'var(--sp-2)' }} />

              <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-3)' }}>
                <input type="checkbox" checked={item.answer?.affectsRanking ?? false}
                  onChange={e => saveField(item.questionId, { affectsRanking: e.target.checked })} />
                Affects ranking
              </label>

              {fieldError[item.questionId] && (
                <p style={{ color: 'var(--c-danger)', fontSize: 'var(--text-sm)' }}>{fieldError[item.questionId]}</p>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
                <button disabled={!hasAnswer || !!aiTakeBusy[item.questionId]} onClick={() => aiTake(item.questionId)}
                  style={{ ...actionBtn, opacity: !hasAnswer || aiTakeBusy[item.questionId] ? 0.5 : 1 }}>
                  {aiTakeBusy[item.questionId] ? 'Thinking…' : 'AI take'}
                </button>
                {item.answer?.aiComment && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
                    <span style={{ color: 'var(--c-text-2)', fontSize: 'var(--text-sm)' }}>{item.answer.aiComment}</span>
                    <StatusBadge status="confidence" tone={CONFIDENCE_TONE[confidenceLabel(item.answer.confidence ?? 0)]}
                      label={confidenceLabel(item.answer.confidence ?? 0)} />
                  </span>
                )}
              </div>
              {aiTakeError[item.questionId] && (
                <p style={{ color: 'var(--c-danger)', fontSize: 'var(--text-sm)', display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', margin: 'var(--sp-2) 0 0' }}>
                  {aiTakeError[item.questionId]}
                  <button onClick={() => aiTake(item.questionId)} style={actionBtn}>Retry</button>
                </p>
              )}
            </div>
          )
        })}
      </div>

      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--sp-3)' }}>
          <h2 style={{ margin: 0, fontSize: 'var(--text-lg)' }}>Summary</h2>
          <button disabled={!hasAnyAnswer || summaryBusy} onClick={summarise}
            style={{ ...primaryBtn, opacity: !hasAnyAnswer || summaryBusy ? 0.5 : 1 }}>
            {summaryBusy ? 'Summarising…' : 'Summarise interview'}
          </button>
        </div>

        {summaryError && (
          <p style={{ color: 'var(--c-danger)', display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
            {summaryError}
            <button onClick={summarise} style={actionBtn}>Retry</button>
          </p>
        )}

        {!summary && interview.summaryPath && (
          <p style={{ color: 'var(--c-text-2)', margin: 0 }}>
            Already summarised (AI score {interview.aiScore ?? '—'}). Click "Summarise interview" to view the narrative again.
          </p>
        )}
        {!summary && !interview.summaryPath && !summaryError && (
          <p style={{ color: 'var(--c-text-2)', margin: 0 }}>Not summarised yet.</p>
        )}

        {summary && (
          <div>
            <p>{summary.output.summary}</p>

            <h3 style={{ fontSize: 'var(--text-md)', margin: '0 0 var(--sp-2)' }}>Soft skills</h3>
            <p>{summary.output.soft_skill_observations.assessment}</p>

            <h3 style={{ fontSize: 'var(--text-md)', margin: '0 0 var(--sp-2)' }}>Stability</h3>
            <p>{summary.output.stability_inference.assessment}</p>

            {summary.output.risk_points.length > 0 && (
              <>
                <h3 style={{ fontSize: 'var(--text-md)', margin: '0 0 var(--sp-2)' }}>Risk points</h3>
                <ul style={{ marginTop: 0 }}>
                  {summary.output.risk_points.map((r, i) => <li key={i}>{r.assessment}</li>)}
                </ul>
              </>
            )}

            {summary.output.recommended_follow_ups.length > 0 && (
              <>
                <h3 style={{ fontSize: 'var(--text-md)', margin: '0 0 var(--sp-2)' }}>Recommended follow-ups</h3>
                <ul style={{ marginTop: 0 }}>
                  {summary.output.recommended_follow_ups.map((f, i) => <li key={i}>{f}</li>)}
                </ul>
              </>
            )}

            <div style={{ margin: 'var(--sp-3) 0' }}>
              <StatusBadge status={summary.output.next_round_recommendation.verdict}
                tone={VERDICT_TONE[summary.output.next_round_recommendation.verdict]}
                label={VERDICT_LABEL[summary.output.next_round_recommendation.verdict]} />
              <p style={{ color: 'var(--c-text-2)', margin: 'var(--sp-2) 0 0' }}>{summary.output.next_round_recommendation.reason}</p>
            </div>

            <h3 style={{ fontSize: 'var(--text-md)', margin: '0 0 var(--sp-2)' }}>Interview performance</h3>
            {summary.output.interview_performance ? (
              <>
                <p style={{ fontSize: 'var(--text-lg)', fontWeight: 700, margin: '0 0 var(--sp-1)' }}>
                  {summary.output.interview_performance.score}
                </p>
                <p style={{ margin: '0 0 var(--sp-1)' }}>{summary.output.interview_performance.reason}</p>
                <p style={{ color: 'var(--c-text-2)', fontSize: 'var(--text-sm)' }}>
                  from {items.filter(i => i.answer?.affectsRanking).length} flagged item(s)
                </p>
              </>
            ) : (
              <p style={{ color: 'var(--c-text-2)' }}>no items flagged — no ranking factor</p>
            )}

            <h3 style={{ fontSize: 'var(--text-md)', margin: 'var(--sp-3) 0 var(--sp-2)' }}>Memory proposals</h3>
            {summary.proposals.length === 0 ? (
              <p style={{ color: 'var(--c-text-2)', margin: 0 }}>None this round.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
                {summary.proposals.map(p => (
                  <div key={p.id} style={{ border: '1px solid var(--c-border)', borderRadius: 'var(--radius-sm)', padding: 'var(--sp-3)' }}>
                    <p style={{ margin: '0 0 var(--sp-2)' }}>{p.lesson}</p>
                    <ul style={{ margin: '0 0 var(--sp-2)', paddingLeft: 'var(--sp-5)', color: 'var(--c-text-2)', fontSize: 'var(--text-sm)' }}>
                      {p.evidence.map((e, i) => <li key={i}>“{e.quote}” [{e.source}]</li>)}
                    </ul>
                    {p.status === 'pending' && (
                      <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
                        <button disabled={!!proposalBusy[p.id]} onClick={() => decideProposal(p.id, 'approve')} style={actionBtn}>Approve</button>
                        <button disabled={!!proposalBusy[p.id]} onClick={() => decideProposal(p.id, 'reject')} style={actionBtn}>Reject</button>
                      </div>
                    )}
                    {p.status === 'refused' && (
                      <p style={{ color: 'var(--c-warn-text)', background: 'var(--c-warn-bg)', padding: 'var(--sp-2) var(--sp-3)', borderRadius: 'var(--radius-sm)', margin: 0 }}>
                        Refused — {p.refusalReason}
                      </p>
                    )}
                    {(p.status === 'approved' || p.status === 'rejected') && (
                      <StatusBadge status={p.status} tone={p.status === 'approved' ? 'ok' : 'danger'} />
                    )}
                    {proposalError[p.id] && <p style={{ color: 'var(--c-danger)', fontSize: 'var(--text-sm)' }}>{proposalError[p.id]}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
