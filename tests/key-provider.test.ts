import { describe, it, expect } from 'vitest'
import { randomBytes } from 'node:crypto'
import { hexEncodeKey, hexDecodeKey } from '../src/main/key-provider'

/**
 * key-provider.ts is main-process/Electron code: getOrCreateDataKey() itself calls
 * safeStorage, which requires a real OS keychain and is only exercised by an owner
 * walk (see docs/handover). What IS pure and testable here is the wrap-format helper:
 * safeStorage.encryptString/decryptString only accept valid strings, so the raw
 * 32-byte key is hex-encoded before wrapping and hex-decoded after unwrapping. This
 * locks that round-trip contract without touching safeStorage.
 */
describe('key-provider wrap-format helpers (pure, no safeStorage)', () => {
  it('round-trips a random 32-byte key through hex encoding', () => {
    const key = randomBytes(32)
    expect(hexDecodeKey(hexEncodeKey(key))).toEqual(key)
  })

  it('round-trips edge-byte keys (all-zero, all-0xff)', () => {
    const zero = Buffer.alloc(32, 0)
    const ff = Buffer.alloc(32, 0xff)
    expect(hexDecodeKey(hexEncodeKey(zero))).toEqual(zero)
    expect(hexDecodeKey(hexEncodeKey(ff))).toEqual(ff)
  })

  it('encodes as 64 lowercase hex characters (32 bytes)', () => {
    const hex = hexEncodeKey(randomBytes(32))
    expect(hex).toMatch(/^[0-9a-f]{64}$/)
  })
})
