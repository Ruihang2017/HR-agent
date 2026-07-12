import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import JSZip from 'jszip'
import { getPaths, type JobpinPaths } from '../src/server/paths'
import { ensureScaffold } from '../src/server/scaffold'
import { openDatabase, runMigrations, type DB } from '../src/server/db'
import { migrations } from '../src/server/migrations'
import { createJob } from '../src/server/jobs'
import { addCandidateFromText } from '../src/server/candidates'
import { createBackup, readBackup, extractBackupTo, applyRestoreInPlace, assertValidRestoreTree, stageRestore, applyPendingRestore, RESTORE_MARKER } from '../src/server/backup'
import { FILE_MAGIC } from '../src/server/cryptx'
import { rmrfWithRetry } from './helpers'

let tmp: string
let outDir: string
let paths: JobpinPaths
let db: DB | undefined

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jobpin-backup-src-'))
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobpin-backup-out-'))
  paths = getPaths(tmp)
  ensureScaffold(paths)
  db = undefined
})

afterEach(() => {
  if (db) db.close()
  rmrfWithRetry(tmp)
  rmrfWithRetry(outDir)
})

function header(file: string): string {
  return fs.readFileSync(file).subarray(0, 16).toString('latin1')
}

describe('createBackup / readBackup / extractBackupTo — encrypted round-trip (.jpbak)', () => {
  it('archives a plaintext DB snapshot + plaintext candidate files under a boss passphrase; .keys is excluded', async () => {
    const dataKey = randomBytes(32)
    db = openDatabase(paths.dbFile, dataKey)
    runMigrations(db, migrations)
    const jobId = createJob({ db, paths, dataKey }, 'Barista').id
    const candidate = await addCandidateFromText(
      { db, paths, dataKey }, jobId, 'Alex Chen', 'this is the secret resume text'
    )

    const resumeTextRel = `${candidate.folderPath}/resume_text.md`
    const onDiskBefore = fs.readFileSync(path.join(tmp, resumeTextRel))
    expect(onDiskBefore.subarray(0, 4).equals(FILE_MAGIC)).toBe(true) // sanity: really encrypted on disk

    // Simulate the wrapped machine key living at dataRoot/.keys/master.key (key-provider.ts's
    // layout) - must never appear in the archive.
    fs.mkdirSync(path.join(tmp, '.keys'), { recursive: true })
    fs.writeFileSync(path.join(tmp, '.keys', 'master.key'), 'not-a-real-wrapped-key')

    const outFile = path.join(outDir, 'test.jpbak')
    const result = await createBackup({ db, paths, dataKey }, outFile, { passphrase: 'correct horse battery staple' })
    expect(result.encrypted).toBe(true)
    expect(result.path).toBe(outFile)

    const zipBytes = readBackup(outFile, { passphrase: 'correct horse battery staple' })
    const destDir = path.join(outDir, 'restored')
    await extractBackupTo(zipBytes, destDir)

    expect(header(path.join(destDir, 'jobpin.db')).startsWith('SQLite format 3')).toBe(true)

    const extractedResume = fs.readFileSync(path.join(destDir, resumeTextRel))
    expect(extractedResume.subarray(0, 4).equals(FILE_MAGIC)).toBe(false)
    expect(extractedResume.toString('utf8')).toBe('this is the secret resume text')

    expect(fs.existsSync(path.join(destDir, '.keys'))).toBe(false)
  })
})

