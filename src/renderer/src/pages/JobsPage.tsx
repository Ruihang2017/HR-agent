import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiJson } from '../api'

interface JobSummary { id: number; name: string; candidateCount: number; createdAt: string }

export default function JobsPage() {
  const [jobs, setJobs] = useState<JobSummary[] | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [jd, setJd] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(() => {
    apiJson<JobSummary[]>('/jobs').then(setJobs).catch(e => setError(e.message))
  }, [])
  useEffect(refresh, [refresh])

  async function create() {
    setBusy(true); setError(null)
    try {
      await apiJson('/jobs', { method: 'POST', body: JSON.stringify({ name, jd: jd || undefined }) })
      setName(''); setJd(''); setShowForm(false); refresh()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h1 style={{ marginTop: 0 }}>Jobs</h1>
        <button onClick={() => setShowForm(v => !v)} style={{
          background: 'var(--c-accent)', color: 'var(--c-on-accent)', border: 'none',
          padding: 'var(--sp-2) var(--sp-4)', borderRadius: 'var(--radius-sm)'
        }}>New job</button>
      </div>

      {error && <p style={{ color: 'var(--c-danger)' }}>{error}</p>}

      {showForm && (
        <div style={{
          background: 'var(--c-surface)', border: '1px solid var(--c-border)',
          borderRadius: 'var(--radius)', padding: 'var(--sp-4)', marginBottom: 'var(--sp-5)'
        }}>
          <label style={{ display: 'block', fontWeight: 600, marginBottom: 'var(--sp-3)' }}>
            Job name
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Sales Manager / 销售经理"
              style={{ display: 'block', width: '100%', marginTop: 4, padding: 'var(--sp-2)',
                       border: '1px solid var(--c-border)', borderRadius: 'var(--radius-sm)' }} />
          </label>
          <label style={{ display: 'block', fontWeight: 600, marginBottom: 'var(--sp-3)' }}>
            Job description (optional — you can add it later)
            <textarea value={jd} onChange={e => setJd(e.target.value)} rows={6}
              style={{ display: 'block', width: '100%', marginTop: 4, padding: 'var(--sp-2)',
                       border: '1px solid var(--c-border)', borderRadius: 'var(--radius-sm)' }} />
          </label>
          <button disabled={busy || !name.trim()} onClick={create} style={{
            background: 'var(--c-accent)', color: 'var(--c-on-accent)', border: 'none',
            padding: 'var(--sp-2) var(--sp-4)', borderRadius: 'var(--radius-sm)', opacity: busy || !name.trim() ? 0.5 : 1
          }}>{busy ? 'Creating…' : 'Create job'}</button>
        </div>
      )}

      {jobs === null ? <p style={{ color: 'var(--c-text-2)' }}>Loading…</p> :
        jobs.length === 0 ? (
          <p style={{ color: 'var(--c-text-2)' }}>No jobs yet — create your first one to start hiring.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
            {jobs.map(j => (
              <Link key={j.id} to={`/jobs/${j.id}`} style={{
                display: 'flex', justifyContent: 'space-between', textDecoration: 'none', color: 'inherit',
                background: 'var(--c-surface)', border: '1px solid var(--c-border)',
                borderRadius: 'var(--radius)', padding: 'var(--sp-4)'
              }}>
                <strong>{j.name}</strong>
                <span style={{ color: 'var(--c-text-2)' }}>
                  {j.candidateCount} candidate{j.candidateCount === 1 ? '' : 's'}
                </span>
              </Link>
            ))}
          </div>
        )}
    </div>
  )
}
