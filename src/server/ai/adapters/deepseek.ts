import type { AdapterRequest, AdapterResult, ProviderAdapter } from '../gateway'
import type { Credentials } from '../subscription'
import { statusError } from './openai'

// DeepSeek is OpenAI-wire-compatible but has no json_schema mode: use
// json_object + the schema described in the system text; the gateway
// validates and re-asks (spec section 6).
export const deepseekAdapter: ProviderAdapter = {
  async complete(req: AdapterRequest, creds: Credentials, fetchFn: typeof fetch, signal: AbortSignal): Promise<AdapterResult> {
    const system = `${req.system}\n\nRespond with a single JSON object that conforms to this JSON Schema:\n${JSON.stringify(req.jsonSchema)}`
    const res = await fetchFn(`${creds.baseUrl ?? 'https://api.deepseek.com'}/chat/completions`, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${creds.apiKey}` },
      body: JSON.stringify({
        model: req.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: req.user }
        ],
        response_format: { type: 'json_object' },
        max_tokens: req.maxOutputTokens
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
