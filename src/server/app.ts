import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { getSchemaVersion, type DB } from './db'

export interface AppDeps {
  db: DB
  dataRoot: string
  version: string
}

/**
 * The local API. CORS is open because the renderer runs on a different
 * origin (file:// packaged, http://localhost:5173 in dev) and the server
 * itself only ever binds 127.0.0.1 (spec section 3).
 */
export function createApp({ db, dataRoot, version }: AppDeps): Hono {
  const startedAt = Date.now()
  const app = new Hono()
  app.use('*', cors())

  app.get('/health', c =>
    c.json({
      status: 'ok',
      schemaVersion: getSchemaVersion(db),
      dataDir: dataRoot,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000)
    })
  )

  app.get('/version', c => c.json({ app: 'jobpin', version }))

  return app
}
