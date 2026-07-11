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
import { createBackup, readBackup, extractBackupTo, restoreSwap, assertValidRestoreTree } from '../src/server/backup'
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

describe('restoreSwap — crash-safe restore', () => {
  // A live data folder with a sentinel, plus a valid extracted tree (has jobpin.db) as a sibling.
  function seed(): { dataRoot: string; extracted: string } {
    const dataRoot = path.join(outDir, 'live-data')
    fs.mkdirSync(dataRoot, { recursive: true })
    fs.writeFileSync(path.join(dataRoot, 'sentinel.txt'), 'ORIGINAL')
    const extracted = `${dataRoot}.restore-tmp-1`
    fs.mkdirSync(extracted, { recursive: true })
    fs.writeFileSync(path.join(extracted, 'jobpin.db'), 'RESTORED-DB')
    fs.writeFileSync(path.join(extracted, 'sentinel.txt'), 'RESTORED')
    return { dataRoot, extracted }
  }

  it('rejects an archive missing jobpin.db and leaves the live data folder untouched', () => {
    const dataRoot = path.join(outDir, 'live-data')
    fs.mkdirSync(dataRoot, { recursive: true })
    fs.writeFileSync(path.join(dataRoot, 'sentinel.txt'), 'ORIGINAL')
    const bad = `${dataRoot}.restore-tmp-1`
    fs.mkdirSync(bad, { recursive: true })
    fs.writeFileSync(path.join(bad, 'notes.txt'), 'not a jobpin backup') // no jobpin.db

    expect(() => restoreSwap(dataRoot, bad, { nowMs: 1 })).toThrowError(/missing jobpin\.db/)
    // Live data untouched — never renamed aside.
    expect(fs.readFileSync(path.join(dataRoot, 'sentinel.txt'), 'utf8')).toBe('ORIGINAL')
    expect(fs.existsSync(`${dataRoot}.pre-restore-1`)).toBe(false)
    expect(assertValidRestoreTree).toBeTypeOf('function')
  })

  it('swaps the restored tree into place and keeps the original as a .pre-restore sibling', () => {
    const { dataRoot, extracted } = seed()
    const pre = restoreSwap(dataRoot, extracted, { nowMs: 42 })

    expect(fs.readFileSync(path.join(dataRoot, 'sentinel.txt'), 'utf8')).toBe('RESTORED')
    expect(fs.readFileSync(path.join(dataRoot, 'jobpin.db'), 'utf8')).toBe('RESTORED-DB')
    expect(pre).toBe(`${dataRoot}.pre-restore-42`)
    expect(fs.readFileSync(path.join(pre, 'sentinel.txt'), 'utf8')).toBe('ORIGINAL') // recoverable copy kept
    expect(fs.existsSync(extracted)).toBe(false) // moved, not copied
  })

  it('rolls back to the original data folder when the second move fails (compensation)', () => {
    const { dataRoot, extracted } = seed()
    let calls = 0
    // Real rename on the first (dataRoot→pre) and third (pre→dataRoot compensation) calls;
    // throw on the second (extracted→dataRoot) to simulate an EXDEV/EPERM mid-swap failure.
    const renameFn = (from: string, to: string): void => {
      calls += 1
      if (calls === 2) throw new Error('simulated rename failure')
      fs.renameSync(from, to)
    }
    expect(() => restoreSwap(dataRoot, extracted, { nowMs: 7, renameFn })).toThrowError(/simulated rename failure/)

    // The original data folder is back in place — the boss is never left without one.
    expect(fs.existsSync(dataRoot)).toBe(true)
    expect(fs.readFileSync(path.join(dataRoot, 'sentinel.txt'), 'utf8')).toBe('ORIGINAL')
    expect(fs.existsSync(`${dataRoot}.pre-restore-7`)).toBe(false) // renamed back, not left behind
    expect(calls).toBe(3) // aside → failed move → compensation
  })
})
