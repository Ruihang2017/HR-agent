import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase, runMigrations, getSchemaVersion, type DB } from '../src/server/db'
import { migrations } from '../src/server/migrations'

function freshDb(): DB {
  const db = openDatabase(join(mkdtempSync(join(tmpdir(), 'jobpin-m4-')), 'test.db'))
  runMigrations(db, migrations)
  return db
}

/** Seeds one job/candidate row (call at most once per db). */
function seedJobAndCandidate(db: DB): void {
  db.prepare("INSERT INTO jobs (name, folder_path) VALUES ('Sales Manager', 'jobs/Sales Manager')").run()
  db.prepare("INSERT INTO candidates (job_id, name) VALUES (1, 'Alex')").run()
}

/** Seeds one ranking/ranking_item snapshot against job 1 / candidate 1; safe to call repeatedly. */
function seedSnapshot(db: DB): { rankingId: number; itemId: number } {
  const rankingInfo = db
    .prepare("INSERT INTO rankings (job_id, criteria, reason) VALUES (1, '[\"jd_fit\"]', 'initial')")
    .run()
  const rankingId = Number(rankingInfo.lastInsertRowid)
  const itemInfo = db
    .prepare('INSERT INTO ranking_items (ranking_id, candidate_id, rank, score, reason) VALUES (?, 1, 1, 86.0, ?)')
    .run(rankingId, 'strong')
  const itemId = Number(itemInfo.lastInsertRowid)
  return { rankingId, itemId }
}

describe('migration 0004', () => {
  it('1. applies over 0001-0003 to version 4; flags table + all four triggers exist', () => {
    const db = freshDb()
    expect(getSchemaVersion(db)).toBe(4)

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r: any) => r.name)
    expect(tables).toContain('maintenance_flags')

    const triggers = db.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all().map((r: any) => r.name)
    expect(triggers).toEqual(
      expect.arrayContaining([
        'trg_rankings_immutable_update',
        'trg_rankings_immutable_delete',
        'trg_ranking_items_immutable_update',
        'trg_ranking_items_immutable_delete'
      ])
    )
    db.close()
  })

  it('2. WITHOUT any flag: every write path still aborts (PRD 11.1-5 regression)', () => {
    const db = freshDb()
    seedJobAndCandidate(db)
    const { rankingId, itemId } = seedSnapshot(db)

    expect(() => db.prepare("UPDATE rankings SET reason = 'edited' WHERE id = ?").run(rankingId))
      .toThrow(/immutable/)
    expect(() => db.prepare("UPDATE ranking_items SET reason = 'edited' WHERE id = ?").run(itemId))
      .toThrow(/immutable/)
    expect(() => db.prepare('DELETE FROM rankings WHERE id = ?').run(rankingId))
      .toThrow(/immutable/)
    expect(() => db.prepare('DELETE FROM ranking_items WHERE id = ?').run(itemId))
      .toThrow(/immutable/)
    db.close()
  })

  it("3. WITH 'allow-reason-scrub': reason-only UPDATE on ranking_items succeeds; score change still aborts; rankings UPDATE still aborts regardless", () => {
    const db = freshDb()
    seedJobAndCandidate(db)
    const { rankingId, itemId } = seedSnapshot(db)
    db.prepare("INSERT INTO maintenance_flags (flag) VALUES ('allow-reason-scrub')").run()

    expect(() => db.prepare("UPDATE ranking_items SET reason = 'scrubbed' WHERE id = ?").run(itemId))
      .not.toThrow()
    const row = db.prepare('SELECT reason FROM ranking_items WHERE id = ?').get(itemId) as { reason: string }
    expect(row.reason).toBe('scrubbed')

    expect(() => db.prepare('UPDATE ranking_items SET score = 99, reason = ? WHERE id = ?').run('x', itemId))
      .toThrow(/immutable/)
    expect(() => db.prepare("UPDATE rankings SET reason = 'edited' WHERE id = ?").run(rankingId))
      .toThrow(/immutable/)
    db.close()
  })

  it("4. WITH 'allow-snapshot-delete': DELETE ranking_items + rankings succeed; removing the flag restores the abort", () => {
    const db = freshDb()
    seedJobAndCandidate(db)
    const seeded = seedSnapshot(db)
    db.prepare("INSERT INTO maintenance_flags (flag) VALUES ('allow-snapshot-delete')").run()

    expect(() => db.prepare('DELETE FROM ranking_items WHERE id = ?').run(seeded.itemId)).not.toThrow()
    expect(() => db.prepare('DELETE FROM rankings WHERE id = ?').run(seeded.rankingId)).not.toThrow()
    expect(db.prepare('SELECT * FROM rankings WHERE id = ?').get(seeded.rankingId)).toBeUndefined()

    db.prepare("DELETE FROM maintenance_flags WHERE flag = 'allow-snapshot-delete'").run()
    const again = seedSnapshot(db)
    expect(() => db.prepare('DELETE FROM ranking_items WHERE id = ?').run(again.itemId)).toThrow(/immutable/)
    expect(() => db.prepare('DELETE FROM rankings WHERE id = ?').run(again.rankingId)).toThrow(/immutable/)
    db.close()
  })
})
