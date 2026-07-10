export default function StatusBadge({ status }: { status: string }) {
  const needsReview = status === 'needs_review'
  return (
    <span style={{
      fontSize: 'var(--text-xs)', fontWeight: 600, padding: '2px 8px', borderRadius: 999,
      background: needsReview ? 'var(--c-warn-bg)' : '#e8f0fe',
      color: needsReview ? 'var(--c-warn-text)' : 'var(--c-accent)'
    }}>
      {needsReview ? 'needs review' : status}
    </span>
  )
}
