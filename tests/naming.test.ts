import { describe, it, expect } from 'vitest'
import { deriveFolderName } from '../src/server/naming'

describe('deriveFolderName', () => {
  it('keeps unicode names as-is', () => {
    expect(deriveFolderName('销售经理', [])).toBe('销售经理')
  })

  it('strips Windows-illegal characters', () => {
    expect(deriveFolderName('Sales/Manager: "North" <QLD>?', [])).toBe('Sales Manager North QLD')
  })

  it('collapses whitespace and trims dots/spaces', () => {
    expect(deriveFolderName('  Sales   Manager. ', [])).toBe('Sales Manager')
  })

  it('guards reserved device names', () => {
    expect(deriveFolderName('CON', [])).toBe('CON_')
    expect(deriveFolderName('lpt1', [])).toBe('lpt1_')
  })

  it('falls back for names that sanitize to nothing', () => {
    expect(deriveFolderName('???', [])).toBe('job')
  })

  it('caps length at 80 chars without trailing dots/spaces', () => {
    const long = 'a'.repeat(79) + ' b'
    expect(deriveFolderName(long, []).length).toBeLessThanOrEqual(80)
    expect(deriveFolderName(long, [])).not.toMatch(/[. ]$/)
  })

  it('suffixes on case-insensitive collision', () => {
    expect(deriveFolderName('Sales Manager', ['sales manager'])).toBe('Sales Manager (2)')
    expect(deriveFolderName('Sales Manager', ['Sales Manager', 'Sales Manager (2)'])).toBe('Sales Manager (3)')
  })
})
