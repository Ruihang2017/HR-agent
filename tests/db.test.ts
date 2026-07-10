import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase, runMigrations, getSchemaVersion, type DB, type Migration } from '../src/server/db'

let tmp: string
let db: DB

const M1: Migration = { id: 1, name: 'create_a', sql: 'CREATE TABLE a (id INTEGER PRIMARY KEY);' }
const M2: Migration = { id: 2, name: 'create_b', sql: 'CREATE TABLE b (id INTEGER PRIMARY KEY);' }

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jobpin-db-'))
  db = openDatabase(path.join(tmp, 'test.db'))
})

afterEach(() => {
  db.close()
  fs.rmSync(tmp, { recursive: true, force: true })
})

function tableNames(d: DB): string[] {
  return (d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[])
    .map(r => r.name)
    .sort()
}

describe('openDatabase', () => {
  it('applies the required pragmas', () => {
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000)
  })
})

describe('runMigrations', () => {
  it('applies pending migrations in order and records them', () => {
    expect(getSchemaVersion(db)).toBe(0)
    runMigrations(db, [M1, M2])
    expect(getSchemaVersion(db)).toBe(2)
    expect(tableNames(db)).toEqual(['a', 'b', 'migrations'])
  })

  it('is a no-op when already up to date', () => {
    runMigrations(db, [M1, M2])
    runMigrations(db, [M1, M2])
    expect(getSchemaVersion(db)).toBe(2)
  })

  it('rolls back a failing migration atomically', () => {
    const bad: Migration = { id: 2, name: 'bad', sql: 'CREATE TABLE ok (id INTEGER); THIS IS NOT SQL;' }
    runMigrations(db, [M1])
    expect(() => runMigrations(db, [M1, bad])).toThrow()
    expect(getSchemaVersion(db)).toBe(1)
    expect(tableNames(db)).toEqual(['a', 'migrations'])
  })

  it('rejects gapped or misnumbered migration lists', () => {
    const m3: Migration = { id: 3, name: 'skip', sql: 'CREATE TABLE c (id INTEGER);' }
    expect(() => runMigrations(db, [M1, m3])).toThrow(/1\.\.n/)
  })

  it('fails loudly on a database newer than the app', () => {
    runMigrations(db, [M1, M2])
    expect(() => runMigrations(db, [M1])).toThrow(/newer than this app/)
  })
})
