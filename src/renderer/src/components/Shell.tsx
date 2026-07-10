import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { apiJson } from '../api'

interface Health { status: string; schemaVersion: number; dataDir: string }

export default function Shell() {
  const [health, setHealth] = useState<Health | null>(null)
  useEffect(() => {
    let cancelled = false
    let timer: number | undefined
    async function tick() {
      try {
        const h = await apiJson<Health>('/health')
        if (!cancelled) setHealth(h)
      } catch {
        if (!cancelled) setHealth(null)
      }
      if (!cancelled) timer = window.setTimeout(tick, 5000)
    }
    tick()
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [])

  const ok = health?.status === 'ok'
  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <aside style={{
        width: 220, flexShrink: 0, background: 'var(--c-sidebar-bg)', color: 'var(--c-sidebar-text)',
        display: 'flex', flexDirection: 'column', padding: 'var(--sp-4)'
      }}>
        <div style={{ fontSize: 'var(--text-lg)', fontWeight: 700, marginBottom: 'var(--sp-6)' }}>Jobpin</div>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)' }}>
          <NavLink to="/" end style={({ isActive }) => ({
            padding: 'var(--sp-2) var(--sp-3)', borderRadius: 'var(--radius-sm)', textDecoration: 'none',
            color: isActive ? '#fff' : 'var(--c-sidebar-text)',
            background: isActive ? 'rgba(255,255,255,0.12)' : 'transparent'
          })}>Jobs</NavLink>
          <NavLink to="/settings" style={({ isActive }) => ({
            padding: 'var(--sp-2) var(--sp-3)', borderRadius: 'var(--radius-sm)', textDecoration: 'none',
            color: isActive ? '#fff' : 'var(--c-sidebar-text)',
            background: isActive ? 'rgba(255,255,255,0.12)' : 'transparent'
          })}>Settings</NavLink>
        </nav>
        <div style={{ marginTop: 'auto', fontSize: 'var(--text-xs)', color: 'var(--c-sidebar-muted)' }}>
          <NavLink to="/system" style={{ color: 'inherit', textDecoration: 'none' }}>
            <span style={{ color: ok ? 'var(--c-ok)' : 'var(--c-danger)' }}>●</span>{' '}
            {ok ? 'local server running' : 'server unavailable'}
          </NavLink>
          {health && (
            <div style={{ marginTop: 'var(--sp-2)', cursor: 'pointer' }}
                 onClick={() => window.jobpin.openPath('')}
                 title={health.dataDir}>
              📁 your data folder
            </div>
          )}
        </div>
      </aside>
      <main style={{ flex: 1, overflow: 'auto', padding: 'var(--sp-6)' }}>
        <Outlet />
      </main>
    </div>
  )
}
