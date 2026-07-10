import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { Link, useParams } from 'react-router-dom'
import { apiJson, apiUpload } from '../api'
import StatusBadge from '../components/StatusBadge'

interface JobDetail { id: number; name: string; folderPath: string; jd: string | null; createdAt: string }
interface CandidateSummary { id: number; name: string; status: string; createdAt: string }

export default function JobDetailPage() {
  const { id } = useParams()
  const jobId = Number(id)
  const [job, setJob] = useState<JobDetail | null>(null)
  const [cands, setCands] = useState<CandidateSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [newName, setNewName] = useState('')
  const [editingJd, setEditingJd] = useState(false)
  const [jdDraft, setJdDraft] = useState('')
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteName, setPasteName] = useState('')
  const [pasteText, setPasteText] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const refresh = useCallback(() => {
    apiJson<JobDetail>(`/jobs/${jobId}`).then(setJob).catch(e => setError(e.message))
    apiJson<CandidateSummary[]>(`/jobs/${jobId}/candidates`).then(setCands).catch(() => {})
  }, [jobId])
  useEffect(refresh, [refresh])

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

  if (!job) return <p style={{ color: 'var(--c-text-2)' }}>{error ?? 'Loading…'}</p>

  const card: CSSProperties = {
    background: 'var(--c-surface)', border: '1px solid var(--c-border)',
    borderRadius: 'var(--radius)', padding: 'var(--sp-4)', marginBottom: 'var(--sp-5)'
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
        <h2 style={{ margin: '0 0 var(--sp-3)', fontSize: 'var(--text-lg)' }}>Candidates ({cands.length})</h2>
        {cands.length === 0 ? (
          <p style={{ color: 'var(--c-text-2)', margin: 0 }}>None yet — drop some resumes above.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {cands.map(c => (
              <Link key={c.id} to={`/candidates/${c.id}`} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: 'var(--sp-3) 0', borderTop: '1px solid var(--c-border)',
                textDecoration: 'none', color: 'inherit'
              }}>
                <span>{c.name}</span>
                <StatusBadge status={c.status} />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
