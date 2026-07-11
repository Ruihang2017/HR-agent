import type { Hono } from 'hono'
import { parseJsonBody } from './http'
import * as emails from './emails'
import type { EmailDeps } from './emails'

/**
 * The email + company-settings REST surface. Mounted unconditionally from `createApp` - unlike
 * the interview routes, none of this needs an AI gateway. Every handler is thin (parse params/
 * body -> call emails.ts -> c.json); typed service errors (Validation/NotFound) bubble to the
 * shared `onError` mapping installed by `registerJobRoutes` (routes.ts), so no error handling
 * lives here.
 */
export function registerEmailRoutes(app: Hono, deps: EmailDeps): void {
  app.get('/email-templates', c => c.json(emails.listTemplates(deps)))

  app.post('/candidates/:id/emails', async c => {
    const candidateId = Number(c.req.param('id'))
    const body = await parseJsonBody<{ type: string; inputs: Record<string, string>; save: boolean }>(c)
    const type = body.type ?? ''
    const inputs = body.inputs ?? {}
    if (body.save) return c.json(emails.saveEmail(deps, candidateId, type, inputs), 201)
    return c.json(emails.renderEmail(deps, candidateId, type, inputs))
  })

  app.get('/candidates/:id/emails', c => c.json(emails.listEmails(deps, Number(c.req.param('id')))))

  app.get('/emails/:id', c => c.json(emails.getEmail(deps, Number(c.req.param('id')))))

  app.get('/company-settings', c => c.json(emails.getCompanySettings(deps)))

  app.put('/company-settings', async c => {
    const body = await parseJsonBody<{ name: string; senderName: string }>(c)
    return c.json(emails.setCompanySettings(deps, body))
  })
}
