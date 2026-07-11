import Database from 'better-sqlite3-multiple-ciphers'
import { readFileSync } from 'node:fs'

export type DB = InstanceType<typeof Database>

export interface Migration {
  id: number
  name: string
  sql: string
}

/**
 * Opens the SQLite database file, applying the standard pragmas.
 *
 * When `key` (32 raw bytes) is given, the connection is keyed via
 * `PRAGMA hexkey` — a raw-hex key, applied as the FIRST statement on the
 * connection, before any other pragma or query (SQLite3MultipleCiphers
 * requires this ordering). Because `hexkey` only sets the cipher context —
 * it does not itself verify the key — the very next statement is a probe
 * read that surfaces a wrong key or an unreadable file immediately instead
 * of silently returning an empty database.
 *
 * If that probe fails, the file is checked for a plaintext SQLite header:
 *   - plaintext -> one-time in-place upgrade: reopen keyless, `PRAGMA hexrekey`
 *     to encrypt under the new key, close, then reopen keyed (this recursive
 *     call takes the normal keyed path above and succeeds).
 *   - anything else (wrong key, corrupt file) -> throw loudly; never return a
 *     connection that looks open but is actually unreadable.
 *
 * Keyless behaviour (key === undefined) is exactly as before this feature.
 */
export function openDatabase(dbFile: string, key?: Buffer): DB {
  const db = new Database(dbFile)
  if (key) {
    const hex = key.toString('hex')
    db.pragma(`hexkey = '${hex}'`) // must be the first statement on this connection
    try {
      db.prepare('SELECT count(*) FROM sqlite_master').get()
    } catch {
      db.close()
      const header = readFileSync(dbFile).subarray(0, 16).toString('latin1')
      if (!header.startsWith('SQLite format 3')) {
        throw new Error('database is neither readable with the data key nor plaintext - refusing to touch it')
      }
      const plain = new Database(dbFile)
      plain.pragma(`hexrekey = '${hex}'`)
      plain.close()
      return openDatabase(dbFile, key) // reopen keyed
    }
  }
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
