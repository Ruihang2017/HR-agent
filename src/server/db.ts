import Database from 'better-sqlite3'

export type DB = InstanceType<typeof Database>

export interface Migration {
  id: number
  name: string
  sql: string
}

export function openDatabase(dbFile: string): DB {
  const db = new Database(dbFile)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  return db
}

function ensureMigrationsTable(db: DB): void {
  db.exec(
    'CREATE TABLE IF NOT EXISTS migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)'
  )
}

export function getSchemaVersion(db: DB): number {
  ensureMigrationsTable(db)
  const row = db.prepare('SELECT MAX(id) AS v FROM migrations').get() as { v: number | null }
  return row.v ?? 0
}

/**
 * Applies pending migrations in id order, each inside its own transaction.
 * - ids must be 1..n without gaps (defends against typos in the list)
 * - a DB "from the future" (boss downgraded the app) fails loudly (spec section 5)
 */
export function runMigrations(db: DB, migrations: Migration[]): void {
  ensureMigrationsTable(db)
  const sorted = [...migrations].sort((a, b) => a.id - b.id)
  sorted.forEach((m, i) => {
    if (m.id !== i + 1) {
      throw new Error(`migration ids must be 1..n without gaps; found id ${m.id} at position ${i + 1}`)
    }
  })

  const current = getSchemaVersion(db)
  if (current > sorted.length) {
    throw new Error(
      `database schema version ${current} is newer than this app understands (${sorted.length}). ` +
        'Update Jobpin instead of downgrading.'
    )
  }

  const record = db.prepare(
    "INSERT INTO migrations (id, name, applied_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))"
  )
  for (const m of sorted.filter(m => m.id > current)) {
    db.transaction(() => {
      db.exec(m.sql)
      record.run(m.id, m.name)
    })()
  }
}
