import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { apiJson, apiUpload } from '../api'
import StatusBadge, { type Tone } from '../components/StatusBadge'
import ConfirmDeleteModal from '../components/ConfirmDeleteModal'

interface JobDetail { id: number; name: string; folderPath: string; jd: string | null; createdAt: string }
interface CandidateSummary { id: number; name: string; status: string; createdAt: string }

interface TaskRow {
  id: number; candidate_id: number
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  error: string | null
}
interface AnalysesResp { tasks: TaskRow[]; latestByCandidate: Record<number, number> }
interface EnqueueResult { enqueued: number[]; skipped: { candidateId: number; reason: string }[] }

interface RankingSummary { id: number; createdAt: string; candidateCount: number }
interface RankingPerCandidate { candidate_id: number; factors: string[]; interview_analysis_id?: number }
interface RankingCriteria {
  factors: { key: string; base_weight: number }[]
  excluded: string[]
  per_candidate?: RankingPerCandidate[]
}
interface RankingItem { candidateId: number; candidateName: string; rank: number; score: number; reason: string | null }
interface RankingDetail { id: number; createdAt: string; reason: string | null; criteria: RankingCriteria; items: RankingItem[] }

interface RankExcluded { candidateId: number; reason: string }
interface RankResult {
  rankingId: number
  items: { candidateId: number; rank: number; score: number; reason: string }[]
  excluded: RankExcluded[]
}

// --- Memory (Task 11 / F7.1-F7.2) ---
interface MemoryEvidence { quote: string; source: string }
type MemoryStatus = 'pending' | 'approved' | 'rejected' | 'refused'
interface MemoryEvent {
  id: number; status: MemoryStatus; lesson: string; evidence: MemoryEvidence[]
  refusalReason?: string; sourceInterviewId: number | null; createdAt: string
}
interface MemoryResp { learnedSkills: string; events: MemoryEvent[] }
const MEMORY_STATUS_TONE: Record<MemoryStatus, Tone> = { pending: 'warn', approved: 'ok', rejected: 'danger', refused: 'danger' }

type AnalysisState =
  | { kind: 'none' }
  | { kind: 'queued' | 'running' }
  | { kind: 'analysed' }
  | { kind: 'failed'; error: string | null; taskId: number }

function analysisStateFor(candidateId: number, a: AnalysesResp): AnalysisState {
  const mine = a.tasks.filter(t => t.candidate_id === candidateId)
  const latest = mine[mine.length - 1] // tasks arrive ordered by id; last is newest
  if (latest) {
    if (latest.status === 'succeeded') return { kind: 'analysed' }
    if (latest.status === 'failed') return { kind: 'failed', error: latest.error, taskId: latest.id }
    return { kind: latest.status }
  }
  return a.latestByCandidate[candidateId] !== undefined ? { kind: 'analysed' } : { kind: 'none' }
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

function AnalysisCell({ state, onRetry }: { state: AnalysisState; onRetry: (taskId: number) => void }) {
  switch (state.kind) {
    case 'none':
      return <span style={{ color: 'var(--c-text-2)' }}>—</span>
    case 'analysed':
      return <StatusBadge status="analysed" />
    case 'queued':
    case 'running':
      return <StatusBadge status={state.kind} tone="warn" />
    case 'failed':
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
          <StatusBadge status="failed" tone="danger"
            label={`failed${state.error ? `: ${truncate(state.error, 40)}` : ''}`} />
          <button
            onClick={e => { e.preventDefault(); e.stopPropagation(); onRetry(state.taskId) }}
            style={{ border: '1px solid var(--c-border)', background: 'var(--c-surface)', fontSize: 'var(--text-xs)',
                     padding: '2px 8px', borderRadius: 'var(--radius-sm)' }}>
            Retry
          </button>
        </span>
      )
  }
}

