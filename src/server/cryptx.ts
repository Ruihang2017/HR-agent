import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'

/**
 * AES-256-GCM crypto primitives. Pure node:crypto, no dependencies.
 *
 * Candidate-file envelope (Task 6): FILE_MAGIC | iv(12) | tag(16) | ciphertext.
 * BACKUP_MAGIC is reserved for the backup envelope (Task 11), which wraps this
 * same primitive with its own header (salt, etc.) around the encrypted payload.
 */
export const FILE_MAGIC = Buffer.from('JPE1')
export const BACKUP_MAGIC = Buffer.from('JPBK1')

const IV_LEN = 12
const TAG_LEN = 16

/** Encrypts `plain` under `key` (32 bytes) into the JPE1 envelope. */
export function encryptBuffer(key: Buffer, plain: Buffer): Buffer {
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([FILE_MAGIC, iv, tag, ciphertext])
}

/**
 * Decrypts a JPE1 envelope produced by encryptBuffer. Throws
 * Error('not an encrypted file') if the magic doesn't match; GCM
 * authentication failures (tampering, wrong key) propagate from node:crypto.
 */
export function decryptBuffer(key: Buffer, blob: Buffer): Buffer {
  if (!isEncrypted(blob)) throw new Error('not an encrypted file')
  const iv = blob.subarray(FILE_MAGIC.length, FILE_MAGIC.length + IV_LEN)
  const tag = blob.subarray(FILE_MAGIC.length + IV_LEN, FILE_MAGIC.length + IV_LEN + TAG_LEN)
  const ciphertext = blob.subarray(FILE_MAGIC.length + IV_LEN + TAG_LEN)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

/** True if `buf` starts with the JPE1 magic; length-safe for short/empty buffers. */
export function isEncrypted(buf: Buffer): boolean {
  if (buf.length < FILE_MAGIC.length) return false
  return buf.subarray(0, FILE_MAGIC.length).equals(FILE_MAGIC)
}

/** Derives a 32-byte AES-256 key from a backup passphrase and salt via scrypt. */
export function deriveBackupKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
}
