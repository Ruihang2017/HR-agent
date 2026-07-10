export type Tone = 'accent' | 'warn' | 'danger' | 'ok'

const TONES: Record<Tone, { bg: string; fg: string }> = {
  accent: { bg: 'var(--c-accent-soft)', fg: 'var(--c-accent)' },
  warn: { bg: 'var(--c-warn-bg)', fg: 'var(--c-warn-text)' },
  danger: { bg: 'var(--c-warn-bg)', fg: 'var(--c-danger)' },
  ok: { bg: 'var(--c-accent-soft)', fg: 'var(--c-ok)' }
}

export default function StatusBadge({ status, tone, label }: { status: string; tone?: Tone; label?: string }) {
  const needsReview = status === 'needs_review'
  const { bg, fg } = TONES[tone ?? (needsReview ? 'warn' : 'accent')]
  return (
    <span style={{
      fontSize: 'var(--text-xs)', fontWeight: 600, padding: '2px 8px', borderRadius: 999,
      background: bg, color: fg
    }}>
      {label ?? (needsReview ? 'needs review' : status)}
    </span>
  )
}
