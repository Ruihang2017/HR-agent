import type { Context } from 'hono'
import { ValidationError } from './errors'

/**
 * Strict JSON body parsing shared by every route module that takes a JSON body (interview
 * routes, email + company-settings routes): a blank body reads as `{}` so the handler's own
 * missing-field validation applies; a non-blank unparseable body is a typed 400, never a raw
 * SyntaxError -> 500.
 */
export async function parseJsonBody<T extends object>(c: Context): Promise<Partial<T>> {
  const raw = await c.req.text()
  if (raw.trim().length === 0) return {}
  try {
    return JSON.parse(raw) as Partial<T>
  } catch {
    throw new ValidationError('request body must be valid JSON')
  }
}
