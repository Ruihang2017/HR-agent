import { describe, it, expect } from 'vitest'
import { randomBytes } from 'node:crypto'
import {
  FILE_MAGIC,
  BACKUP_MAGIC,
  encryptBuffer,
  decryptBuffer,
  isEncrypted,
  deriveBackupKey,
} from '../src/server/cryptx'

describe('encryptBuffer / decryptBuffer round-trip', () => {
  it('round-trips a utf8 payload with a random 32B key', () => {
    const key = randomBytes(32)
    const plain = Buffer.from('hello candidate file', 'utf8')
    const blob = encryptBuffer(key, plain)
    expect(decryptBuffer(key, blob)).toEqual(plain)
  })

  it('round-trips a binary payload with a random 32B key', () => {
    const key = randomBytes(32)
    const plain = randomBytes(1024)
    const blob = encryptBuffer(key, plain)
    expect(decryptBuffer(key, blob)).toEqual(plain)
  })

  it('round-trips an empty buffer', () => {
    const key = randomBytes(32)
    const plain = Buffer.alloc(0)
    const blob = encryptBuffer(key, plain)
    expect(decryptBuffer(key, blob)).toEqual(plain)
  })
})

describe('envelope layout / magic detection', () => {
  it('output starts with the JPE1 magic', () => {
    const key = randomBytes(32)
    const blob = encryptBuffer(key, Buffer.from('payload'))
    expect(blob.subarray(0, 4)).toEqual(FILE_MAGIC)
  })

  it('BACKUP_MAGIC is the 5-byte JPBK1 magic', () => {
    expect(BACKUP_MAGIC).toEqual(Buffer.from('JPBK1'))
  })

  it('isEncrypted is true for encrypted output', () => {
    const key = randomBytes(32)
    const blob = encryptBuffer(key, Buffer.from('payload'))
    expect(isEncrypted(blob)).toBe(true)
  })

  it('isEncrypted is false for plain text', () => {
    expect(isEncrypted(Buffer.from('just plain text, not encrypted'))).toBe(false)
  })

  it('isEncrypted is false (length-safe) for a buffer shorter than the magic', () => {
    expect(isEncrypted(Buffer.from([0x4a, 0x50]))).toBe(false)
  })

  it('isEncrypted is false for an empty buffer', () => {
    expect(isEncrypted(Buffer.alloc(0))).toBe(false)
  })
})

describe('tamper detection', () => {
  it('throws when a ciphertext byte is flipped', () => {
    const key = randomBytes(32)
    const blob = encryptBuffer(key, Buffer.from('some candidate resume text'))
    const tamperedIdx = blob.length - 1 // last byte of ciphertext
    blob[tamperedIdx] = blob[tamperedIdx] ^ 0xff
    expect(() => decryptBuffer(key, blob)).toThrow()
  })

  it('throws when a tag byte is flipped', () => {
    const key = randomBytes(32)
    const blob = encryptBuffer(key, Buffer.from('some candidate resume text'))
    const tagStart = 4 + 12 // magic + iv
    blob[tagStart] = blob[tagStart] ^ 0xff
    expect(() => decryptBuffer(key, blob)).toThrow()
  })

  it('throws with the wrong key', () => {
    const key = randomBytes(32)
    const wrongKey = randomBytes(32)
    const blob = encryptBuffer(key, Buffer.from('some candidate resume text'))
    expect(() => decryptBuffer(wrongKey, blob)).toThrow()
  })

  it('throws Error("not an encrypted file") on bad magic', () => {
    const key = randomBytes(32)
    const notEncrypted = Buffer.from('this is not an encrypted blob at all!!')
    expect(() => decryptBuffer(key, notEncrypted)).toThrow('not an encrypted file')
  })
})

describe('deriveBackupKey', () => {
  it('is deterministic for the same passphrase and salt', () => {
    const salt = randomBytes(16)
    const k1 = deriveBackupKey('correct horse battery staple', salt)
    const k2 = deriveBackupKey('correct horse battery staple', salt)
    expect(k1).toEqual(k2)
  })

  it('differs across salts', () => {
    const k1 = deriveBackupKey('correct horse battery staple', randomBytes(16))
    const k2 = deriveBackupKey('correct horse battery staple', randomBytes(16))
    expect(k1).not.toEqual(k2)
  })

  it('returns 32 bytes', () => {
    const key = deriveBackupKey('a passphrase', randomBytes(16))
    expect(key.length).toBe(32)
  })
})
