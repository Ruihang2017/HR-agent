import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import Database from 'better-sqlite3-multiple-ciphers'
import JSZip from 'jszip'
import type { DB } from './db'
import type { JobpinPaths } from './paths'
import { BACKUP_MAGIC, decryptBuffer, deriveBackupKey, isEncrypted } from './cryptx'
import { renameSyncWithRetry } from './fsx'

/**
 * Backup/restore core (Task 11, F8.4) - Electron-free so it is fully unit-testable; the
 * Electron layer (save/open dialogs, passphrase prompts, relaunch) lives in src/main/ipc.ts.
 *
 * A backup must be PORTABLE: it has to be restorable on any machine, so the machine-bound
 * data key never leaves this process. The DB snapshot and every candidate-tree file are
 * DECRYPTED into the archive; the archive itself is then protected either by a boss-chosen
 * passphrase (`.jpbak`, AES-256-GCM under the `JPBK1` envelope) or left as a plain `.zip`
 * behind an explicit UI acknowledgement that candidate data will be unprotected in that file.
 */

export interface BackupDeps {
  db: DB
  paths: JobpinPaths
  dataKey?: Buffer
}

export interface BackupResult {
  path: string
  encrypted: boolean
}

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]) // 'PK\x03\x04'
const SALT_LEN = 16
const IV_LEN = 12
const TAG_LEN = 16
const WRONG_PASSPHRASE_MESSAGE = 'wrong passphrase or corrupt backup'

/**
 * True when `relPosix` (forward-slash, relative to `dataRoot`) must never appear in a backup
 * archive: the wrapped machine key (`.keys/**`), the LIVE db files (`jobpin.db` and its
 * `-wal`/`-shm` siblings - the archive carries its own decrypted snapshot as `jobpin.db`
 * instead), a restore safety-copy leftover (`*.pre-restore-*`), or a crashed-sweep temp file
 * (`*.jpenc-tmp`, see data-migrations.ts).
 */
function isExcludedFromBackup(relPosix: string): boolean {
  const parts = relPosix.split('/')
  if (parts.includes('.keys')) return true
  const base = parts[parts.length - 1]
  return base.startsWith('jobpin.db') || base.includes('.pre-restore-') || base.endsWith('.jpenc-tmp')
}

/** `jobs/<folder>/candidates/candidate_<id>/**` - the only files ever written encrypted (D-17). */
function isCandidateTreeFile(relPosix: string): boolean {
  const parts = relPosix.split('/')
  return parts[0] === 'jobs' && parts[2] === 'candidates' && parts.length >= 4 && parts[3].startsWith('candidate_')
}

/**
 * Recursively lists every file under `root`, as `root`-relative POSIX paths (forward slashes,
 * regardless of OS), skipping excluded entries - and never descending into an excluded
 * directory (so `.keys/**` is never even read).
 */
function listBackupFiles(root: string, rel = ''): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const entryRel = rel ? `${rel}/${entry.name}` : entry.name
    if (isExcludedFromBackup(entryRel)) continue
    if (entry.isDirectory()) {
      out.push(...listBackupFiles(root, entryRel))
    } else if (entry.isFile()) {
      out.push(entryRel)
    }
  }
  return out
}

/**
 * Creates a portable backup archive at `outFile`.
 *
 * 1. `PRAGMA wal_checkpoint(TRUNCATE)` on the LIVE connection folds every WAL frame into the
 *    main db file and empties the WAL, so a plain byte-copy of that file is a complete,
 *    consistent snapshot with nothing left in-flight. (`db.backup()`, the API named in the
 *    original design note, turns out NOT to work here: better-sqlite3-multiple-ciphers'
 *    native backup rejects copying from a keyed source connection into the plain destination
 *    it opens internally - "backup is not supported with incompatible source and target
 *    databases", verified live against the installed 12.x - so checkpoint+copy is used
 *    instead. It has the same "self-contained file, no live connection needed" property.)
 * 2. If keyed, the snapshot copy is decrypted in place (`PRAGMA hexrekey = ''`) so the
 *    archived DB is plain SQLite, openable on any machine without the original key. Rekeying
 *    refuses to run in WAL mode, so the copy is switched to `journal_mode = DELETE` first -
 *    this only touches the disposable snapshot, never the live database.
 * 3. Every file under `paths.dataRoot` is added to a zip, EXCEPT the machine key and the live
 *    db files; candidate-tree files are decrypted before being added (the archive never
 *    carries ciphertext bound to this machine's key); company/job files are already plain and
 *    added as-is.
 * 4. With a passphrase: the zip is AES-256-GCM-encrypted under a scrypt-derived key into the
 *    `JPBK1` envelope. Without one: the raw zip bytes are written (a plain `.zip` - the
 *    caller's UI is responsible for the "unprotected" acknowledgement before calling this).
 */
