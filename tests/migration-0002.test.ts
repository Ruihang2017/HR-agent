import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase, runMigrations, getSchemaVersion } from '../src/server/db'
import { migrations } from '../src/server/migrations'

describe('migration 0002', () => {
  it('applies over 0001 and records id 2', () => {
    const db = openDatabase(join(mkdtempSync(join(tmpdir(), 'jobpin-m2-')), 'test.db'))
    runMigrations(db, migrations)
    expect(getSchemaVersion(db)).toBe(3)
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r: any) => r.name)
    expect(tables).toContain('analysis_tasks')
    expect(tables).toContain('usage_events')
    db.close()
  })
  it('is idempotent (re-run is a no-op)', () => {
    const db = openDatabase(join(mkdtempSync(join(tmpdir(), 'jobpin-m2b-')), 'test.db'))
    runMigrations(db, migrations)
    runMigrations(db, migrations)
    expect(getSchemaVersion(db)).toBe(3)
    db.close()
  })
  it('analysis_tasks defaults status=queued and attempts=0', () => {
    const db = openDatabase(join(mkdtempSync(join(tmpdir(), 'jobpin-m2c-')), 'test.db'))
    runMigrations(db, migrations)
    db.prepare("INSERT INTO jobs (name, folder_path, jd_path, inject_path) VALUES ('j','jobs/j','jobs/j/jd.md','jobs/j/inject.md')").run()
    db.prepare("INSERT INTO candidates (job_id, name, status) VALUES (1,'c','new')").run()
    db.prepare('INSERT INTO analysis_tasks (job_id, candidate_id) VALUES (1,1)').run()
    const row = db.prepare('SELECT * FROM analysis_tasks').get() as any
    expect(row.status).toBe('queued')
    expect(row.attempts).toBe(0)
    expect(row.created_at).toBeTruthy()
    db.close()
  })
})
