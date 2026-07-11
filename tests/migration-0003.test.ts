import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase, runMigrations, getSchemaVersion } from '../src/server/db'
import { migrations } from '../src/server/migrations'

describe('migration 0003', () => {
  it('applies over 0001 and 0002 and records id 3', () => {
    const db = openDatabase(join(mkdtempSync(join(tmpdir(), 'jobpin-m3-')), 'test.db'))
    runMigrations(db, migrations)
    expect(getSchemaVersion(db)).toBe(3)
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r: any) => r.name)
    expect(tables).toContain('memory_events')

    // Check that status column exists with correct default
    const columns = db.prepare("PRAGMA table_info(memory_events)").all() as any[]
    const statusCol = columns.find((c) => c.name === 'status')
    expect(statusCol).toBeTruthy()
    expect(statusCol?.notnull).toBe(1) // NOT NULL
    expect(statusCol?.dflt_value).toBe("'pending'") // DEFAULT 'pending'

    // Check that index exists
    const indexes = db.prepare("PRAGMA index_list(memory_events)").all() as any[]
    const scopeIndex = indexes.find((idx) => idx.name === 'idx_memory_events_scope')
    expect(scopeIndex).toBeTruthy()

    db.close()
  })

  it('is idempotent (re-run is a no-op)', () => {
    const db = openDatabase(join(mkdtempSync(join(tmpdir(), 'jobpin-m3b-')), 'test.db'))
    runMigrations(db, migrations)
    runMigrations(db, migrations)
    expect(getSchemaVersion(db)).toBe(3)
    db.close()
  })

  it('memory_events defaults status=pending and approved_by_boss=0', () => {
    const db = openDatabase(join(mkdtempSync(join(tmpdir(), 'jobpin-m3c-')), 'test.db'))
    runMigrations(db, migrations)
    db.prepare("INSERT INTO jobs (name, folder_path, jd_path, inject_path) VALUES ('j','jobs/j','jobs/j/jd.md','jobs/j/inject.md')").run()
    db.prepare("INSERT INTO memory_events (scope, content) VALUES ('job', '{}')").run()
    const row = db.prepare('SELECT * FROM memory_events').get() as any
    expect(row.status).toBe('pending')
    expect(row.approved_by_boss).toBe(0)
    db.close()
  })
})
