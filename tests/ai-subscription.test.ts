import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase, runMigrations } from '../src/server/db'
import { migrations } from '../src/server/migrations'
import { DevTokenIssuer, getPlan } from '../src/server/ai/subscription'
import { CATALOG, DEFAULT_SELECTION, disclosureFor } from '../src/server/ai/catalog'
import { getAiSettings, setAiSettings } from '../src/server/ai/settings'

const freshDb = () => {
  const db = openDatabase(join(mkdtempSync(join(tmpdir(), 'jobpin-sub-')), 't.db'))
  runMigrations(db, migrations)
  return db
}

describe('DevTokenIssuer', () => {
  it('returns env credentials per provider (deepseek carries baseUrl)', () => {
    const issuer = new DevTokenIssuer({ OPENAI_API_KEY: 'sk-o', DEEPSEEK_API_KEY: 'sk-d', ANTHROPIC_API_KEY: 'sk-a' })
    expect(issuer.getCredentials('openai').apiKey).toBe('sk-o')
    expect(issuer.getCredentials('deepseek').baseUrl).toBe('https://api.deepseek.com')
    expect(issuer.getCredentials('anthropic').apiKey).toBe('sk-a')
  })
  it('missing key throws AuthCredentialsError naming the provider, not any key material', () => {
    const issuer = new DevTokenIssuer({})
    try {
      issuer.getCredentials('openai')
      expect.unreachable()
    } catch (e) {
      expect((e as Error).name).toBe('AuthCredentialsError')
      expect((e as Error).message).toContain('openai')
      expect((e as Error).message.toLowerCase()).not.toContain('sk-')
    }
  })
})

describe('catalog + plan', () => {
  it('dev plan is pro with a positive allowance', () => {
    const plan = getPlan()
    expect(plan.tier).toBe('pro')
    expect(plan.monthlyTokens).toBeGreaterThan(0)
  })
  it('every provider has a disclosure mentioning data transit', () => {
    for (const p of ['openai', 'deepseek', 'anthropic'] as const) {
      expect(disclosureFor(p).toLowerCase()).toContain('candidate')
    }
  })
})

describe('ai settings', () => {
  it('defaults to DEFAULT_SELECTION on first read', () => {
    expect(getAiSettings(freshDb())).toEqual(DEFAULT_SELECTION)
  })
  it('persists a valid selection', () => {
    const db = freshDb()
    setAiSettings(db, { provider: 'anthropic', model: CATALOG.anthropic[0].id })
    expect(getAiSettings(db).provider).toBe('anthropic')
  })
  it('rejects off-catalog models and models outside the plan tier', () => {
    const db = freshDb()
    expect(() => setAiSettings(db, { provider: 'openai', model: 'gpt-2' })).toThrowError(/catalog/)
  })
})
