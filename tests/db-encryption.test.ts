import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { openDatabase, runMigrations, type Migration } from '../src/server/db'
import { rmrfWithRetry } from './helpers'

let tmp: string
let dbFile: string

const M1: Migration = {
  id: 1,
  name: 'create_a',
  sql: 'CREATE TABLE a (id INTEGER PRIMARY KEY, v TEXT NOT NULL);'
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jobpin-db-enc-'))
  dbFile = path.join(tmp, 'test.db')
})

afterEach(() => {
  rmrfWithRetry(tmp)
})

/** Raw on-disk header — plaintext SQLite files always start with this magic. */
function header(file: string): string {
  return fs.readFileSync(file).subarray(0, 16).toString('latin1')
}

describe('openDatabase — new keyed database', () => {
  it('creates a keyed DB, runs migrations, and the raw file is not plaintext', () => {
    const key = randomBytes(32)

    let db = openDatabase(dbFile, key)
    runMigrations(db, [M1])
    db.prepare('INSERT INTO a (v) VALUES (?)').run('hello')
    db.close()

    expect(header(dbFile).startsWith('SQLite format 3')).toBe(false)

    // reopen with the key — data survives
    db = openDatabase(dbFile, key)
    const row = db.prepare('SELECT v FROM a WHERE id = 1').get() as { v: string }
    expect(row.v).toBe('hello')
    db.close()
  })
})

describe('openDatabase — plaintext upgrade (one-time auto-rekey)', () => {
  it('encrypts an existing plaintext DB in place on first keyed open, then behaves as a normal keyed open thereafter', () => {
    const key = randomBytes(32)

    // 1. create keyless, write a row.
    let db = openDatabase(dbFile)
    runMigrations(db, [M1])
    db.prepare('INSERT INTO a (v) VALUES (?)').run('plain-row')
    db.close()
    expect(header(dbFile).startsWith('SQLite format 3')).toBe(true)

    // 2. reopen WITH a key -> auto-rekey; row must still be present.
    db = openDatabase(dbFile, key)
    const row = db.prepare('SELECT v FROM a WHERE id = 1').get() as { v: string }
    expect(row.v).toBe('plain-row')
    db.close()
    expect(header(dbFile).startsWith('SQLite format 3')).toBe(false)

    // 3. third open (keyed) is a plain success — no re-rekey attempted.
    db = openDatabase(dbFile, key)
    const row2 = db.prepare('SELECT v FROM a WHERE id = 1').get() as { v: string }
    expect(row2.v).toBe('plain-row')
    db.close()
  })
})

describe('openDatabase — wrong key', () => {
  it('fails loudly instead of silently opening an empty database', () => {
    const key = randomBytes(32)
    const wrongKey = randomBytes(32)

    let db = openDatabase(dbFile, key)
    runMigrations(db, [M1])
    db.prepare('INSERT INTO a (v) VALUES (?)').run('secret')
    db.close()

    expect(() => openDatabase(dbFile, wrongKey)).toThrow(/refusing to touch it/)
  })
})

describe('openDatabase — keyless (unchanged)', () => {
  it('opens, applies the WAL/foreign_keys/busy_timeout pragmas, and migrates as before', () => {
    const db = openDatabase(dbFile)
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000)

    runMigrations(db, [M1])
    db.prepare('INSERT INTO a (v) VALUES (?)').run('x')
    db.close()

    expect(header(dbFile).startsWith('SQLite format 3')).toBe(true)
  })
})