describe('readBackup — wrong passphrase / corrupt bytes', () => {
  it('wrong passphrase throws the clean error', async () => {
    db = openDatabase(paths.dbFile)
    runMigrations(db, migrations)
    const outFile = path.join(outDir, 'wrongpass.jpbak')
    await createBackup({ db, paths }, outFile, { passphrase: 'right-passphrase' })

    expect(() => readBackup(outFile, { passphrase: 'WRONG-passphrase' })).toThrow(
      'wrong passphrase or corrupt backup'
    )
  })

  it('corrupt bytes throw the same clean error', async () => {
    db = openDatabase(paths.dbFile)
    runMigrations(db, migrations)
    const outFile = path.join(outDir, 'corrupt.jpbak')
    await createBackup({ db, paths }, outFile, { passphrase: 'right-passphrase' })

    const bytes = fs.readFileSync(outFile)
    bytes[bytes.length - 1] ^= 0xff // flip the last ciphertext byte -> GCM auth-tag mismatch
    fs.writeFileSync(outFile, bytes)

    expect(() => readBackup(outFile, { passphrase: 'right-passphrase' })).toThrow(
      'wrong passphrase or corrupt backup'
    )
  })

  it('a JPBK1 file read without a passphrase throws the same clean error', async () => {
    db = openDatabase(paths.dbFile)
    runMigrations(db, migrations)
    const outFile = path.join(outDir, 'nopass.jpbak')
    await createBackup({ db, paths }, outFile, { passphrase: 'right-passphrase' })

    expect(() => readBackup(outFile, {})).toThrow('wrong passphrase or corrupt backup')
  })

  it('a file that is neither JPBK1 nor a zip throws the same clean error', () => {
    const outFile = path.join(outDir, 'garbage.jpbak')
    fs.writeFileSync(outFile, 'not a backup at all')

    expect(() => readBackup(outFile, { passphrase: 'whatever' })).toThrow(
      'wrong passphrase or corrupt backup'
    )
  })
})

describe('createBackup — plain zip (no passphrase)', () => {
  it('writes a readable zip with plaintext candidate files inside', async () => {
    const dataKey = randomBytes(32)
    db = openDatabase(paths.dbFile, dataKey)
    runMigrations(db, migrations)
    const jobId = createJob({ db, paths, dataKey }, 'Chef').id
    const candidate = await addCandidateFromText({ db, paths, dataKey }, jobId, 'Sam Lee', 'plain zip test content')

    const outFile = path.join(outDir, 'plain.zip')
    const result = await createBackup({ db, paths, dataKey }, outFile, {})
    expect(result.encrypted).toBe(false)

    const zipBytes = readBackup(outFile, {})
    const zip = await JSZip.loadAsync(zipBytes)
    expect(Object.keys(zip.files)).toContain('jobpin.db')

    const resumeTextRel = `${candidate.folderPath}/resume_text.md`
    const entry = zip.file(resumeTextRel)
    expect(entry).not.toBeNull()
    const content = await entry!.async('nodebuffer')
    expect(content.toString('utf8')).toBe('plain zip test content')
    expect(content.subarray(0, 4).equals(FILE_MAGIC)).toBe(false)
  })
})

describe('createBackup — keyless data dir', () => {
  it('backs up an already-plaintext (keyless) data dir without error', async () => {
    db = openDatabase(paths.dbFile)
    runMigrations(db, migrations)
    const jobId = createJob({ db, paths }, 'Barback').id
    await addCandidateFromText({ db, paths }, jobId, 'Jo', 'keyless resume content')

    const outFile = path.join(outDir, 'keyless.zip')
    const result = await createBackup({ db, paths }, outFile, {})
    expect(result.encrypted).toBe(false)
    expect(fs.existsSync(outFile)).toBe(true)

    const zipBytes = readBackup(outFile, {})
    const destDir = path.join(outDir, 'restored-keyless')
    await extractBackupTo(zipBytes, destDir)
    expect(fs.existsSync(path.join(destDir, 'jobpin.db'))).toBe(true)
  })
})

