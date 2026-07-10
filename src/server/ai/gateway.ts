import type { ZodType } from 'zod'
import type { DB } from '../db'
import { getAiSettings } from './settings'
import type { Provider } from './catalog'
import type { Credentials, TokenIssuer } from './subscription'
import { openaiAdapter } from './adapters/openai'

export type GatewayErrorCode = 'auth' | 'rate_limit' | 'network' | 'timeout' | 'invalid_output' | 'provider_error'

export class GatewayError extends Error {
  constructor(public code: GatewayErrorCode, message: string) {
    super(message)
    this.name = 'GatewayError'
  }
}

export interface AdapterRequest {
  model: string; system: string; user: string
  schemaName: string; jsonSchema: object; maxOutputTokens: number
}
export interface AdapterResult { rawText: string; usage: { prompt: number; completion: number } }
export interface ProviderAdapter {
  complete(req: AdapterRequest, creds: Credentials, fetchFn: typeof fetch, signal: AbortSignal): Promise<AdapterResult>
}

export interface CompletionRequest<T> {
  system: string; user: string
  schemaName: string; jsonSchema: object; zodSchema: ZodType<T>
  kind: string; jobId?: number; candidateId?: number; maxOutputTokens?: number
}
export interface CompletionResult<T> {
  output: T; provider: Provider; model: string
  usage: { prompt: number; completion: number }
}

export interface GatewayDeps {
  db: DB
  issuer: TokenIssuer
  fetchFn?: typeof fetch
  adapters?: Partial<Record<Provider, ProviderAdapter>>
  backoffMs?: number[]      // test override; production default [1000, 4000]
  timeoutMs?: number        // per transport attempt; default 60_000
}

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

export class Gateway {
  private adapters: Record<Provider, ProviderAdapter>
  constructor(private deps: GatewayDeps) {
    this.adapters = {
      openai: openaiAdapter,
      deepseek: openaiAdapter, // placeholder until Task 5 lands the real adapter
      anthropic: openaiAdapter, // placeholder until Task 5 lands the real adapter
      ...deps.adapters
    }
  }

  async complete<T>(req: CompletionRequest<T>): Promise<CompletionResult<T>> {
    const sel = getAiSettings(this.deps.db)
    let creds: Credentials
    try {
      creds = this.deps.issuer.getCredentials(sel.provider)
    } catch (e) {
      if ((e as Error).name === 'AuthCredentialsError') throw new GatewayError('auth', (e as Error).message)
      throw e
    }
    const adapter = this.adapters[sel.provider]
    let user = req.user
    for (let ask = 0; ask < 2; ask++) {
      const { rawText, usage } = await this.transport(adapter, {
        model: sel.model, system: req.system, user,
        schemaName: req.schemaName, jsonSchema: req.jsonSchema,
        maxOutputTokens: req.maxOutputTokens ?? 8000
      }, creds)
      this.recordUsage(sel.provider, sel.model, req, usage)
      let issues: string
      try {
        const validated = req.zodSchema.safeParse(JSON.parse(rawText))
        if (validated.success) return { output: validated.data, provider: sel.provider, model: sel.model, usage }
        issues = JSON.stringify(validated.error.issues.slice(0, 5))
      } catch {
        issues = 'the response was not valid JSON'
      }
      user =
        `${req.user}\n\nYour previous response failed validation: ${issues}\n` +
        `Return ONLY a corrected JSON object matching the schema.`
    }
    throw new GatewayError('invalid_output', 'model output failed schema validation after a corrective retry')
  }

  private async transport(adapter: ProviderAdapter, req: AdapterRequest, creds: Credentials): Promise<AdapterResult> {
    const backoff = this.deps.backoffMs ?? [1000, 4000]
    const fetchFn = this.deps.fetchFn ?? fetch
    let lastErr: Error = new Error('unreachable')
    for (let attempt = 0; attempt <= backoff.length; attempt++) {
      try {
        return await adapter.complete(req, creds, fetchFn, AbortSignal.timeout(this.deps.timeoutMs ?? 60_000))
      } catch (e) {
        const err = e as Error
        if (err.name === 'AdapterAuthError') throw new GatewayError('auth', 'provider rejected the credential')
        lastErr =
          err.name === 'AdapterRateLimitError' ? new GatewayError('rate_limit', 'provider rate limit hit')
          : err.name === 'AdapterProviderError' ? new GatewayError('provider_error', err.message)
          : err.name === 'TimeoutError' || err.name === 'AbortError' ? new GatewayError('timeout', 'provider call timed out')
          : new GatewayError('network', err.message)
        if (attempt < backoff.length) await sleep(backoff[attempt])
      }
    }
    throw lastErr
  }

  private recordUsage(provider: Provider, model: string, req: CompletionRequest<unknown>, usage: { prompt: number; completion: number }): void {
    this.deps.db.prepare(
      'INSERT INTO usage_events (provider, model, kind, prompt_tokens, completion_tokens, job_id, candidate_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(provider, model, req.kind, usage.prompt, usage.completion, req.jobId ?? null, req.candidateId ?? null)
  }
}