export async function createBackup(
  deps: BackupDeps,
  outFile: string,
  opts: { passphrase?: string } = {}
): Promise<BackupResult> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobpin-backup-work-'))
  try {
    const tmpDbPath = path.join(tmpDir, 'jobpin.db')
    deps.db.pragma('wal_checkpoint(TRUNCATE)') // fold the WAL into the main file: a self-contained snapshot
    fs.copyFileSync(deps.paths.dbFile, tmpDbPath)

    if (deps.dataKey) {
      const hex = deps.dataKey.toString('hex')
      const snapshot = new Database(tmpDbPath)
      snapshot.pragma(`hexkey = '${hex}'`) // must be the first statement, mirrors db.ts's convention
      snapshot.prepare('SELECT count(*) FROM sqlite_master').get() // probe: fail loudly if unreadable under this key
      snapshot.pragma('journal_mode = DELETE') // hexrekey refuses to run in WAL mode
      snapshot.pragma(`hexrekey = ''`) // decrypt to plaintext - the archive must be portable
      snapshot.close()
    }

    const zip = new JSZip()
    zip.file('jobpin.db', fs.readFileSync(tmpDbPath))

    for (const relPosix of listBackupFiles(deps.paths.dataRoot)) {
      const buf = fs.readFileSync(path.join(deps.paths.dataRoot, relPosix))
      const content =
        deps.dataKey && isCandidateTreeFile(relPosix) && isEncrypted(buf) ? decryptBuffer(deps.dataKey, buf) : buf
      zip.file(relPosix, content)
    }

    const zipBytes = await zip.generateAsync({ type: 'nodebuffer' })

    if (opts.passphrase) {
      const salt = randomBytes(SALT_LEN)
      const key = deriveBackupKey(opts.passphrase, salt)
      const iv = randomBytes(IV_LEN)
      const cipher = createCipheriv('aes-256-gcm', key, iv)
      const ciphertext = Buffer.concat([cipher.update(zipBytes), cipher.final()])
      const tag = cipher.getAuthTag()
      fs.writeFileSync(outFile, Buffer.concat([BACKUP_MAGIC, salt, iv, tag, ciphertext]))
      return { path: outFile, encrypted: true }
    }

    fs.writeFileSync(outFile, zipBytes)
    return { path: outFile, encrypted: false }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}

/**
 * Reads a backup file and returns the plaintext zip bytes, sniffing the on-disk magic:
 *  - `JPBK1` -> an encrypted `.jpbak`: requires `opts.passphrase`, derives the key from the
 *    embedded salt, and AES-256-GCM-decrypts. Any failure (missing/wrong passphrase, a
 *    tampered/corrupt file) throws the same clean message - never leaks which part failed.
 *  - `PK\x03\x04` (a plain zip) -> passthrough, unchanged.
 *  - anything else -> the same clean error (not a recognisable backup at all).
 */
