import type { DB } from '../db'
import { ValidationError } from '../errors'
import { CATALOG, DEFAULT_SELECTION, type Provider } from './catalog'
import { getPlan } from './subscription'

export interface AiSelection { provider: Provider; model: string }

export function getAiSettings(db: DB): AiSelection {
  const get = db.prepare('SELECT value FROM settings WHERE key = ?')
  const provider = (get.get('ai.provider') as { value: string } | undefined)?.value as Provider | undefined
  const model = (get.get('ai.model') as { value: string } | undefined)?.value
  if (!provider || !model) return { ...DEFAULT_SELECTION }
  return { provider, model }
}

export function setAiSettings(db: DB, sel: AiSelection): void {
  const models = CATALOG[sel.provider]
  const entry = models?.find(m => m.id === sel.model)
  if (!entry) throw new ValidationError(`model "${sel.model}" is not in the ${sel.provider} catalog`)
  if (!entry.tiers.includes(getPlan().tier)) {
    throw new ValidationError(`model "${sel.model}" is not available on the ${getPlan().label} plan`)
  }
  const put = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')"
  )
  db.transaction(() => {
    put.run('ai.provider', sel.provider)
    put.run('ai.model', sel.model)
  })()
}
