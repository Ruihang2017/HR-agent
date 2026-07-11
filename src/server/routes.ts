import type { Hono } from 'hono'
import type { JobsDeps } from './jobs'
import * as jobs from './jobs'
import * as candidates from './candidates'
import { extractText, extOf } from './extract'
import { ConflictError, NotFoundError, ValidationError } from './errors'
import { GatewayError } from './ai/gateway'

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024 // spec section 3: 20 MB → 413

export function registerJobRoutes(app: Hono, deps: JobsDeps): void {
  app.onError((err, c) => {
    if (err instanceof ValidationError) return c.json({ error: err.message }, 400)
    if (err instanceof NotFoundError) return c.json({ error: err.message }, 404)
    if (err instanceof ConflictError) return c.json({ error: err.message }, 409)
    // Direct (non-queued) gateway calls - interview AI pipelines - must not become opaque 500s;
    // the queue already absorbs GatewayErrors for analysis tasks (Phase 2), so this only fires
    // for interview routes (design spec section 8).
    if (err instanceof GatewayError) return c.json({ error: err.message, code: err.code }, 502)
    console.error(err)
    return c.json({ error: 'internal error' }, 500)
  })

  app.post('/jobs', async c => {
    const body = (await c.req.json()) as { name?: string; jd?: string }
    return c.json(jobs.createJob(deps, body.name ?? '', body.jd), 201)
  })

  app.get('/jobs', c => c.json(jobs.listJobs(deps)))

  app.get('/jobs/:id', c => c.json(jobs.getJob(deps, Number(c.req.param('id')))))

  app.patch('/jobs/:id', async c => {
    const body = (await c.req.json()) as { name?: string }
    return c.json(jobs.renameJob(deps, Number(c.req.param('id')), body.name ?? ''))
  })

  app.put('/jobs/:id/jd', async c => {
    const id = Number(c.req.param('id'))
    const ct = c.req.header('content-type') ?? ''
    if (ct.includes('multipart/form-data')) {
      const body = await c.req.parseBody()
      const file = body['file']
      if (!(file instanceof File)) throw new ValidationError('a file field is required')
      if (file.size > MAX_UPLOAD_BYTES) return c.json({ error: 'file too large (max 20 MB)' }, 413)
      const result = await extractText(new Uint8Array(await file.arrayBuffer()), extOf(file.name))
      if ('error' in result) return c.json({ error: result.error }, 422)
      return c.json({ jd: jobs.setJd(deps, id, result.text) })
    }
    const body = (await c.req.json()) as { text?: string }
    if (typeof body.text !== 'string' || body.text.trim() === '') {
      throw new ValidationError('jd text is required')
    }
    return c.json({ jd: jobs.setJd(deps, id, body.text) })
  })

  app.post('/jobs/:id/candidates', async c => {
    const jobId = Number(c.req.param('id'))
    const ct = c.req.header('content-type') ?? ''
    if (ct.includes('multipart/form-data')) {
      const body = await c.req.parseBody()
      const file = body['file']
      if (!(file instanceof File)) throw new ValidationError('a file field is required')
      if (file.size > MAX_UPLOAD_BYTES) return c.json({ error: 'file too large (max 20 MB)' }, 413)
      const name = typeof body['name'] === 'string' ? (body['name'] as string) : undefined
      const detail = await candidates.addCandidateFromFile(
        deps, jobId, file.name, new Uint8Array(await file.arrayBuffer()), name
      )
      return c.json(detail, 201)
    }
    const body = (await c.req.json()) as { name?: string; text?: string }
    const detail = await candidates.addCandidateFromText(deps, jobId, body.name ?? '', body.text ?? '')
    return c.json(detail, 201)
  })

  app.get('/jobs/:id/candidates', c =>
    c.json(candidates.listCandidates(deps, Number(c.req.param('id'))))
  )

  app.get('/candidates/:id', c => c.json(candidates.getCandidate(deps, Number(c.req.param('id')))))
}
