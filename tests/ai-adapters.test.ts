import { describe, expect, it } from 'vitest'
import { deepseekAdapter } from '../src/server/ai/adapters/deepseek'
import { anthropicAdapter } from '../src/server/ai/adapters/anthropic'
import type { AdapterRequest } from '../src/server/ai/gateway'

const req: AdapterRequest = {
  model: 'm', system: 'sys', user: 'usr',
  schemaName: 'analysis', jsonSchema: { type: 'object' }, maxOutputTokens: 100
}
const signal = AbortSignal.timeout(5000)

describe('deepseek adapter', () => {
  it('uses the OpenAI wire with baseUrl + json_object mode + schema in the system text', async () => {
    let captured: any
    const fetchFn = (async (url: any, init: any) => {
      captured = { url: String(url), init }
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"a":1}' } }], usage: { prompt_tokens: 2, completion_tokens: 3 } }), { status: 200 })
    }) as typeof fetch
    const res = await deepseekAdapter.complete(req, { apiKey: 'sk-d', baseUrl: 'https://api.deepseek.com' }, fetchFn, signal)
    expect(captured.url).toBe('https://api.deepseek.com/chat/completions')
    const body = JSON.parse(captured.init.body)
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.messages[0].content).toContain('JSON Schema')
    expect(res.rawText).toBe('{"a":1}')
    expect(res.usage).toEqual({ prompt: 2, completion: 3 })
  })
})

describe('anthropic adapter', () => {
  it('forces a tool and returns the tool input as rawText', async () => {
    let captured: any
    const fetchFn = (async (url: any, init: any) => {
      captured = { url: String(url), init }
      return new Response(JSON.stringify({
        content: [{ type: 'text', text: 'thinking...' }, { type: 'tool_use', name: 'analysis', input: { a: 1 } }],
        usage: { input_tokens: 5, output_tokens: 9 }
      }), { status: 200 })
    }) as typeof fetch
    const res = await anthropicAdapter.complete(req, { apiKey: 'sk-a' }, fetchFn, signal)
    expect(captured.url).toBe('https://api.anthropic.com/v1/messages')
    expect(captured.init.headers['x-api-key']).toBe('sk-a')
    expect(captured.init.headers['anthropic-version']).toBeTruthy()
    const body = JSON.parse(captured.init.body)
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'analysis' })
    expect(body.tools[0].input_schema).toEqual({ type: 'object' })
    expect(body.system).toBe('sys')
    expect(res.rawText).toBe('{"a":1}')
    expect(res.usage).toEqual({ prompt: 5, completion: 9 })
  })
  it('missing tool_use block is a provider error (not a crash)', async () => {
    const fetchFn = (async () => new Response(JSON.stringify({ content: [{ type: 'text', text: 'no tool' }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 })) as typeof fetch
    await expect(anthropicAdapter.complete(req, { apiKey: 'k' }, fetchFn, signal)).rejects.toMatchObject({ name: 'AdapterProviderError' })
  })
  it('429 surfaces as AdapterRateLimitError', async () => {
    const fetchFn = (async () => new Response('slow down', { status: 429 })) as typeof fetch
    await expect(anthropicAdapter.complete(req, { apiKey: 'k' }, fetchFn, signal)).rejects.toMatchObject({ name: 'AdapterRateLimitError' })
  })
})
