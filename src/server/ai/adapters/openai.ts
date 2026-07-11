import type { AdapterRequest, AdapterResult, ProviderAdapter } from '../gateway'
import type { Credentials } from '../subscription'

export const openaiAdapter: ProviderAdapter = {
  async complete(req: AdapterRequest, creds: Credentials, fetchFn: typeof fetch, signal: AbortSignal): Promise<AdapterResult> {
    const res = await fetchFn(`${creds.baseUrl ?? 'https://api.openai.com'}/v1/chat/completions`, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${creds.apiKey}` },
      body: JSON.stringify({
        model: req.model,
        messages: [
          { role: 'system', content: `${req.system}\n\nRespond only with the single JSON object required by the response schema.` },
          { role: 'user', content: req.user }
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: req.schemaName, strict: true, schema: req.jsonSchema }
        },
        max_completion_tokens: req.maxOutputTokens
      })
    })
    if (!res.ok) throw statusError(res.status, await res.text())
    const data = (await res.json()) as { choices: { message: { content: string } }[]; usage: { prompt_tokens: number; completion_tokens: number } }
    return {
      rawText: data.choices[0]?.message?.content ?? '',
      usage: { prompt: data.usage?.prompt_tokens ?? 0, completion: data.usage?.completion_tokens ?? 0 }
    }
  }
}

/** Shared by the OpenAI-wire adapters (openai, deepseek) and anthropic. Never include credentials in messages. */
export function statusError(status: number, bodyText: string): Error {
  const err = new Error(`provider returned ${status}: ${bodyText.slice(0, 300)}`)
  err.name = status === 401 || status === 403 ? 'AdapterAuthError'
    : status === 429 ? 'AdapterRateLimitError'
    : 'AdapterProviderError'
  return err
}
