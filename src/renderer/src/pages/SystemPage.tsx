import { useEffect, useState } from 'react'
import { apiJson } from '../api'

interface Health { status: string; schemaVersion: number; dataDir: string; uptimeSeconds: number }
interface AppInfo { version: string; dataDir: string }

export default function SystemPage() {
  const [health, setHealth] = useState<Health | null>(null)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.jobpin.getAppInfo().then(setInfo)
    apiJson<Health>('/health').then(setHealth).catch(e => setError(e.message))
  }, [])

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>System</h1>
      {info && <p>Jobpin v{info.version}</p>}
      <p>Local server: <strong style={{ color: health ? 'var(--c-ok)' : 'var(--c-danger)' }}>
        {health ? 'running' : error ?? 'checking…'}</strong></p>
      {health && <p>Database schema: v{health.schemaVersion} · uptime {health.uptimeSeconds}s</p>}
      {info && (
        <p>Your data: <code>{info.dataDir}</code>{' '}
          <button onClick={() => window.jobpin.openPath('')}>Open folder</button></p>
      )}
    </div>
  )
}
