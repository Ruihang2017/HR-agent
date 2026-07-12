import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { apiJson, ApiError } from '../api'
import StatusBadge, { type Tone } from '../components/StatusBadge'
import ConfirmDeleteModal from '../components/ConfirmDeleteModal'

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
interface InterviewListRow {
  id: number; stage: number; createdAt: string; hasSummary: boolean
  aiScore: number | null; bossDecision: string | null
}
interface TemplateInput { key: string; label: string; kind: string; required: boolean }
interface TemplateInfo { type: string; label: string; subject: string; inputs: TemplateInput[] }
interface RenderedEmail { subject: string; body: string }
interface EmailSummary { id: number; type: string; filePath: string; createdAt: string }
interface EmailDetail { id: number; type: string; createdAt: string; content: string }

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
const inputStyle: CSSProperties = {
  border: '1px solid var(--c-border)', borderRadius: 'var(--radius-sm)', padding: 'var(--sp-2)',
  width: '100%', background: 'var(--c-surface)', color: 'var(--c-text)'
}

/** `datetime-local`'s raw value ("2026-07-15T14:30") isn't fit for a template - render it the
 *  same way the server renders `today` (emails.ts renderEmail) so the email reads naturally. */
function formatReadableDatetime(raw: string): string {
  if (!raw) return ''
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return raw
  return new Intl.DateTimeFormat('en-AU', { dateStyle: 'long', timeStyle: 'short' }).format(d)
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
  const navigate = useNavigate()
  const candidateId = Number(id)
  const [c, setC] = useState<CandidateDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [analysis, setAnalysis] = useState<AnalysisResp | null>(null)
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [triggerBusy, setTriggerBusy] = useState(false)
  const [triggerError, setTriggerError] = useState<string | null>(null)
  const pollTimer = useRef<number | undefined>(undefined)

  const [interviews, setInterviews] = useState<InterviewListRow[]>([])
  const [interviewsError, setInterviewsError] = useState<string | null>(null)
  const [creatingInterview, setCreatingInterview] = useState(false)

  const [emailTemplates, setEmailTemplates] = useState<TemplateInfo[] | null>(null)
  const [emailTemplatesError, setEmailTemplatesError] = useState<string | null>(null)
  const [emailType, setEmailType] = useState('')
  const [emailInputs, setEmailInputs] = useState<Record<string, string>>({})
  const [emailPreview, setEmailPreview] = useState<RenderedEmail | null>(null)
  const [emailPreviewBusy, setEmailPreviewBusy] = useState(false)
  const [emailSaveBusy, setEmailSaveBusy] = useState(false)
  const [emailError, setEmailError] = useState<string | null>(null)
  const [emailCopied, setEmailCopied] = useState(false)
  const [savedEmails, setSavedEmails] = useState<EmailSummary[]>([])
  const [savedEmailsError, setSavedEmailsError] = useState<string | null>(null)
  const [openEmailId, setOpenEmailId] = useState<number | null>(null)
  const [emailContents, setEmailContents] = useState<Record<number, string | undefined>>({})
  const [emailContentError, setEmailContentError] = useState<Record<number, string | null>>({})
  const [emailContentBusy, setEmailContentBusy] = useState<Record<number, boolean>>({})
  const [copiedEmailId, setCopiedEmailId] = useState<number | null>(null)

  useEffect(() => {
    apiJson<CandidateDetail>(`/candidates/${candidateId}`).then(setC).catch(e => setError(e.message))
  }, [candidateId])

  const fetchInterviews = useCallback(() => {
    apiJson<InterviewListRow[]>(`/candidates/${candidateId}/interviews`)
      .then(setInterviews)
      .catch(e => setInterviewsError(e instanceof Error ? e.message : String(e)))
  }, [candidateId])
  useEffect(fetchInterviews, [fetchInterviews])

  async function startInterview() {
    setInterviewsError(null); setCreatingInterview(true)
    try {
      const res = await apiJson<{ interview: { id: number } }>(`/candidates/${candidateId}/interviews`, { method: 'POST' })
      navigate(`/interviews/${res.interview.id}`)
    } catch (e) {
      setInterviewsError(e instanceof Error ? e.message : String(e))
    } finally {
      setCreatingInterview(false)
    }
  }

  useEffect(() => {
    apiJson<TemplateInfo[]>('/email-templates')
      .then(ts => {
        setEmailTemplates(ts)
        setEmailType(prev => prev || (ts[0]?.type ?? ''))
      })
      .catch(e => setEmailTemplatesError(e instanceof Error ? e.message : String(e)))
  }, [])

  const fetchSavedEmails = useCallback(() => {
    apiJson<EmailSummary[]>(`/candidates/${candidateId}/emails`)
      .then(setSavedEmails)
      .catch(e => setSavedEmailsError(e instanceof Error ? e.message : String(e)))
  }, [candidateId])
  useEffect(fetchSavedEmails, [fetchSavedEmails])

  // Switching templates starts a clean form - a stray value from a differently-shaped
  // template (or a stale preview/error for it) must not bleed into the next one.
  useEffect(() => {
    setEmailInputs({})
    setEmailPreview(null)
    setEmailError(null)
  }, [emailType])

  const currentTemplate = emailTemplates?.find(t => t.type === emailType) ?? null
  const emailMissingRequired = currentTemplate
    ? currentTemplate.inputs.some(i => i.required && !(emailInputs[i.key] ?? '').trim())
    : false

  function buildEmailPayloadInputs(template: TemplateInfo): Record<string, string> {
    const out: Record<string, string> = {}
    for (const input of template.inputs) {
      const raw = emailInputs[input.key] ?? ''
      out[input.key] = input.kind === 'datetime' ? formatReadableDatetime(raw) : raw
    }
    return out
  }

  async function previewEmail() {
    if (!currentTemplate) return
    setEmailError(null); setEmailPreviewBusy(true)
    try {
      const res = await apiJson<RenderedEmail>(`/candidates/${candidateId}/emails`, {
        method: 'POST',
        body: JSON.stringify({ type: currentTemplate.type, inputs: buildEmailPayloadInputs(currentTemplate), save: false })
      })
      setEmailPreview(res)
    } catch (e) {
      setEmailError(e instanceof Error ? e.message : String(e))
    } finally {
      setEmailPreviewBusy(false)
    }
  }

  async function saveEmailNow() {
    if (!currentTemplate) return
    setEmailError(null); setEmailSaveBusy(true)
    try {
      const res = await apiJson<{ id: number; filePath: string; subject: string; body: string }>(
        `/candidates/${candidateId}/emails`,
        { method: 'POST', body: JSON.stringify({ type: currentTemplate.type, inputs: buildEmailPayloadInputs(currentTemplate), save: true }) }
      )
      setEmailPreview({ subject: res.subject, body: res.body })
      fetchSavedEmails()
    } catch (e) {
      setEmailError(e instanceof Error ? e.message : String(e))
    } finally {
      setEmailSaveBusy(false)
    }
  }

  async function copyEmailPreview() {
    if (!emailPreview) return
    await navigator.clipboard.writeText(`Subject: ${emailPreview.subject}\n\n${emailPreview.body}`)
    setEmailCopied(true)
    setTimeout(() => setEmailCopied(false), 1500)
  }

  async function toggleViewSavedEmail(id: number) {
    if (openEmailId === id) { setOpenEmailId(null); return }
    setOpenEmailId(id)
    if (emailContents[id] !== undefined) return
    setEmailContentBusy(prev => ({ ...prev, [id]: true }))
    setEmailContentError(prev => ({ ...prev, [id]: null }))
    try {
      const res = await apiJson<EmailDetail>(`/emails/${id}`)
      setEmailContents(prev => ({ ...prev, [id]: res.content }))
    } catch (e) {
      setEmailContentError(prev => ({ ...prev, [id]: e instanceof Error ? e.message : String(e) }))
    } finally {
      setEmailContentBusy(prev => ({ ...prev, [id]: false }))
    }
  }

  async function copySavedEmail(id: number) {
    let content = emailContents[id]
    if (content === undefined) {
      try {
        const res = await apiJson<EmailDetail>(`/emails/${id}`)
        content = res.content
        setEmailContents(prev => ({ ...prev, [id]: content as string }))
      } catch (e) {
        setEmailContentError(prev => ({ ...prev, [id]: e instanceof Error ? e.message : String(e) }))
        return
      }
    }
    await navigator.clipboard.writeText(content)
    setCopiedEmailId(id)
    setTimeout(() => setCopiedEmailId(null), 1500)
  }

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
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--sp-2)' }}>
          <button onClick={() => window.jobpin.openPath(c.folderPath)}
            style={{ border: '1px solid var(--c-border)', background: 'var(--c-surface)',
                     padding: 'var(--sp-1) var(--sp-3)', borderRadius: 'var(--radius-sm)' }}>
            Open folder
          </button>
          <button onClick={() => setDeleteOpen(true)}
            style={{ background: 'var(--c-danger)', color: 'var(--c-on-accent)', border: 'none',
                     padding: 'var(--sp-1) var(--sp-3)', borderRadius: 'var(--radius-sm)' }}>
            Delete candidate
          </button>
        </div>
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--sp-3)' }}>
          <h2 style={{ margin: 0, fontSize: 'var(--text-lg)' }}>Interviews</h2>
          <button disabled={creatingInterview} onClick={startInterview}
            style={{ ...actionBtn, opacity: creatingInterview ? 0.5 : 1 }}>
            {creatingInterview ? 'Starting…' : 'New interview round'}
          </button>
        </div>

        {interviewsError && <p style={{ color: 'var(--c-danger)', fontSize: 'var(--text-sm)' }}>{interviewsError}</p>}

        {interviews.length === 0 ? (
          <p style={{ color: 'var(--c-text-2)', margin: 0 }}>No interview rounds yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {interviews.map(iv => (
              <Link key={iv.id} to={`/interviews/${iv.id}`} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: 'var(--sp-3) 0', borderTop: '1px solid var(--c-border)',
                textDecoration: 'none', color: 'inherit'
              }}>
                <span>Round {iv.stage} · {iv.createdAt.slice(0, 10)}</span>
                <span style={{ color: 'var(--c-text-2)', fontSize: 'var(--text-sm)', display: 'flex', gap: 'var(--sp-3)' }}>
                  <span>AI score {iv.aiScore ?? '—'}</span>
                  <span>Boss decision {iv.bossDecision ?? '—'}</span>
                  <span>Summary {iv.hasSummary ? '✓' : '—'}</span>
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div style={card}>
        <h2 style={{ margin: '0 0 var(--sp-3)', fontSize: 'var(--text-lg)' }}>Emails</h2>

        {emailTemplatesError && <p style={{ color: 'var(--c-danger)', fontSize: 'var(--text-sm)' }}>{emailTemplatesError}</p>}

        {emailTemplates && (
          <>
            <label style={{ display: 'block', fontSize: 'var(--text-sm)', color: 'var(--c-text-2)', marginBottom: 'var(--sp-1)' }}>
              Template
            </label>
            <select value={emailType} onChange={e => setEmailType(e.target.value)} style={{ ...inputStyle, marginBottom: 'var(--sp-3)' }}>
              {emailTemplates.map(t => <option key={t.type} value={t.type}>{t.label}</option>)}
            </select>

            {currentTemplate && currentTemplate.inputs.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)', marginBottom: 'var(--sp-3)' }}>
                {currentTemplate.inputs.map(input => (
                  <div key={input.key}>
                    <label style={{ display: 'block', fontSize: 'var(--text-sm)', color: 'var(--c-text-2)', marginBottom: 'var(--sp-1)' }}>
                      {input.label}{input.required ? ' *' : ''}
                    </label>
                    {input.kind === 'datetime' ? (
                      <input type="datetime-local"
                        value={emailInputs[input.key] ?? ''}
                        onChange={e => setEmailInputs(prev => ({ ...prev, [input.key]: e.target.value }))}
                        style={inputStyle} />
                    ) : input.kind === 'multiline' ? (
                      <textarea rows={3}
                        value={emailInputs[input.key] ?? ''}
                        onChange={e => setEmailInputs(prev => ({ ...prev, [input.key]: e.target.value }))}
                        style={inputStyle} />
                    ) : (
                      <input type="text"
                        value={emailInputs[input.key] ?? ''}
                        onChange={e => setEmailInputs(prev => ({ ...prev, [input.key]: e.target.value }))}
                        style={inputStyle} />
                    )}
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', gap: 'var(--sp-3)', marginBottom: 'var(--sp-3)' }}>
              <button disabled={!currentTemplate || emailMissingRequired || emailPreviewBusy} onClick={previewEmail}
                style={{ ...actionBtn, opacity: !currentTemplate || emailMissingRequired || emailPreviewBusy ? 0.5 : 1 }}>
                {emailPreviewBusy ? 'Rendering…' : 'Preview'}
              </button>
              <button disabled={!currentTemplate || emailMissingRequired || emailSaveBusy} onClick={saveEmailNow}
                style={{ ...primaryBtn, opacity: !currentTemplate || emailMissingRequired || emailSaveBusy ? 0.5 : 1 }}>
                {emailSaveBusy ? 'Saving…' : 'Save'}
              </button>
            </div>

            {emailError && <p style={{ color: 'var(--c-danger)', fontSize: 'var(--text-sm)' }}>{emailError}</p>}

            {emailPreview && (
              <div style={{ border: '1px solid var(--c-border)', borderRadius: 'var(--radius-sm)', padding: 'var(--sp-3)', marginBottom: 'var(--sp-4)' }}>
                <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: '0 0 var(--sp-3)' }}>
                  {`Subject: ${emailPreview.subject}\n\n${emailPreview.body}`}
                </pre>
                <button onClick={copyEmailPreview} style={actionBtn}>{emailCopied ? 'Copied' : 'Copy'}</button>
              </div>
            )}
          </>
        )}

        <h3 style={{ margin: '0 0 var(--sp-2)', fontSize: 'var(--text-md)' }}>Saved emails</h3>
        {savedEmailsError && <p style={{ color: 'var(--c-danger)', fontSize: 'var(--text-sm)' }}>{savedEmailsError}</p>}
        {savedEmails.length === 0 ? (
          <p style={{ color: 'var(--c-text-2)', margin: 0 }}>No emails saved yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {savedEmails.map(em => (
              <div key={em.id} style={{ borderTop: '1px solid var(--c-border)', padding: 'var(--sp-3) 0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>{emailTemplates?.find(t => t.type === em.type)?.label ?? em.type} · {em.createdAt.slice(0, 10)}</span>
                  <span style={{ display: 'flex', gap: 'var(--sp-2)' }}>
                    <button onClick={() => toggleViewSavedEmail(em.id)} style={actionBtn}>
                      {openEmailId === em.id ? 'Hide' : 'View'}
                    </button>
                    <button onClick={() => copySavedEmail(em.id)} style={actionBtn}>
                      {copiedEmailId === em.id ? 'Copied' : 'Copy'}
                    </button>
                  </span>
                </div>
                {openEmailId === em.id && (
                  <div style={{ marginTop: 'var(--sp-2)' }}>
                    {emailContentBusy[em.id] && <p style={{ color: 'var(--c-text-2)', fontSize: 'var(--text-sm)' }}>Loading…</p>}
                    {emailContentError[em.id] && <p style={{ color: 'var(--c-danger)', fontSize: 'var(--text-sm)' }}>{emailContentError[em.id]}</p>}
                    {emailContents[em.id] !== undefined && (
                      <pre style={{
                        whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0,
                        background: 'var(--c-bg)', border: '1px solid var(--c-border)',
                        borderRadius: 'var(--radius-sm)', padding: 'var(--sp-3)'
                      }}>{emailContents[em.id]}</pre>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

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

      {deleteOpen && (
        <ConfirmDeleteModal
          title="Delete this candidate?"
          expectedName={c.name}
          nameLabel="candidate name"
          description="Removes their files and personal details; past rankings keep the rank & score with the name removed. This cannot be undone."
          onConfirm={async () => {
            await apiJson(`/candidates/${candidateId}`, { method: 'DELETE' })
            navigate(`/jobs/${c.jobId}`)
          }}
          onClose={() => setDeleteOpen(false)}
        />
      )}
    </div>
  )
}