describe('applyRestoreInPlace — content-replace restore (no directory rename)', () => {
  // A populated live data folder + a valid staged tree as a sibling. `.keys/` holds the machine
  // key and must survive the restore (the archive never carries it).
  function seed(): { dataRoot: string; staging: string } {
    const dataRoot = path.join(outDir, 'live-data')
    fs.mkdirSync(path.join(dataRoot, 'jobs', 'Old Job'), { recursive: true })
    fs.mkdirSync(path.join(dataRoot, '.keys'), { recursive: true })
    fs.writeFileSync(path.join(dataRoot, 'jobpin.db'), 'ORIGINAL-DB')
    fs.writeFileSync(path.join(dataRoot, 'jobs', 'Old Job', 'jd.md'), 'old jd')
    fs.writeFileSync(path.join(dataRoot, '.keys', 'master.key'), 'THE-MACHINE-KEY')
    const staging = `${dataRoot}.incoming-restore-1`
    fs.mkdirSync(path.join(staging, 'jobs', 'New Job'), { recursive: true })
    fs.writeFileSync(path.join(staging, 'jobpin.db'), 'RESTORED-DB')
    fs.writeFileSync(path.join(staging, 'jobs', 'New Job', 'jd.md'), 'new jd')
    return { dataRoot, staging }
  }

  it('rejects a staged tree missing jobpin.db and leaves the live data folder untouched', () => {
    const dataRoot = path.join(outDir, 'live-data')
    fs.mkdirSync(dataRoot, { recursive: true })
    fs.writeFileSync(path.join(dataRoot, 'jobpin.db'), 'ORIGINAL-DB')
    const bad = `${dataRoot}.incoming-restore-1`
    fs.mkdirSync(bad, { recursive: true })
    fs.writeFileSync(path.join(bad, 'notes.txt'), 'not a jobpin backup') // no jobpin.db

    expect(() => applyRestoreInPlace(dataRoot, bad, { nowMs: 1 })).toThrowError(/missing jobpin\.db/)
    expect(fs.readFileSync(path.join(dataRoot, 'jobpin.db'), 'utf8')).toBe('ORIGINAL-DB')
    expect(fs.existsSync(`${dataRoot}.pre-restore-1`)).toBe(false)
    expect(assertValidRestoreTree).toBeTypeOf('function')
  })

  it('replaces contents in place, preserves .keys, and keeps a full .pre-restore copy — no dir rename', () => {
    const { dataRoot, staging } = seed()
    const renameCalls: string[] = []
    const realRename = fs.renameSync
    // Fail on ANY directory rename to prove the implementation never renames a directory
    // (the exact operation OneDrive/AV block on the affected machine).
    ;(fs as unknown as { renameSync: typeof fs.renameSync }).renameSync = ((from: string, to: string) => {
      renameCalls.push(`${from} -> ${to}`)
      if (fs.existsSync(from) && fs.statSync(from).isDirectory()) throw new Error('EPERM: directory rename blocked')
      return realRename(from, to)
    }) as typeof fs.renameSync
    try {
      const pre = applyRestoreInPlace(dataRoot, staging, { nowMs: 42 })

      // Restored content is in place; the old job is gone; the machine key survived.
      expect(fs.readFileSync(path.join(dataRoot, 'jobpin.db'), 'utf8')).toBe('RESTORED-DB')
      expect(fs.existsSync(path.join(dataRoot, 'jobs', 'New Job', 'jd.md'))).toBe(true)
      expect(fs.existsSync(path.join(dataRoot, 'jobs', 'Old Job'))).toBe(false)
      expect(fs.readFileSync(path.join(dataRoot, '.keys', 'master.key'), 'utf8')).toBe('THE-MACHINE-KEY')
      // Full safety copy of the ORIGINAL kept, incl. its key; staging consumed.
      expect(pre).toBe(`${dataRoot}.pre-restore-42`)
      expect(fs.readFileSync(path.join(pre, 'jobpin.db'), 'utf8')).toBe('ORIGINAL-DB')
      expect(fs.existsSync(path.join(pre, '.keys', 'master.key'))).toBe(true)
      expect(fs.existsSync(staging)).toBe(false)
    } finally {
      ;(fs as unknown as { renameSync: typeof fs.renameSync }).renameSync = realRename
    }
  })

  it('re-run is retry-safe: does not overwrite an existing .pre-restore copy', () => {
    const { dataRoot, staging } = seed()
    // Pretend a prior attempt already saved the good safety copy.
    const pre = `${dataRoot}.pre-restore-42`
    fs.mkdirSync(pre, { recursive: true })
    fs.writeFileSync(path.join(pre, 'jobpin.db'), 'FIRST-ATTEMPT-ORIGINAL')

    applyRestoreInPlace(dataRoot, staging, { nowMs: 42 })

    // The pre-existing safety copy is untouched (not clobbered by the now-in-progress data).
    expect(fs.readFileSync(path.join(pre, 'jobpin.db'), 'utf8')).toBe('FIRST-ATTEMPT-ORIGINAL')
    expect(fs.readFileSync(path.join(dataRoot, 'jobpin.db'), 'utf8')).toBe('RESTORED-DB')
  })
})

