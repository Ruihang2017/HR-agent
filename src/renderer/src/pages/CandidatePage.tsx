import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { Link, useParams } from 'react-router-dom'
import { apiJson, ApiError } from '../api'
import StatusBadge, { type Tone } from '../components/StatusBadge'

interface CandidateDetail {
  id: number; jobId: number; name: string; email: string | null; phone: string | null
  status: string; extractedText: string | null
  extraction: { status: 'ok' | 'failed'; error?: string }
  originalFilename?: string; folderPath: string; createdAt: string
}

type Confidence = 'low' | 'medium' | 'high'
interface Evidence { quote: string; source: string }
interface Judgment { assessment: string; evidence: Evidence[]; confidence: Confidence }
interface FactorScore { score: number; reason: string; evidence: Evidence[]; confidence: Confidence }
interface AnalysisOutput {
  summary: string
  dimensions: {
    jd_fit: Judgment; must_have_skills: Judgment; bonus_skills: Judgment
    career_continuity: Judgment; growth_trajectory: Judgment
    communication_style: Judgment; soft_skill_evidence: Judgment
    risk_points: Judgment[]
  }
  recommended_questions: string[]
  recommendation: 'strong_yes' | 'yes' | 'maybe' | 'no'
  factors: {
    jd_fit: FactorScore; key_skills: FactorScore; relevant_experience: FactorScore
    growth_trajectory: FactorScore; boss_preference_match: FactorScore | null
  }
  sensitive_flags: { attribute: string; note: string }[]
}
interface AnalysisResp {
  analysisId: number; provider: string; model: string; promptVersion: string; createdAt: string
  output: AnalysisOutput
}
interface TaskRow {
  id: number; candidate_id: number
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  error: string | null
}
interface EnqueueResult { enqueued: number[]; skipped: { candidateId: number; reason: string }[] }

const RECOMMENDATION_LABEL: Record<AnalysisOutput['recommendation'], string> = {
  strong_yes: 'Strong yes', yes: 'Yes', maybe: 'Maybe', no: 'No'
}
const RECOMMENDATION_TONE: Record<AnalysisOutput['recommendation'], Tone> = {
  strong_yes: 'ok', yes: 'accent', maybe: 'warn', no: 'danger'
}
const CONFIDENCE_TONE: Record<Confidence, Tone> = { high: 'ok', medium: 'warn', low: 'danger' }

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

function FactorCell({ label, factor }: { label: string; factor: FactorScore | null }) {
  return (
    <div>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--c-text-2)' }}>{label}</div>
      <div style={{ fontSize: 'var(--text-lg)', fontWeight: 700 }}>{factor ? factor.score : '—'}</div>
    </div>
  )
}

function DimensionCard({ label, judgment }: { label: string; judgment: Judgment }) {
  return (
    <div style={{ border: '1px solid var(--c-border)', borderRadius: 'var(--radius-sm)', padding: 'var(--sp-3)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--sp-2)' }}>
        <strong>{label}</strong>
        <StatusBadge status={judgment.confidence} tone={CONFIDENCE_TONE[judgment.confidence]} />
      </div>
      <p style={{ margin: 'var(--sp-2) 0' }}>{judgment.assessment}</p>
      <ul style={{ margin: 0, paddingLeft: 'var(--sp-5)', color: 'var(--c-text-2)', fontSize: 'var(--text-sm)' }}>
        {judgment.evidence.map((e, i) => (
          <li key={i}>“{e.quote}” <span style={{ fontSize: 'var(--text-xs)' }}>[{e.source}]</span></li>
        ))}
      </ul>
    </div>
  )
}

