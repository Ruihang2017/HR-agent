import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { getSchemaVersion, type DB } from './db'
import type { JobpinPaths } from './paths'
import { registerJobRoutes } from './routes'
import type { AiRuntime } from './ai/runtime'
import { registerAiRoutes } from './ai/routes'
import { registerInterviewRoutes } from './ai/interview-routes'

export interface AppDeps {
  db: DB
  paths: JobpinPaths
  version: string
  ai?: AiRuntime
}

/**
 * The local API. CORS is open because the renderer runs on a different
 * origin (file:// packaged, http://localhost:5173 in dev) and the server
 * itself only ever binds 127.0.0.1.
 */
export function createApp({ db, paths, version, ai }: AppDeps): Hono {
  const startedAt = Date.now()
  const app = new Hono()
  app.use('*', cors())

  app.get('/health', c =>
    c.json({
      status: 'ok',
      schemaVersion: getSchemaVersion(db),
      dataDir: paths.dataRoot,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000)
    })
  )

  app.get('/version', c => c.json({ app: 'jobpin', version }))

  registerJobRoutes(app, { db, paths })
  if (ai) {
    registerAiRoutes(app, { db, paths, queue: ai.queue })
    registerInterviewRoutes(app, { db, paths, gateway: ai.gateway })
  }
  return app
}