export default function JobDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const jobId = Number(id)
  const [job, setJob] = useState<JobDetail | null>(null)
  const [cands, setCands] = useState<CandidateSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [newName, setNewName] = useState('')
  const [editingJd, setEditingJd] = useState(false)
  const [jdDraft, setJdDraft] = useState('')
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteName, setPasteName] = useState('')
  const [pasteText, setPasteText] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const [analyses, setAnalyses] = useState<AnalysesResp>({ tasks: [], latestByCandidate: {} })
  const [analyseBusy, setAnalyseBusy] = useState(false)
  const [analyseResult, setAnalyseResult] = useState<EnqueueResult | null>(null)
  const [analyseError, setAnalyseError] = useState<string | null>(null)
  const analysesPollTimer = useRef<number | undefined>(undefined)

  const [rankings, setRankings] = useState<RankingSummary[]>([])
  const [rankBusy, setRankBusy] = useState(false)
  const [rankError, setRankError] = useState<string | null>(null)
  const [rankResult, setRankResult] = useState<RankResult | null>(null)
  const [expandedRankingId, setExpandedRankingId] = useState<number | null>(null)
  const [expandedRanking, setExpandedRanking] = useState<RankingDetail | null>(null)

  const [memory, setMemory] = useState<MemoryResp | null>(null)
  const [memoryError, setMemoryError] = useState<string | null>(null)
  const [proposalBusy, setProposalBusy] = useState<Record<number, boolean>>({})
  const [proposalError, setProposalError] = useState<Record<number, string | null>>({})

  const refresh = useCallback(() => {
    apiJson<JobDetail>(`/jobs/${jobId}`).then(setJob).catch(e => setError(e.message))
    apiJson<CandidateSummary[]>(`/jobs/${jobId}/candidates`).then(setCands).catch(() => {})
  }, [jobId])
  useEffect(refresh, [refresh])

  // Poll the analysis task list every 3s, but only while something is queued/running —
  // mirrors the Shell health-poll pattern (recursive setTimeout, cleared on unmount).
  const pollAnalyses = useCallback(async () => {
    window.clearTimeout(analysesPollTimer.current)
    try {
      const a = await apiJson<AnalysesResp>(`/jobs/${jobId}/analyses`)
      setAnalyses(a)
      if (a.tasks.some(t => t.status === 'queued' || t.status === 'running')) {
        analysesPollTimer.current = window.setTimeout(pollAnalyses, 3000)
      }
    } catch {
      // transient poll failure — keep last known state, don't reschedule a tight loop
    }
  }, [jobId])
  useEffect(() => {
    pollAnalyses()
    return () => window.clearTimeout(analysesPollTimer.current)
  }, [pollAnalyses])

  const refreshRankings = useCallback(() => {
    apiJson<RankingSummary[]>(`/jobs/${jobId}/rankings`).then(setRankings).catch(() => {})
  }, [jobId])
  useEffect(refreshRankings, [refreshRankings])

  const refreshMemory = useCallback(() => {
    apiJson<MemoryResp>(`/jobs/${jobId}/memory`).then(setMemory).catch(e => setMemoryError(e.message))
  }, [jobId])
  useEffect(refreshMemory, [refreshMemory])

  async function decideMemoryEvent(eventId: number, decision: 'approve' | 'reject') {
    setProposalBusy(prev => ({ ...prev, [eventId]: true }))
    setProposalError(prev => ({ ...prev, [eventId]: null }))
    try {
      await apiJson(`/memory-events/${eventId}/${decision}`, { method: 'POST' })
      refreshMemory()
    } catch (e) {
      setProposalError(prev => ({ ...prev, [eventId]: e instanceof Error ? e.message : String(e) }))
    } finally {
      setProposalBusy(prev => ({ ...prev, [eventId]: false }))
    }
  }

  async function run(fn: () => Promise<unknown>) {
    setError(null)
    try { await fn(); refresh() } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }

  const rename = () => run(async () => {
    await apiJson(`/jobs/${jobId}`, { method: 'PATCH', body: JSON.stringify({ name: newName }) })
    setRenaming(false)
  })

  const saveJd = () => run(async () => {
    await apiJson(`/jobs/${jobId}/jd`, { method: 'PUT', body: JSON.stringify({ text: jdDraft }) })
    setEditingJd(false)
  })

  const addFiles = async (files: FileList | File[]) => {
    setError(null)
    const list = Array.from(files)
    const results = await Promise.allSettled(
      list.map(f => {
        const fd = new FormData()
        fd.append('file', f)
        return apiUpload(`/jobs/${jobId}/candidates`, 'POST', fd)
      })
    )
    const failures = results
      .map((r, i) =>
        r.status === 'rejected'
          ? `${list[i].name}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`
          : null
      )
      .filter((m): m is string => m !== null)
    if (failures.length > 0) setError(`Some files failed — ${failures.join(' · ')}`)
    refresh()
  }

  const addPaste = () => run(async () => {
    await apiJson(`/jobs/${jobId}/candidates`, {
      method: 'POST', body: JSON.stringify({ name: pasteName, text: pasteText })
    })
    setPasteName(''); setPasteText(''); setPasteOpen(false)
  })

  function candName(candidateId: number): string {
    return cands.find(c => c.id === candidateId)?.name ?? `candidate ${candidateId}`
  }

  function candNameOrHash(candidateId: number): string {
    return cands.find(c => c.id === candidateId)?.name ?? `candidate #${candidateId}`
  }

  async function analyseAllNew() {
    setAnalyseError(null); setAnalyseResult(null); setAnalyseBusy(true)
    try {
      const res = await apiJson<EnqueueResult>(`/jobs/${jobId}/analyses`, { method: 'POST', body: JSON.stringify({}) })
      setAnalyseResult(res)
      pollAnalyses()
    } catch (e) {
      setAnalyseError(e instanceof Error ? e.message : String(e))
    } finally {
      setAnalyseBusy(false)
    }
  }

  async function retryTask(taskId: number) {
    setAnalyseError(null)
    try {
      await apiJson(`/analysis-tasks/${taskId}/retry`, { method: 'POST' })
      pollAnalyses()
    } catch (e) {
      setAnalyseError(e instanceof Error ? e.message : String(e))
    }
  }

  async function rankNow() {
    setRankError(null); setRankResult(null); setRankBusy(true)
    try {
      const res = await apiJson<RankResult>(`/jobs/${jobId}/rankings`, { method: 'POST', body: JSON.stringify({}) })
      setRankResult(res)
      refreshRankings()
    } catch (e) {
      setRankError(e instanceof Error ? e.message : String(e))
    } finally {
      setRankBusy(false)
    }
  }

  async function toggleRanking(rankingId: number) {
    if (expandedRankingId === rankingId) {
      setExpandedRankingId(null); setExpandedRanking(null)
      return
    }
    setExpandedRankingId(rankingId); setExpandedRanking(null); setRankError(null)
    try {
      const detail = await apiJson<RankingDetail>(`/rankings/${rankingId}`)
      setExpandedRanking(detail)
    } catch (e) {
      setRankError(e instanceof Error ? e.message : String(e))
    }
  }

  if (!job) return <p style={{ color: 'var(--c-text-2)' }}>{error ?? 'Loading…'}</p>

  const card: CSSProperties = {
    background: 'var(--c-surface)', border: '1px solid var(--c-border)',
    borderRadius: 'var(--radius)', padding: 'var(--sp-4)', marginBottom: 'var(--sp-5)'
  }
  const actionBtn: CSSProperties = {
    border: '1px solid var(--c-border)', background: 'var(--c-surface)',
    padding: 'var(--sp-1) var(--sp-3)', borderRadius: 'var(--radius-sm)'
  }

  return (
    <div style={{ maxWidth: 820 }}>
      <p style={{ marginTop: 0 }}><Link to="/">← Jobs</Link></p>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--sp-3)' }}>
        {renaming ? (
          <>
            <input value={newName} onChange={e => setNewName(e.target.value)}
              style={{ fontSize: 'var(--text-xl)', fontWeight: 700, padding: 'var(--sp-1) var(--sp-2)' }} />
            <button onClick={rename} disabled={!newName.trim()}>Save</button>
            <button onClick={() => setRenaming(false)}>Cancel</button>
          </>
        ) : (
          <>
            <h1 style={{ margin: 0 }}>{job.name}</h1>
            <button onClick={() => { setNewName(job.name); setRenaming(true) }}
              style={{ border: 'none', background: 'none', color: 'var(--c-accent)' }}>rename</button>
          </>
        )}
        <button onClick={() => setDeleteOpen(true)}
          style={{
            marginLeft: 'auto', background: 'var(--c-danger)', color: 'var(--c-on-accent)', border: 'none',
            padding: 'var(--sp-1) var(--sp-3)', borderRadius: 'var(--radius-sm)'
          }}>
          Delete job
        </button>
      </div>
      {error && <p style={{ color: 'var(--c-danger)' }}>{error}</p>}

      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontSize: 'var(--text-lg)' }}>Job description</h2>
          {!editingJd && (
            <button onClick={() => { setJdDraft(job.jd ?? ''); setEditingJd(true) }}
              style={{ border: 'none', background: 'none', color: 'var(--c-accent)' }}>
              {job.jd ? 'edit' : 'add JD'}
            </button>
          )}
        </div>
        {editingJd ? (
          <div style={{ marginTop: 'var(--sp-3)' }}>
            <textarea value={jdDraft} onChange={e => setJdDraft(e.target.value)} rows={10}
              style={{ width: '100%', padding: 'var(--sp-2)', border: '1px solid var(--c-border)', borderRadius: 'var(--radius-sm)' }} />
            <button onClick={saveJd} disabled={!jdDraft.trim()}>Save JD</button>{' '}
            <button onClick={() => setEditingJd(false)}>Cancel</button>
          </div>
        ) : job.jd ? (
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 'var(--sp-3) 0 0' }}>{job.jd}</pre>
        ) : (
          <p style={{ color: 'var(--c-text-2)', marginBottom: 0 }}>No JD yet.</p>
        )}
      </div>

      <div style={card}>
        <h2 style={{ margin: '0 0 var(--sp-3)', fontSize: 'var(--text-lg)' }}>Add candidates</h2>
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files) }}
          onClick={() => fileInput.current?.click()}
          style={{
            border: `2px dashed ${dragOver ? 'var(--c-accent)' : 'var(--c-border)'}`,
            borderRadius: 'var(--radius)', padding: 'var(--sp-6)', textAlign: 'center',
            color: 'var(--c-text-2)', cursor: 'pointer', marginBottom: 'var(--sp-3)'
          }}>
          Drop resumes here (PDF / DOCX / TXT / MD), or click to choose files
          <input ref={fileInput} type="file" multiple hidden accept=".pdf,.docx,.txt,.md"
            onChange={e => e.target.files && addFiles(e.target.files)} />
        </div>
        <button onClick={() => setPasteOpen(v => !v)}
          style={{ border: 'none', background: 'none', color: 'var(--c-accent)' }}>
          …or paste resume text
        </button>
        {pasteOpen && (
          <div style={{ marginTop: 'var(--sp-3)' }}>
            <input value={pasteName} onChange={e => setPasteName(e.target.value)} placeholder="Candidate name (required)"
              style={{ display: 'block', width: '100%', padding: 'var(--sp-2)', marginBottom: 'var(--sp-2)',
                       border: '1px solid var(--c-border)', borderRadius: 'var(--radius-sm)' }} />
            <textarea value={pasteText} onChange={e => setPasteText(e.target.value)} rows={8} placeholder="Paste the resume text"
              style={{ display: 'block', width: '100%', padding: 'var(--sp-2)', marginBottom: 'var(--sp-2)',
                       border: '1px solid var(--c-border)', borderRadius: 'var(--radius-sm)' }} />
            <button onClick={addPaste} disabled={!pasteName.trim() || !pasteText.trim()}>Add candidate</button>
          </div>
        )}
      </div>

      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--sp-3)' }}>
          <h2 style={{ margin: 0, fontSize: 'var(--text-lg)' }}>Candidates ({cands.length})</h2>
          <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
            <button disabled={analyseBusy} onClick={analyseAllNew} style={{ ...actionBtn, opacity: analyseBusy ? 0.5 : 1 }}>
              {analyseBusy ? 'Analysing…' : 'Analyse all new'}
            </button>
            <button disabled={rankBusy} onClick={rankNow} style={{ ...actionBtn, opacity: rankBusy ? 0.5 : 1 }}>
              {rankBusy ? 'Ranking…' : 'Rank now'}
            </button>
          </div>
        </div>

        {analyseResult && (
          <p style={{ color: 'var(--c-text-2)', fontSize: 'var(--text-sm)' }}>
            queued {analyseResult.enqueued.length}, skipped {analyseResult.skipped.length}
            {analyseResult.skipped.length > 0 &&
              ` (${analyseResult.skipped.map(s => `${candName(s.candidateId)}: ${s.reason}`).join(' · ')})`}
          </p>
        )}
        {analyseError && <p style={{ color: 'var(--c-danger)', fontSize: 'var(--text-sm)' }}>{analyseError}</p>}
        {rankError && <p style={{ color: 'var(--c-danger)', fontSize: 'var(--text-sm)' }}>{rankError}</p>}

        {cands.length === 0 ? (
          <p style={{ color: 'var(--c-text-2)', margin: 0 }}>None yet — drop some resumes above.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {cands.map(c => (
              <div key={c.id} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: 'var(--sp-3) 0', borderTop: '1px solid var(--c-border)'
              }}>
                <Link to={`/candidates/${c.id}`} style={{ textDecoration: 'none', color: 'inherit', flex: 1 }}>
                  {c.name}
                </Link>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
                  <StatusBadge status={c.status} />
                  <AnalysisCell state={analysisStateFor(c.id, analyses)} onRetry={retryTask} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={card}>
        <h2 style={{ margin: '0 0 var(--sp-3)', fontSize: 'var(--text-lg)' }}>Rankings</h2>
        {rankResult && rankResult.excluded.length > 0 && (
          <p style={{ color: 'var(--c-text-2)', fontSize: 'var(--text-sm)' }}>
            Ranked {rankResult.items.length}. Excluded (no analysis): {rankResult.excluded.map(e => candNameOrHash(e.candidateId)).join(', ')}
          </p>
        )}
        {rankings.length === 0 ? (
          <p style={{ color: 'var(--c-text-2)', margin: 0 }}>No rankings yet — click "Rank now" once some candidates are analysed.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {rankings.map(r => (
              <div key={r.id} style={{ borderTop: '1px solid var(--c-border)' }}>
                <button onClick={() => toggleRanking(r.id)} style={{
                  display: 'flex', width: '100%', justifyContent: 'space-between',
                  border: 'none', background: 'none', textAlign: 'left', padding: 'var(--sp-3) 0'
                }}>
                  <span>#{r.id} · {r.createdAt.slice(0, 10)} · {r.candidateCount} candidates</span>
                  <span style={{ color: 'var(--c-accent)' }}>{expandedRankingId === r.id ? 'hide' : 'view'}</span>
                </button>
                {expandedRankingId === r.id && expandedRanking && expandedRanking.id === r.id && (
                  <div style={{ paddingBottom: 'var(--sp-3)' }}>
                    {expandedRanking.reason && (
                      <p style={{ color: 'var(--c-text-2)', fontSize: 'var(--text-sm)', margin: '0 0 var(--sp-2)' }}>
                        {expandedRanking.reason}
                      </p>
                    )}
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ textAlign: 'left', color: 'var(--c-text-2)', fontSize: 'var(--text-sm)' }}>
                          <th style={{ padding: 'var(--sp-1) var(--sp-2)' }}>Rank</th>
                          <th style={{ padding: 'var(--sp-1) var(--sp-2)' }}>Name</th>
                          <th style={{ padding: 'var(--sp-1) var(--sp-2)' }}>Score</th>
                          <th style={{ padding: 'var(--sp-1) var(--sp-2)' }}>Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {expandedRanking.items.map(it => {
                          const pc = expandedRanking.criteria.per_candidate?.find(p => p.candidate_id === it.candidateId)
                          return (
                            <tr key={it.candidateId} style={{ borderTop: '1px solid var(--c-border)' }}>
                              <td style={{ padding: 'var(--sp-2)' }}>{it.rank}</td>
                              <td style={{ padding: 'var(--sp-2)' }}>
                                <Link to={`/candidates/${it.candidateId}`}>{it.candidateName}</Link>
                                {pc?.interview_analysis_id !== undefined && (
                                  <span style={{ marginLeft: 'var(--sp-2)' }}>
                                    <StatusBadge status="incl_interview" tone="accent" label="incl. interview" />
                                  </span>
                                )}
                              </td>
                              <td style={{ padding: 'var(--sp-2)' }}>{it.score}</td>
                              <td style={{ padding: 'var(--sp-2)', color: 'var(--c-text-2)' }}>{it.reason}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                    <p style={{ color: 'var(--c-text-2)', fontSize: 'var(--text-sm)', marginBottom: 0 }}>
                      factors: {expandedRanking.criteria.factors.map(f => `${f.key.replaceAll('_', ' ')} ${f.base_weight.toFixed(2)}`).join(', ')}
                      {' · '}excluded: {expandedRanking.criteria.excluded.join(', ') || 'none'}
                      {(() => {
                        const perCandidate = expandedRanking.criteria.per_candidate ?? []
                        const distinctFactorSets = new Set(perCandidate.map(p => [...p.factors].sort().join('|')))
                        return distinctFactorSets.size > 1
                          ? ' · per-candidate factors (interview participation varies by candidate)'
                          : null
                      })()}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={card}>
        <h2 style={{ margin: '0 0 var(--sp-3)', fontSize: 'var(--text-lg)' }}>Memory</h2>
        {memoryError && <p style={{ color: 'var(--c-danger)', fontSize: 'var(--text-sm)' }}>{memoryError}</p>}

        {memory && memory.events.some(ev => ev.status === 'pending') && (
          <div style={{ marginBottom: 'var(--sp-4)' }}>
            <h3 style={{ fontSize: 'var(--text-md)', margin: '0 0 var(--sp-2)' }}>Pending proposals</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
              {memory.events.filter(ev => ev.status === 'pending').map(ev => (
                <div key={ev.id} style={{ border: '1px solid var(--c-border)', borderRadius: 'var(--radius-sm)', padding: 'var(--sp-3)' }}>
                  <p style={{ margin: '0 0 var(--sp-2)' }}>{ev.lesson}</p>
                  <ul style={{ margin: '0 0 var(--sp-2)', paddingLeft: 'var(--sp-5)', color: 'var(--c-text-2)', fontSize: 'var(--text-sm)' }}>
                    {ev.evidence.map((e, i) => <li key={i}>“{e.quote}” [{e.source}]</li>)}
                  </ul>
                  <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
                    <button disabled={!!proposalBusy[ev.id]} onClick={() => decideMemoryEvent(ev.id, 'approve')} style={actionBtn}>Approve</button>
                    <button disabled={!!proposalBusy[ev.id]} onClick={() => decideMemoryEvent(ev.id, 'reject')} style={actionBtn}>Reject</button>
                  </div>
                  {proposalError[ev.id] && <p style={{ color: 'var(--c-danger)', fontSize: 'var(--text-sm)', margin: 'var(--sp-2) 0 0' }}>{proposalError[ev.id]}</p>}
                </div>
              ))}
            </div>
          </div>
        )}

        <h3 style={{ fontSize: 'var(--text-md)', margin: '0 0 var(--sp-2)' }}>learned_skills.md</h3>
        {memory && memory.learnedSkills.trim() ? (
          <pre style={{
            whiteSpace: 'pre-wrap', fontFamily: 'inherit', background: 'var(--c-bg)',
            border: '1px solid var(--c-border)', borderRadius: 'var(--radius-sm)',
            padding: 'var(--sp-3)', margin: '0 0 var(--sp-4)'
          }}>
            {memory.learnedSkills}
          </pre>
        ) : (
          <p style={{ color: 'var(--c-text-2)', margin: '0 0 var(--sp-4)' }}>
            empty — approve proposals after interviews to build this job's memory
          </p>
        )}

        <h3 style={{ fontSize: 'var(--text-md)', margin: '0 0 var(--sp-2)' }}>Event history</h3>
        {!memory || memory.events.length === 0 ? (
          <p style={{ color: 'var(--c-text-2)', margin: 0 }}>No memory events yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {memory.events.map(ev => (
              <div key={ev.id} style={{ padding: 'var(--sp-3) 0', borderTop: '1px solid var(--c-border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--sp-2)' }}>
                  <span>{ev.lesson || `event #${ev.id}`}</span>
                  <StatusBadge status={ev.status} tone={MEMORY_STATUS_TONE[ev.status]} />
                </div>
                <p style={{ color: 'var(--c-text-2)', fontSize: 'var(--text-sm)', margin: 'var(--sp-1) 0 0' }}>
                  {ev.createdAt.slice(0, 10)}
                  {ev.sourceInterviewId !== null && ` · interview #${ev.sourceInterviewId}`}
                </p>
                {ev.status === 'refused' && ev.refusalReason && (
                  <p style={{
                    color: 'var(--c-warn-text)', background: 'var(--c-warn-bg)', padding: 'var(--sp-2) var(--sp-3)',
                    borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-sm)', margin: 'var(--sp-2) 0 0'
                  }}>
                    {ev.refusalReason}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {deleteOpen && (
        <ConfirmDeleteModal
          title="Delete this job?"
          expectedName={job.name}
          nameLabel="job name"
          description="Removes the job, all its candidates, and all its ranking history. This cannot be undone."
          onConfirm={async () => {
            await apiJson(`/jobs/${jobId}`, { method: 'DELETE' })
            navigate('/')
          }}
          onClose={() => setDeleteOpen(false)}
        />
      )}
    </div>
  )
}
