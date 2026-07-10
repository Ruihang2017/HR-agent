import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { apiJson } from '../api'
import StatusBadge from '../components/StatusBadge'

interface CandidateDetail {
  id: number; jobId: number; name: string; email: string | null; phone: string | null
  status: string; extractedText: string | null
  extraction: { status: 'ok' | 'failed'; error?: string }
  originalFilename?: string; folderPath: string; createdAt: string
}

export default function CandidatePage() {
  const { id } = useParams()
  const [c, setC] = useState<CandidateDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    apiJson<CandidateDetail>(`/candidates/${Number(id)}`).then(setC).catch(e => setError(e.message))
  }, [id])

  if (!c) return <p style={{ color: 'var(--c-text-2)' }}>{error ?? 'Loading…'}</p>

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
