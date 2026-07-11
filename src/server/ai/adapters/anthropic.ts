import type { AdapterRequest, AdapterResult, ProviderAdapter } from '../gateway'
import type { Credentials } from '../subscription'
import { statusError } from './openai'

export const anthropicAdapter: ProviderAdapter = {
  async complete(req: AdapterRequest, creds: Credentials, fetchFn: typeof fetch, signal: AbortSignal): Promise<AdapterResult> {
    const res = await fetchFn(`${creds.baseUrl ?? 'https://api.anthropic.com'}/v1/messages`, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': creds.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: req.model,
        max_tokens: req.maxOutputTokens,
        system: `${req.system}\n\nReport your analysis by calling the ${req.schemaName} tool exactly once, with a complete input object.`,
        messages: [{ role: 'user', content: req.user }],
        tools: [{ name: req.schemaName, description: 'Report the structured analysis result.', input_schema: req.jsonSchema }],
        tool_choice: { type: 'tool', name: req.schemaName }
      })
    })
    if (!res.ok) throw statusError(res.status, await res.text())
    const data = (await res.json()) as {
      content: ({ type: 'tool_use'; name: string; input: unknown } | { type: string })[]
      usage: { input_tokens: number; output_tokens: number }
    }
    const tool = data.content.find(b => b.type === 'tool_use') as { input: unknown } | undefined
    if (!tool) throw statusError(500, 'anthropic response contained no tool_use block')
    return {
      rawText: JSON.stringify(tool.input),
      usage: { prompt: data.usage?.input_tokens ?? 0, completion: data.usage?.output_tokens ?? 0 }
    }
  }
}
