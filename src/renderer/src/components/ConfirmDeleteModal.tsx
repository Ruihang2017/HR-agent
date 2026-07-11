import { useState, type ReactNode } from 'react'

export interface ConfirmDeleteModalProps {
  /** Modal heading, e.g. "Delete this job?" */
  title: string
  /** The exact string the boss must type — the job's or candidate's current name. */
  expectedName: string
  /** What the typed name refers to, e.g. "job name" / "candidate name". */
  nameLabel: string
  /** Explains exactly what gets removed vs. kept (PRD D-17 semantics). */
  description: ReactNode
  /** Performs the DELETE call; a thrown Error's message is shown inline. */
  onConfirm: () => Promise<void>
  onClose: () => void
}

/**
 * Shared typed-confirmation delete dialog (Phase 5 / D-17) for JobDetailPage and CandidatePage.
 * Deletion here is either an outright cascade (job) or an anonymisation (candidate) — both are
 * effectively irreversible from the UI's point of view, so the boss must type the exact current
 * name before the danger-styled button enables at all.
 */
export default function ConfirmDeleteModal({
  title, expectedName, nameLabel, description, onConfirm, onClose
}: ConfirmDeleteModalProps) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const matches = typed.trim().length > 0 && typed === expectedName

  async function confirm() {
    if (!matches) return
    setBusy(true); setError(null)
    try {
      await onConfirm()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
      }}
      onClick={() => !busy && onClose()}
    >
      <div
        style={{
          background: 'var(--c-surface)', border: '1px solid var(--c-border)', borderRadius: 'var(--radius)',
          padding: 'var(--sp-5)', maxWidth: 480, width: '90%'
        }}
        onClick={e => e.stopPropagation()}
      >
        <h2 style={{ margin: '0 0 var(--sp-3)', fontSize: 'var(--text-lg)', color: 'var(--c-danger)' }}>{title}</h2>
        <div style={{ margin: '0 0 var(--sp-4)', color: 'var(--c-text-2)', fontSize: 'var(--text-sm)' }}>
          {description}
        </div>

        <label style={{ display: 'block', fontSize: 'var(--text-sm)', color: 'var(--c-text-2)', marginBottom: 'var(--sp-1)' }}>
          Type the {nameLabel} <strong>{expectedName}</strong> to confirm
        </label>
        <input
          value={typed}
          onChange={e => setTyped(e.target.value)}
          autoFocus
          disabled={busy}
          style={{
            border: '1px solid var(--c-border)', borderRadius: 'var(--radius-sm)', padding: 'var(--sp-2)',
            width: '100%', background: 'var(--c-surface)', color: 'var(--c-text)', marginBottom: 'var(--sp-3)'
          }}
        />

        {error && <p style={{ color: 'var(--c-danger)', fontSize: 'var(--text-sm)', margin: '0 0 var(--sp-3)' }}>{error}</p>}

        <div style={{ display: 'flex', gap: 'var(--sp-3)' }}>
          <button
            disabled={!matches || busy}
            onClick={confirm}
            style={{
              background: 'var(--c-danger)', color: 'var(--c-on-accent)', border: 'none',
              padding: 'var(--sp-2) var(--sp-4)', borderRadius: 'var(--radius-sm)',
              opacity: !matches || busy ? 0.5 : 1
            }}
          >
            {busy ? 'Deleting…' : 'Delete'}
          </button>
          <button
            disabled={busy}
            onClick={onClose}
            style={{ border: 'none', background: 'none', color: 'var(--c-text-2)', textDecoration: 'underline' }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
