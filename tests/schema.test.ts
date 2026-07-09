import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase, runMigrations, getSchemaVersion, type DB } from '../src/server/db'
import { migrations } from '../src/server/migrations'

let tmp: string
let db: DB

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jobpin-schema-'))
  db = openDatabase(path.join(tmp, 'jobpin.db'))
  runMigrations(db, migrations)
})

afterEach(() => {
  db.close()
  fs.rmSync(tmp, { recursive: true, force: true })
})

const EXPECTED_TABLES = [
  'ai_analyses', 'candidate_documents', 'candidates', 'documents', 'emails',
  'interview_answers', 'interview_questions', 'interviews', 'jobs',
  'memory_events', 'migrations', 'ranking_items', 'rankings', 'settings'
].sort()

describe('migration 0001', () => {
  it('creates exactly the 13 PRD tables plus migrations bookkeeping', () => {
    const tables = (db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[]).map(r => r.name).sort()
    expect(tables).toEqual(EXPECTED_TABLES)
    expect(getSchemaVersion(db)).toBe(1)
  })

  it('creates an index on every FK column', () => {
    const indices = (db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'")
      .all() as { name: string }[]).map(r => r.name).sort()
    expect(indices).toEqual([
      'idx_ai_analyses_candidate_id', 'idx_ai_analyses_job_id',
      'idx_candidate_documents_candidate_id', 'idx_candidates_job_id',
      'idx_documents_candidate_id', 'idx_emails_candidate_id',
      'idx_interview_answers_question_id', 'idx_interview_questions_interview_id',
      'idx_interviews_candidate_id', 'idx_ranking_items_candidate_id',
      'idx_ranking_items_ranking_id', 'idx_rankings_job_id'
    ].sort())
  })

  it('enforces foreign keys', () => {
    expect(() =>
      db.prepare("INSERT INTO candidates (job_id, name) VALUES (999, 'ghost')").run()
    ).toThrow(/FOREIGN KEY/)
  })

  it('ranking snapshots are immutable: UPDATE and DELETE abort (PRD 11.1-5)', () => {
    db.prepare("INSERT INTO jobs (name, folder_path) VALUES ('Sales Manager', 'jobs/Sales Manager')").run()
    db.prepare("INSERT INTO candidates (job_id, name) VALUES (1, 'Alex')").run()
    db.prepare("INSERT INTO rankings (job_id, criteria, reason) VALUES (1, '[\"jd_fit\"]', 'initial')").run()
    db.prepare("INSERT INTO ranking_items (ranking_id, candidate_id, rank, score, reason) VALUES (1, 1, 1, 86.0, 'strong')").run()

    expect(() => db.prepare("UPDATE rankings SET reason = 'edited' WHERE id = 1").run()).toThrow(/immutable/)
    expect(() => db.prepare('DELETE FROM rankings WHERE id = 1').run()).toThrow(/immutable/)
    expect(() => db.prepare('UPDATE ranking_items SET score = 99 WHERE id = 1').run()).toThrow(/immutable/)
    expect(() => db.prepare('DELETE FROM ranking_items WHERE id = 1').run()).toThrow(/immutable/)
  })

  it('inserts get ISO-8601 timestamps by default', () => {
    db.prepare("INSERT INTO jobs (name, folder_path) VALUES ('Barista', 'jobs/Barista')").run()
    const row = db.prepare('SELECT created_at FROM jobs WHERE name = ?').get('Barista') as { created_at: string }
    expect(row.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })
})
