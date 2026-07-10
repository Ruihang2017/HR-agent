import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getPaths } from '../src/server/paths'
import { ensureScaffold } from '../src/server/scaffold'

let tmp: string

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jobpin-scaffold-'))
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('ensureScaffold', () => {
  it('creates the full first-run tree', () => {
    const p = getPaths(tmp)
    ensureScaffold(p)
    expect(fs.existsSync(p.companyDir)).toBe(true)
    expect(fs.existsSync(p.jobsDir)).toBe(true)
    expect(fs.existsSync(p.legalTemplatesDir)).toBe(true)
    expect(fs.existsSync(p.onboardingTemplatesDir)).toBe(true)
    expect(fs.readFileSync(p.companyMemoryFile, 'utf8')).toBe('')
    expect(fs.readFileSync(p.valuesFile, 'utf8')).toBe('')
    expect(JSON.parse(fs.readFileSync(p.bossPreferencesFile, 'utf8'))).toEqual({})
  })

  it('is idempotent and never overwrites existing files', () => {
    const p = getPaths(tmp)
    ensureScaffold(p)
    fs.writeFileSync(p.valuesFile, 'We value honesty.\n', 'utf8')
    fs.writeFileSync(p.bossPreferencesFile, '{"tone":"direct"}\n', 'utf8')
    ensureScaffold(p) // second run
    expect(fs.readFileSync(p.valuesFile, 'utf8')).toBe('We value honesty.\n')
    expect(fs.readFileSync(p.bossPreferencesFile, 'utf8')).toBe('{"tone":"direct"}\n')
  })
})
