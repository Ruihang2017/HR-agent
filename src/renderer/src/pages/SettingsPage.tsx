import { useCallback, useEffect, useState } from 'react'
import { apiJson } from '../api'

type Provider = 'openai' | 'deepseek' | 'anthropic'

interface CatalogModel { id: string; label: string }
interface CatalogProvider { provider: Provider; disclosure: string; models: CatalogModel[] }
interface CatalogResp { plan: { label: string; tier: string; monthlyTokens: number }; providers: CatalogProvider[] }
interface Selection { provider: Provider; model: string }
interface Usage { plan: string; allowanceTokens: number; usedTokens: number }

const PROVIDER_LABELS: Record<Provider, string> = {
  openai: 'OpenAI',
  deepseek: 'DeepSeek',
  anthropic: 'Anthropic'
}

export default function SettingsPage() {
  const [catalog, setCatalog] = useState<CatalogResp | null>(null)
  const [current, setCurrent] = useState<Selection | null>(null)
  const [usage, setUsage] = useState<Usage | null>(null)
  const [pending, setPending] = useState<Selection | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    const [cat, sel, use] = await Promise.all([
      apiJson<CatalogResp>('/ai/catalog'),
      apiJson<Selection>('/ai/settings'),
      apiJson<Usage>('/ai/usage')
    ])
    setCatalog(cat); setCurrent(sel); setUsage(use)
  }, [])
  useEffect(() => {
    void refresh().catch(e => setError(e instanceof Error ? e.message : String(e)))
  }, [refresh])

  function selectModel(provider: Provider, model: string) {
    if (current && current.provider === provider && current.model === model) {
      setPending(null)
      return
    }
    setError(null)
    setPending({ provider, model })
  }

  async function confirmSwitch() {
    if (!pending) return
    setBusy(true); setError(null)
    try {
      await apiJson('/ai/settings', { method: 'PUT', body: JSON.stringify(pending) })
      setPending(null)
      await refresh()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  if (!catalog || !current || !usage) {
    return <p style={{ color: error ? 'var(--c-danger)' : 'var(--c-text-2)' }}>{error ?? 'Loading…'}</p>
  }

  const usagePct = usage.allowanceTokens > 0
    ? Math.min(100, (usage.usedTokens / usage.allowanceTokens) * 100)
    : 0

  const card = {
    background: 'var(--c-surface)', border: '1px solid var(--c-border)',
    borderRadius: 'var(--radius)', padding: 'var(--sp-4)', marginBottom: 'var(--sp-5)'
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <h1 style={{ marginTop: 0 }}>Settings</h1>

      {error && <p style={{ color: 'var(--c-danger)' }}>{error}</p>}

      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', marginBottom: 'var(--sp-3)' }}>
          <h2 style={{ margin: 0, fontSize: 'var(--text-lg)' }}>{catalog.plan.label}</h2>
          <span style={{
            fontSize: 'var(--text-xs)', fontWeight: 600, padding: '2px 8px', borderRadius: 999,
            background: 'var(--c-accent-soft)', color: 'var(--c-accent)'
          }}>{catalog.plan.tier}</span>
        </div>
        <div style={{
          background: 'var(--c-warn-bg)', color: 'var(--c-warn-text)',
          padding: 'var(--sp-3) var(--sp-4)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-sm)'
        }}>
          DEV MODE — vendor subscription service not yet built; usage is advisory.
        </div>
      </div>

      <div style={card}>
        <h2 style={{ margin: '0 0 var(--sp-3)', fontSize: 'var(--text-lg)' }}>Usage</h2>
        <div style={{
          background: 'var(--c-bg)', border: '1px solid var(--c-border)',
          borderRadius: 'var(--radius-sm)', height: 12, overflow: 'hidden'
        }}>
          <div style={{ width: `${usagePct}%`, height: '100%', background: 'var(--c-accent)' }} />
        </div>
        <p style={{ color: 'var(--c-text-2)', margin: 'var(--sp-2) 0 0', fontSize: 'var(--text-sm)' }}>
          {usage.usedTokens.toLocaleString()} of {usage.allowanceTokens.toLocaleString()} tokens this month (advisory)
        </p>
      </div>

      <div style={card}>
        <h2 style={{ margin: '0 0 var(--sp-3)', fontSize: 'var(--text-lg)' }}>Model</h2>
        {catalog.providers.map(p => (
          <div key={p.provider} style={{ marginBottom: 'var(--sp-5)' }}>
            <h3 style={{ margin: '0 0 var(--sp-2)', fontSize: 'var(--text-md)' }}>
              {PROVIDER_LABELS[p.provider] ?? p.provider}
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
              {p.models.map(m => {
                const isCurrent = current.provider === p.provider && current.model === m.id
                const isPending = pending?.provider === p.provider && pending?.model === m.id
                const checked = pending ? isPending : isCurrent
                return (
                  <label key={m.id} style={{
                    display: 'flex', alignItems: 'center', gap: 'var(--sp-3)',
                    padding: 'var(--sp-2) var(--sp-3)', borderRadius: 'var(--radius-sm)',
                    border: `1px solid ${isCurrent ? 'var(--c-accent)' : 'var(--c-border)'}`,
                    cursor: 'pointer'
                  }}>
                    <input
                      type="radio"
                      name="ai-model"
                      checked={checked}
                      onChange={() => selectModel(p.provider, m.id)}
                    />
                    <span style={{ display: 'flex', flexDirection: 'column' }}>
                      <span>{m.label}</span>
                      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--c-text-2)' }}>{m.id}</span>
                    </span>
                  </label>
                )
              })}
            </div>

            {pending && pending.provider === p.provider && (
              <div style={{
                marginTop: 'var(--sp-3)', background: 'var(--c-warn-bg)', color: 'var(--c-warn-text)',
                padding: 'var(--sp-3) var(--sp-4)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-sm)'
              }}>
                <p style={{ margin: '0 0 var(--sp-3)' }}>{p.disclosure}</p>
                <button disabled={busy} onClick={confirmSwitch} style={{
                  background: 'var(--c-accent)', color: 'var(--c-on-accent)', border: 'none',
                  padding: 'var(--sp-2) var(--sp-4)', borderRadius: 'var(--radius-sm)', opacity: busy ? 0.5 : 1
                }}>{busy ? 'Switching…' : 'Confirm switch'}</button>{' '}
                <button disabled={busy} onClick={() => setPending(null)} style={{
                  border: 'none', background: 'none', color: 'var(--c-warn-text)', textDecoration: 'underline'
                }}>Cancel</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