export default function CandidatePage() {
  const { id } = useParams()
  const candidateId = Number(id)
  const [c, setC] = useState<CandidateDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [analysis, setAnalysis] = useState<AnalysisResp | null>(null)
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [triggerBusy, setTriggerBusy] = useState(false)
  const [triggerError, setTriggerError] = useState<string | null>(null)
  const pollTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    apiJson<CandidateDetail>(`/candidates/${candidateId}`).then(setC).catch(e => setError(e.message))
  }, [candidateId])

  const fetchAnalysis = useCallback(() => {
    apiJson<AnalysisResp>(`/candidates/${candidateId}/analysis`)
      .then(setAnalysis)
      .catch(e => {
        if (e instanceof ApiError && e.status === 404) setAnalysis(null)
        // any other fetch failure leaves the last-known analysis in place
      })
  }, [candidateId])
  useEffect(fetchAnalysis, [fetchAnalysis])

  // Poll this candidate's task state via the job's analysis-task list (there is no
  // per-candidate task endpoint) until the latest task settles, then refetch the
  // analysis output. Only reschedules while queued/running — same pattern as JobDetailPage.
  const pollTasks = useCallback(async (jobId: number) => {
    window.clearTimeout(pollTimer.current)
    try {
      const a = await apiJson<{ tasks: TaskRow[] }>(`/jobs/${jobId}/analyses`)
      setTasks(a.tasks)
      const mine = a.tasks.filter(t => t.candidate_id === candidateId)
      const latest = mine[mine.length - 1]
      if (latest && (latest.status === 'queued' || latest.status === 'running')) {
        pollTimer.current = window.setTimeout(() => pollTasks(jobId), 3000)
      } else {
        fetchAnalysis()
      }
    } catch {
      // transient poll failure — keep last known state
    }
  }, [candidateId, fetchAnalysis])

  useEffect(() => {
    if (!c) return
    pollTasks(c.jobId)
    return () => window.clearTimeout(pollTimer.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c?.jobId])

  if (!c) return <p style={{ color: 'var(--c-text-2)' }}>{error ?? 'Loading…'}</p>

  async function triggerAnalysis() {
    if (!c) return
    setTriggerError(null); setTriggerBusy(true)
    try {
      const res = await apiJson<EnqueueResult>(`/jobs/${c.jobId}/analyses`, {
        method: 'POST', body: JSON.stringify({ candidateIds: [c.id] })
      })
      if (res.enqueued.length === 0 && res.skipped.length > 0) {
        setTriggerError(res.skipped[0].reason)
      } else {
        pollTasks(c.jobId)
      }
    } catch (e) {
      setTriggerError(e instanceof Error ? e.message : String(e))
    } finally {
      setTriggerBusy(false)
    }
  }

  async function retryTask(taskId: number) {
    if (!c) return
    setTriggerError(null)
    try {
      await apiJson(`/analysis-tasks/${taskId}/retry`, { method: 'POST' })
      pollTasks(c.jobId)
    } catch (e) {
      setTriggerError(e instanceof Error ? e.message : String(e))
    }
  }

  const mine = tasks.filter(t => t.candidate_id === candidateId)
  const latestTask = mine[mine.length - 1]
  const isActive = latestTask?.status === 'queued' || latestTask?.status === 'running'
  const isFailed = latestTask?.status === 'failed'
  const d = analysis?.output.dimensions

  return (
    <div style={{ maxWidth: 820 }}>
      <p style={{ marginTop: 0 }}><Link to={`/jobs/${c.jobId}`}>← back to job</Link></p>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--sp-3)' }}>
        <h1 style={{ margin: 0 }}>{c.name}</h1>
        <StatusBadge status={c.status} />
        <button onClick={() => window.jobpin.openPath(c.folderPath)}
          style={{ marginLeft: 'auto', border: '1px solid var(--c-border)', background: 'var(--c-surface)',
                   padding: 'var(--sp-1) var(--sp-3)', borderRadius: 'var(--radius-sm)' }}>
          Open folder
        </button>
      </div>
      <p style={{ color: 'var(--c-text-2)' }}>
        {c.originalFilename ? `from ${c.originalFilename} · ` : ''}added {c.createdAt.slice(0, 10)}
      </p>

      {c.extraction.status === 'failed' && (
        <div style={{ background: 'var(--c-warn-bg)', color: 'var(--c-warn-text)',
                      padding: 'var(--sp-3) var(--sp-4)', borderRadius: 'var(--radius)', marginBottom: 'var(--sp-4)' }}>
          Text could not be extracted: {c.extraction.error}. The original file is preserved — use
          "Open folder" to view it.
        </div>
      )}

      <div style={card}>
        <h2 style={{ margin: '0 0 var(--sp-3)', fontSize: 'var(--text-lg)' }}>Analysis</h2>

        {triggerError && <p style={{ color: 'var(--c-danger)' }}>{triggerError}</p>}

        {isActive && (
          <p style={{ color: 'var(--c-text-2)', display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
            <StatusBadge status={latestTask.status} tone="warn" />
            {latestTask.status === 'queued' ? 'Waiting to start…' : 'Running — this can take up to a minute…'}
          </p>
        )}

        {isFailed && (
          <div style={{ background: 'var(--c-warn-bg)', color: 'var(--c-warn-text)',
                        padding: 'var(--sp-3) var(--sp-4)', borderRadius: 'var(--radius-sm)', marginBottom: 'var(--sp-4)' }}>
            <p style={{ margin: '0 0 var(--sp-2)', fontWeight: 600 }}>Analysis unavailable — retry</p>
            <p style={{ margin: '0 0 var(--sp-2)' }}>{latestTask.error}</p>
            <button onClick={() => retryTask(latestTask.id)} style={actionBtn}>Retry</button>
          </div>
        )}

        {!isActive && !isFailed && !analysis && (
          <>
            <p style={{ color: 'var(--c-text-2)' }}>No analysis yet.</p>
            <button disabled={triggerBusy} onClick={triggerAnalysis}
              style={{ ...primaryBtn, opacity: triggerBusy ? 0.5 : 1 }}>
              {triggerBusy ? 'Analysing…' : 'Analyse'}
            </button>
          </>
        )}

        {analysis && d && (
          <>
            {isFailed && (
              <p style={{ color: 'var(--c-text-2)', fontStyle: 'italic' }}>
                Showing the most recent successful analysis, from {analysis.createdAt.slice(0, 10)} — the
                attempt above has not replaced it.
              </p>
            )}

            <p>{analysis.output.summary}</p>
            <p>
              <StatusBadge status={analysis.output.recommendation}
                tone={RECOMMENDATION_TONE[analysis.output.recommendation]}
                label={RECOMMENDATION_LABEL[analysis.output.recommendation]} />
            </p>

            <div style={{ display: 'flex', gap: 'var(--sp-5)', flexWrap: 'wrap', margin: 'var(--sp-4) 0' }}>
              <FactorCell label="JD fit" factor={analysis.output.factors.jd_fit} />
              <FactorCell label="Key skills" factor={analysis.output.factors.key_skills} />
              <FactorCell label="Relevant experience" factor={analysis.output.factors.relevant_experience} />
              <FactorCell label="Growth trajectory" factor={analysis.output.factors.growth_trajectory} />
              <FactorCell label="Boss preference match" factor={analysis.output.factors.boss_preference_match} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)', marginBottom: 'var(--sp-4)' }}>
              <DimensionCard label="JD fit" judgment={d.jd_fit} />
              <DimensionCard label="Must-have skills" judgment={d.must_have_skills} />
              <DimensionCard label="Bonus skills" judgment={d.bonus_skills} />
              <DimensionCard label="Career continuity" judgment={d.career_continuity} />
              <DimensionCard label="Growth trajectory" judgment={d.growth_trajectory} />
              <DimensionCard label="Communication style" judgment={d.communication_style} />
              <DimensionCard label="Soft-skill evidence" judgment={d.soft_skill_evidence} />
              {d.risk_points.map((j, i) => (
                <DimensionCard key={`risk-${i}`} label={`Risk point ${i + 1}`} judgment={j} />
              ))}
            </div>

            {analysis.output.sensitive_flags.length > 0 && (
              <div style={{ background: 'var(--c-warn-bg)', color: 'var(--c-warn-text)',
                            padding: 'var(--sp-3) var(--sp-4)', borderRadius: 'var(--radius-sm)', marginBottom: 'var(--sp-4)' }}>
                <p style={{ margin: '0 0 var(--sp-2)', fontWeight: 600 }}>Flagged — must not be used for decisions</p>
                <ul style={{ margin: 0, paddingLeft: 'var(--sp-5)' }}>
                  {analysis.output.sensitive_flags.map((f, i) => (
                    <li key={i}><strong>{f.attribute}</strong>: {f.note}</li>
                  ))}
                </ul>
              </div>
            )}

            <div style={{ marginBottom: 'var(--sp-4)' }}>
              <h3 style={{ margin: '0 0 var(--sp-2)', fontSize: 'var(--text-md)' }}>Recommended questions</h3>
              <ul style={{ margin: 0, paddingLeft: 'var(--sp-5)' }}>
                {analysis.output.recommended_questions.map((q, i) => <li key={i}>{q}</li>)}
              </ul>
            </div>

            <p style={{ color: 'var(--c-text-2)', fontSize: 'var(--text-sm)', display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
              <span>
                Analysed by {analysis.provider}/{analysis.model} · {analysis.promptVersion} · {analysis.createdAt.slice(0, 10)}
              </span>
              <button disabled={triggerBusy} onClick={triggerAnalysis}
                style={{ ...actionBtn, opacity: triggerBusy ? 0.5 : 1 }}>
                {triggerBusy ? 'Re-analysing…' : 'Re-analyse'}
              </button>
            </p>
          </>
        )}
      </div>

      {c.extractedText && (
        <div style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)',
                      borderRadius: 'var(--radius)', padding: 'var(--sp-4)' }}>
          <h2 style={{ margin: '0 0 var(--sp-3)', fontSize: 'var(--text-lg)' }}>Resume text</h2>
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0 }}>{c.extractedText}</pre>
        </div>
      )}
    </div>
  )
}
