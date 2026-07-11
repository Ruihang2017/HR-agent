import { safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'

const KEY_DIR_NAME = '.keys'
const KEY_FILE_NAME = 'master.key'

/**
 * Hex-encodes a raw key so it round-trips through `safeStorage.encryptString`, which
 * only accepts a valid JS string - the raw 32 key bytes are not safe to pass as-is
 * (they are not guaranteed valid UTF-8 and would be silently mangled on the way in).
 */
export function hexEncodeKey(key: Buffer): string {
  return key.toString('hex')
}

/** Inverse of hexEncodeKey. */
export function hexDecodeKey(hex: string): Buffer {
  return Buffer.from(hex, 'hex')
}

function keyFilePath(dataRoot: string): string {
  return path.join(dataRoot, KEY_DIR_NAME, KEY_FILE_NAME)
}

/**
 * Returns the 32-byte AES-256 data key for `dataRoot`, wrapped at rest via Electron's
 * `safeStorage` (DPAPI on Windows, Keychain on macOS, libsecret/kwallet on Linux).
 * Never logs the key.
 *
 * - `safeStorage.isEncryptionAvailable() === false` (no OS keychain backend, e.g. some
 *   headless Linux setups): returns null. The caller proceeds keyless and surfaces the
 *   state via `/health` so the Settings UI can show a persistent warning.
 * - `<dataRoot>/.keys/master.key` exists: read it - base64 of the safeStorage-encrypted
 *   hex key - decrypt, hex-decode, return the raw 32-byte Buffer.
 * - missing: generate 32 random bytes, hex-encode, wrap via `safeStorage.encryptString`,
 *   base64 the wrapped bytes, `mkdir -p .keys`, write, return the raw key.
 *
 * The safeStorage calls themselves require a real OS keychain and are not exercised by
 * the automated suite (which runs under `ELECTRON_RUN_AS_NODE=1`, where `safeStorage`
 * is unavailable) - see docs/handover for the owner-walk that covers this path.
 */
export function getOrCreateDataKey(dataRoot: string): Buffer | null {
  if (!safeStorage.isEncryptionAvailable()) return null

  const file = keyFilePath(dataRoot)
  if (fs.existsSync(file)) {
    const wrapped = Buffer.from(fs.readFileSync(file, 'utf8'), 'base64')
    return hexDecodeKey(safeStorage.decryptString(wrapped))
  }

  const key = randomBytes(32)
  const wrapped = safeStorage.encryptString(hexEncodeKey(key))
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, wrapped.toString('base64'), 'utf8')
  return key
}