describe('stageRestore / applyPendingRestore — restore applied at boot, not in-process', () => {
  // A "backup zip" whose extracted tree is a valid Jobpin data folder (has jobpin.db).
  async function backupZip(marker: string): Promise<Buffer> {
    const zip = new JSZip()
    zip.file('jobpin.db', Buffer.from('RESTORED-DB'))
    zip.file('sentinel.txt', marker)
    return zip.generateAsync({ type: 'nodebuffer' })
  }

  it('stageRestore extracts to a sibling and writes the pending marker without touching dataRoot', async () => {
    const dataRoot = path.join(outDir, 'live-data')
    fs.mkdirSync(dataRoot, { recursive: true })
    fs.writeFileSync(path.join(dataRoot, 'sentinel.txt'), 'ORIGINAL')

    const staging = await stageRestore(dataRoot, await backupZip('FROM-BACKUP'), { nowMs: 5 })

    // Live folder untouched; staging exists as a sibling; marker points at it.
    expect(fs.readFileSync(path.join(dataRoot, 'sentinel.txt'), 'utf8')).toBe('ORIGINAL')
    expect(staging).toBe(`${dataRoot}.incoming-restore-5`)
    expect(fs.existsSync(path.join(staging, 'jobpin.db'))).toBe(true)
    const marker = path.join(path.dirname(dataRoot), RESTORE_MARKER)
    expect(fs.readFileSync(marker, 'utf8')).toBe(staging)
    fs.rmSync(marker, { force: true }) // don't leak into other tests sharing outDir's parent
  })

  it('stageRestore rejects a non-Jobpin archive (no jobpin.db) and writes no marker', async () => {
    const dataRoot = path.join(outDir, 'live-data')
    fs.mkdirSync(dataRoot, { recursive: true })
    const zip = new JSZip()
    zip.file('random.txt', 'not a backup')
    await expect(stageRestore(dataRoot, await zip.generateAsync({ type: 'nodebuffer' }), { nowMs: 5 })).rejects.toThrowError(
      /missing jobpin\.db/
    )
    expect(fs.existsSync(path.join(path.dirname(dataRoot), RESTORE_MARKER))).toBe(false)
  })

  it('applyPendingRestore swaps the staged tree in, keeps the original as .pre-restore, clears the marker', async () => {
    const dataRoot = path.join(outDir, 'live-data')
    fs.mkdirSync(dataRoot, { recursive: true })
    fs.writeFileSync(path.join(dataRoot, 'sentinel.txt'), 'ORIGINAL')
    await stageRestore(dataRoot, await backupZip('FROM-BACKUP'), { nowMs: 5 })

    const result = applyPendingRestore(dataRoot, { nowMs: 9 })

    expect(result.applied).toBe(true)
    expect(fs.readFileSync(path.join(dataRoot, 'sentinel.txt'), 'utf8')).toBe('FROM-BACKUP') // restored
    expect(fs.readFileSync(path.join(dataRoot, 'jobpin.db'), 'utf8')).toBe('RESTORED-DB')
    expect(fs.readFileSync(path.join(`${dataRoot}.pre-restore-9`, 'sentinel.txt'), 'utf8')).toBe('ORIGINAL') // kept
    expect(fs.existsSync(path.join(path.dirname(dataRoot), RESTORE_MARKER))).toBe(false) // cleared
  })

  it('applyPendingRestore is a no-op when no marker is present', () => {
    const dataRoot = path.join(outDir, 'live-data')
    fs.mkdirSync(dataRoot, { recursive: true })
    fs.writeFileSync(path.join(dataRoot, 'sentinel.txt'), 'ORIGINAL')
    expect(applyPendingRestore(dataRoot, { nowMs: 9 }).applied).toBe(false)
    expect(fs.readFileSync(path.join(dataRoot, 'sentinel.txt'), 'utf8')).toBe('ORIGINAL')
  })

  it('applyPendingRestore ignores a stale marker whose staging dir is gone', () => {
    const dataRoot = path.join(outDir, 'live-data')
    fs.mkdirSync(dataRoot, { recursive: true })
    const marker = path.join(path.dirname(dataRoot), RESTORE_MARKER)
    fs.writeFileSync(marker, `${dataRoot}.incoming-restore-vanished`, 'utf8') // points nowhere
    expect(applyPendingRestore(dataRoot, { nowMs: 9 }).applied).toBe(false)
    expect(fs.existsSync(marker)).toBe(false) // stale marker cleaned up
  })
})