export function readBackup(inFile: string, opts: { passphrase?: string } = {}): Buffer {
  const raw = fs.readFileSync(inFile)

  if (raw.length >= BACKUP_MAGIC.length && raw.subarray(0, BACKUP_MAGIC.length).equals(BACKUP_MAGIC)) {
    if (!opts.passphrase) throw new Error(WRONG_PASSPHRASE_MESSAGE)
    try {
      let offset = BACKUP_MAGIC.length
      const salt = raw.subarray(offset, offset + SALT_LEN)
      offset += SALT_LEN
      const iv = raw.subarray(offset, offset + IV_LEN)
      offset += IV_LEN
      const tag = raw.subarray(offset, offset + TAG_LEN)
      offset += TAG_LEN
      const ciphertext = raw.subarray(offset)
      const key = deriveBackupKey(opts.passphrase, salt)
      const decipher = createDecipheriv('aes-256-gcm', key, iv)
      decipher.setAuthTag(tag)
      return Buffer.concat([decipher.update(ciphertext), decipher.final()])
    } catch {
      throw new Error(WRONG_PASSPHRASE_MESSAGE)
    }
  }

  if (raw.length >= ZIP_MAGIC.length && raw.subarray(0, ZIP_MAGIC.length).equals(ZIP_MAGIC)) {
    return raw
  }

  throw new Error(WRONG_PASSPHRASE_MESSAGE)
}

/**
 * Asserts `extractedDir` is a real Jobpin backup tree before it is allowed to replace the live
 * data folder: it must contain `jobpin.db`. Guards against restoring an arbitrary zip (which
 * would otherwise be swapped in and then leave the app with no database).
 */
export function assertValidRestoreTree(extractedDir: string): void {
  if (!fs.existsSync(path.join(extractedDir, 'jobpin.db'))) {
    throw new Error('restore archive is missing jobpin.db - not a valid Jobpin backup')
  }
}

/**
 * Crash-safe swap of a freshly-extracted backup tree into place, so a failed restore can never
 * leave the boss without a data folder (F8.4). Steps:
 *  1. Validate `extractedDir` first (must contain `jobpin.db`) - abort before touching anything.
 *  2. Rename the live `dataRoot` aside to a `.pre-restore-<ts>` sibling (never delete - the boss
 *     can always recover by hand).
 *  3. Move `extractedDir` into `dataRoot`. If THAT fails, compensate by renaming the pre-restore
 *     copy back to `dataRoot`, then rethrow the ORIGINAL error (mirrors renameJob's D-26
 *     compensate-on-failure pattern). A double failure logs both paths and rethrows.
 *
 * Callers MUST extract into a sibling of `dataRoot` (same volume) so every rename is an atomic
 * same-volume move - a cross-volume rename throws `EXDEV`, which `renameSyncWithRetry` does not
 * retry, and would trigger exactly the data-loss window this function exists to close.
 * Returns the pre-restore path so the caller can surface it to the boss.
 */
export function restoreSwap(
  dataRoot: string,
  extractedDir: string,
  opts: { nowMs?: number; renameFn?: (from: string, to: string) => void } = {}
): string {
  const rename = opts.renameFn ?? renameSyncWithRetry
  assertValidRestoreTree(extractedDir)
  const preRestorePath = `${dataRoot}.pre-restore-${opts.nowMs ?? Date.now()}`
  rename(dataRoot, preRestorePath)
  try {
    rename(extractedDir, dataRoot)
  } catch (e) {
    // Second move failed: put the original data folder back so the boss is never left without one.
    try {
      rename(preRestorePath, dataRoot)
    } catch (compErr) {
      console.error(
        `restore compensation failed: your original data is safe at "${preRestorePath}" but ` +
          `"${dataRoot}" may be absent - rename the pre-restore folder back by hand to recover`,
        compErr
      )
    }
    throw e
  }
  return preRestorePath
}

/** Guards against zip-slip: the resolved extraction target must stay inside `destDir`. */
function safeJoin(destDir: string, entryRelPath: string): string {
  const resolvedDest = path.resolve(destDir)
  const target = path.resolve(resolvedDest, entryRelPath)
  if (target !== resolvedDest && !target.startsWith(resolvedDest + path.sep)) {
    throw new Error('backup archive contains an unsafe path')
  }
  return target
}

/** Unzips `zipBytes` into `destDir` (created if missing), preserving the archive's tree. */
export async function extractBackupTo(zipBytes: Buffer, destDir: string): Promise<void> {
  const zip = await JSZip.loadAsync(zipBytes)
  fs.mkdirSync(destDir, { recursive: true })
  for (const relPath of Object.keys(zip.files)) {
    const entry = zip.files[relPath]
    if (entry.dir) continue
    const target = safeJoin(destDir, relPath)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    const content = await entry.async('nodebuffer')
    fs.writeFileSync(target, content)
  }
}
