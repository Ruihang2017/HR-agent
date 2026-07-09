import { describe, it, expect } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import { resolveDataRoot, getPaths } from '../src/server/paths'

describe('resolveDataRoot', () => {
  it('uses JOBPIN_DATA_DIR when set', () => {
    expect(resolveDataRoot({ JOBPIN_DATA_DIR: 'C:\\tmp\\jp' })).toBe('C:\\tmp\\jp')
  })

  it('ignores an empty JOBPIN_DATA_DIR', () => {
    expect(resolveDataRoot({ JOBPIN_DATA_DIR: '  ' })).toBe(path.join(os.homedir(), 'jobpin-data'))
  })

  it('defaults to <home>/jobpin-data (D-21)', () => {
    expect(resolveDataRoot({})).toBe(path.join(os.homedir(), 'jobpin-data'))
  })
})

describe('getPaths', () => {
  it('derives every path from the data root', () => {
    const p = getPaths('/root')
    expect(p.dataRoot).toBe('/root')
    expect(p.dbFile).toBe(path.join('/root', 'jobpin.db'))
    expect(p.companyDir).toBe(path.join('/root', 'company'))
    expect(p.jobsDir).toBe(path.join('/root', 'jobs'))
    expect(p.companyMemoryFile).toBe(path.join('/root', 'company', 'company_memory.md'))
    expect(p.valuesFile).toBe(path.join('/root', 'company', 'values.md'))
    expect(p.bossPreferencesFile).toBe(path.join('/root', 'company', 'boss_preferences.json'))
    expect(p.legalTemplatesDir).toBe(path.join('/root', 'company', 'legal_templates'))
    expect(p.onboardingTemplatesDir).toBe(path.join('/root', 'company', 'onboarding_templates'))
  })
})
