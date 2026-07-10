import { useEffect, useState } from 'react'

interface Health {
  status: string
  schemaVersion: number
  dataDir: string
  uptimeSeconds: number
}

interface AppInfo {
  version: string
  dataDir: string
}

export default function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<AppInfo | null>(null)

  useEffect(() => {
    let timer: number | undefined
    let cancelled = false

    async function tick() {
      try {
        const port = await window.jobpin.getServerPort()
        const res = await fetch(`http://127.0.0.1:${port}/health`)
        if (!res.ok) throw new Error(`health returned ${res.status}`)
        const body = (await res.json()) as Health
        if (!cancelled) {
          setHealth(body)
          setError(null)
        }
      } catch (e) {
        if (!cancelled) {
          setHealth(null)
          setError(e instanceof Error ? e.message : String(e))
        }
      }
      if (!cancelled) timer = window.setTimeout(tick, 3000)
    }

    window.jobpin.getAppInfo().then(setInfo)
    tick()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [])

  const ok = health?.status === 'ok'
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24, lineHeight: 1.7 }}>
      <h1 style={{ margin: 0 }}>Jobpin</h1>
      <p style={{ color: '#666', marginTop: 0 }}>
        Local hiring workbench{info ? ` — v${info.version}` : ''}
      </p>
      <p>
        Local server:{' '}
        <strong style={{ color: ok ? 'green' : 'crimson' }}>
          {ok ? 'running' : error ? `unavailable (${error})` : 'checking…'}
        </strong>
      </p>
      {health && <p>Database schema: v{health.schemaVersion}</p>}
      {info && (
        <p>
          Your data: <code>{info.dataDir}</code>{' '}
          <button onClick={() => window.jobpin.openDataFolder()}>Open folder</button>
        </p>
      )}
    </main>
  )
}
