import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { openDatabase, runMigrations } from '../src/server/db'
import { migrations } from '../src/server/migrations'
import { Gateway } from '../src/server/ai/gateway'
import { DevTokenIssuer } from '../src/server/ai/subscription'

const freshDb = () => {
  const db = openDatabase(join(mkdtempSync(join(tmpdir(), 'jobpin-gw-')), 't.db'))
  runMigrations(db, migrations)
  return db
}
const issuer = new DevTokenIssuer({ OPENAI_API_KEY: 'sk-test' })
const Out = z.object({ answer: z.string() }).strict()
const req = {
  system: 's', user: 'u', schemaName: 'out', jsonSchema: { type: 'object' },
  zodSchema: Out, kind: 'candidate_analysis', jobId: 1, candidateId: 1
}
const openaiBody = (content: string) => JSON.stringify({
  choices: [{ message: { content } }],
  usage: { prompt_tokens: 11, completion_tokens: 7 }
})
const ok = (body: string) => new Response(body, { status: 200 })

describe('gateway', () => {
  it('happy path: parses, validates, records usage', async () => {
    const db = freshDb()
    const gw = new Gateway({ db, issuer, fetchFn: (async () => ok(openaiBody('{"answer":"hi"}'))) as typeof fetch })
    const res = await gw.complete(req)
    expect(res.output).toEqual({ answer: 'hi' })
    expect(res.provider).toBe('openai')
    const usage = db.prepare('SELECT * FROM usage_events').all() as any[]
    expect(usage).toHaveLength(1)
    expect(usage[0].prompt_tokens).toBe(11)
    expect(usage[0].kind).toBe('candidate_analysis')
  })
  it('401 maps to auth with no retry', async () => {
    let calls = 0
    const gw = new Gateway({ db: freshDb(), issuer, fetchFn: (async () => { calls++; return new Response('{}', { status: 401 }) }) as typeof fetch })
    await expect(gw.complete(req)).rejects.toMatchObject({ code: 'auth' })
    expect(calls).toBe(1)
  })
  it('429 retries then succeeds', async () => {
    let calls = 0
    const gw = new Gateway({
      db: freshDb(), issuer, backoffMs: [1, 1],
      fetchFn: (async () => (++calls < 2 ? new Response('{}', { status: 429 }) : ok(openaiBody('{"answer":"hi"}')))) as typeof fetch
    })
    const res = await gw.complete(req)
    expect(res.output.answer).toBe('hi')
    expect(calls).toBe(2)
  })
  it('persistent 500 exhausts retries as provider_error', async () => {
    let calls = 0
    const gw = new Gateway({ db: freshDb(), issuer, backoffMs: [1, 1], fetchFn: (async () => { calls++; return new Response('boom', { status: 500 }) }) as typeof fetch })
    await expect(gw.complete(req)).rejects.toMatchObject({ code: 'provider_error' })
    expect(calls).toBe(3)
  })
  it('network throw maps to network', async () => {
    const gw = new Gateway({ db: freshDb(), issuer, backoffMs: [1, 1], fetchFn: (async () => { throw new TypeError('fetch failed') }) as typeof fetch })
    await expect(gw.complete(req)).rejects.toMatchObject({ code: 'network' })
  })
  it('invalid output: one corrective re-ask, then invalid_output; usage recorded for BOTH calls', async () => {
    const db = freshDb()
    let calls = 0
    const bodies = [openaiBody('not json at all'), openaiBody('{"wrong":"shape"}')]
    const gw = new Gateway({ db, issuer, fetchFn: (async () => ok(bodies[calls++])) as typeof fetch })
    await expect(gw.complete(req)).rejects.toMatchObject({ code: 'invalid_output' })
    expect(calls).toBe(2)
    expect(db.prepare('SELECT COUNT(*) AS n FROM usage_events').get()).toMatchObject({ n: 2 })
  })
  it('re-ask includes the validation issues and recovers', async () => {
    let secondUserPrompt = ''
    let calls = 0
    const gw = new Gateway({
      db: freshDb(), issuer,
      fetchFn: (async (_url: any, init: any) => {
        calls++
        const body = JSON.parse(String(init!.body))
        if (calls === 2) secondUserPrompt = body.messages[1].content
        return ok(openaiBody(calls === 1 ? '{"wrong":1}' : '{"answer":"fixed"}'))
      }) as typeof fetch
    })
    const res = await gw.complete(req)
    expect(res.output.answer).toBe('fixed')
    expect(secondUserPrompt).toContain('failed validation')
  })
  it('missing credential surfaces as auth', async () => {
    const gw = new Gateway({ db: freshDb(), issuer: new DevTokenIssuer({}), fetchFn: (async () => ok(openaiBody('{}'))) as typeof fetch })
    await expect(gw.complete(req)).rejects.toMatchObject({ code: 'auth' })
  })
})

describe('openai adapter request shape', () => {
  it('sends strict json_schema response_format with auth header', async () => {
    let captured: any
    const gw = new Gateway({
      db: freshDb(), issuer,
      fetchFn: (async (url: any, init: any) => {
        captured = { url: String(url), init }
        return ok(openaiBody('{"answer":"hi"}'))
      }) as typeof fetch
    })
    await gw.complete(req)
    expect(captured.url).toBe('https://api.openai.com/v1/chat/completions')
    expect(captured.init.headers.Authorization).toBe('Bearer sk-test')
    const body = JSON.parse(captured.init.body)
    expect(body.model).toBe('gpt-5-mini')
    expect(body.response_format.type).toBe('json_schema')
    expect(body.response_format.json_schema.strict).toBe(true)
    expect(body.messages[0].role).toBe('system')
  })
})
