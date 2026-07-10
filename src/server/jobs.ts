import fs from 'node:fs'
import path from 'node:path'
import type { DB } from './db'
import type { JobpinPaths } from './paths'
import { deriveFolderName } from './naming'
import { renameSyncWithRetry } from './fsx'
import { ConflictError, NotFoundError, ValidationError } from './errors'

export interface JobsDeps {
  db: DB
  paths: JobpinPaths
}

export interface JobSummary {
  id: number
  name: string
  candidateCount: number
  createdAt: string
}

export interface JobDetail {
  id: number
  name: string
  folderPath: string
  jd: string | null
  createdAt: string
}

/** Skeleton files per PRD section 8.2 / spec section 4. Never overwrites. */
const SKELETON_FILES: Array<[rel: string, content: string]> = [
  ['inject.md', ''],
  ['references/interview_rules.md', ''],
  ['references/legal_notes.md', ''],
  ['references/company_context.md', ''],
  ['question_bank.json', '{"questions": []}\n'],
  ['learned_skills.md', '']
]

export function existingFolderNames(paths: JobpinPaths): string[] {
  if (!fs.existsSync(paths.jobsDir)) return []
  return fs
    .readdirSync(paths.jobsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
}

export function createJob(deps: JobsDeps, name: string, jd?: string): JobDetail {
  const { db, paths } = deps
  const displayName = (name ?? '').trim()
  if (!displayName) throw new ValidationError('job name is required')
  if (db.prepare('SELECT id FROM jobs WHERE name = ?').get(displayName)) {
    throw new ConflictError(`a job named "${displayName}" already exists`)
  }

  const folderName = deriveFolderName(displayName, existingFolderNames(paths))
  const folderRel = `jobs/${folderName}` // forward slashes in all stored paths
  const folderAbs = path.join(paths.dataRoot, folderRel)

  fs.mkdirSync(path.join(folderAbs, 'references'), { recursive: true })
  fs.mkdirSync(path.join(folderAbs, 'candidates'), { recursive: true })
  fs.writeFileSync(path.join(folderAbs, 'jd.md'), jd ?? '', 'utf8')
  for (const [rel, content] of SKELETON_FILES) {
    fs.writeFileSync(path.join(folderAbs, rel), content, 'utf8')
  }

  try {
    const info = db
      .prepare('INSERT INTO jobs (name, folder_path, jd_path, inject_path) VALUES (?, ?, ?, ?)')
      .run(displayName, folderRel, `${folderRel}/jd.md`, `${folderRel}/inject.md`)
    return getJob(deps, Number(info.lastInsertRowid))
  } catch (e) {
    fs.rmSync(folderAbs, { recursive: true, force: true }) // no half-created jobs
    // Defense-in-depth: translate a UNIQUE-constraint race into the typed contract.
    if (e instanceof Error && 'code' in e && (e as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') {
      throw new ConflictError(`a job named "${displayName}" already exists`)
    }
    throw e
  }
}

export function listJobs({ db }: JobsDeps): JobSummary[] {
  return db
    .prepare(
      `SELECT j.id, j.name, j.created_at AS createdAt,
              (SELECT COUNT(*) FROM candidates c WHERE c.job_id = j.id) AS candidateCount
       FROM jobs j ORDER BY j.created_at DESC, j.id DESC`
    )
    .all() as JobSummary[]
}

export function getJob({ db, paths }: JobsDeps, id: number): JobDetail {
  const row = db
    .prepare('SELECT id, name, folder_path, jd_path, created_at FROM jobs WHERE id = ?')
    .get(id) as { id: number; name: string; folder_path: string; jd_path: string; created_at: string } | undefined
  if (!row) throw new NotFoundError(`job ${id} not found`)
  const jdAbs = path.join(paths.dataRoot, row.jd_path)
  const jdRaw = fs.existsSync(jdAbs) ? fs.readFileSync(jdAbs, 'utf8') : ''
  return {
    id: row.id,
    name: row.name,
    folderPath: row.folder_path,
    jd: jdRaw.trim() === '' ? null : jdRaw, // empty jd.md → "no JD yet"
    createdAt: row.created_at
  }
}

export function setJd({ db, paths }: JobsDeps, id: number, text: string): string {
  const row = db.prepare('SELECT jd_path FROM jobs WHERE id = ?').get(id) as { jd_path: string } | undefined
  if (!row) throw new NotFoundError(`job ${id} not found`)
  fs.writeFileSync(path.join(paths.dataRoot, row.jd_path), text, 'utf8')
  return text
}

/** Every column that stores a jobpin-data-relative path (spec section 5 step 4). */
const PATH_COLUMNS: Array<[table: string, column: string]> = [
  ['jobs', 'folder_path'],
  ['jobs', 'jd_path'],
  ['jobs', 'inject_path'],
  ['candidate_documents', 'file_path'],
  ['candidate_documents', 'extracted_text_path'],
  ['interviews', 'transcript_path'],
  ['interviews', 'summary_path'],
  ['ai_analyses', 'output_path'],
  ['emails', 'file_path'],
  ['documents', 'file_path']
]

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, m => '\\' + m)
}

export function renameJob(deps: JobsDeps, id: number, newName: string): JobDetail {
  const { db, paths } = deps
  const name = (newName ?? '').trim()
  if (!name) throw new ValidationError('job name is required')
  const row = db.prepare('SELECT id, name, folder_path FROM jobs WHERE id = ?').get(id) as
    | { id: number; name: string; folder_path: string }
    | undefined
  if (!row) throw new NotFoundError(`job ${id} not found`)
  if (db.prepare('SELECT id FROM jobs WHERE name = ? AND id != ?').get(name, id)) {
    throw new ConflictError(`a job named "${name}" already exists`)
  }

  const oldFolderRel = row.folder_path
  const oldFolderName = oldFolderRel.slice('jobs/'.length)
  const others = existingFolderNames(paths).filter(n => n !== oldFolderName)
  const newFolderName = deriveFolderName(name, others)

  const touchName = db.prepare(
    "UPDATE jobs SET name = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?"
  )

  if (newFolderName.toLowerCase() === oldFolderName.toLowerCase()) {
    touchName.run(name, id) // display-name-only change; folder already correct
    return getJob(deps, id)
  }

  const newFolderRel = `jobs/${newFolderName}`
  const oldAbs = path.join(paths.dataRoot, oldFolderRel)
  const newAbs = path.join(paths.dataRoot, newFolderRel)

  renameSyncWithRetry(oldAbs, newAbs) // atomic on the same volume
  try {
    db.transaction(() => {
      touchName.run(name, id)
      for (const [table, column] of PATH_COLUMNS) {
        db.prepare(
          `UPDATE ${table}
             SET ${column} = ? || substr(${column}, ?)
           WHERE ${column} = ? OR ${column} LIKE ? ESCAPE '\\'`
        ).run(newFolderRel, oldFolderRel.length + 1, oldFolderRel, escapeLike(oldFolderRel) + '/%')
      }
    })()
  } catch (e) {
    try {
      renameSyncWithRetry(newAbs, oldAbs) // compensate: put the folder back
    } catch (compErr) {
      // Double failure: DB rolled back but the folder is still at the new name.
      // Surface the ROOT CAUSE (the DB error); log the divergence for manual repair.
      console.error(
        `rename compensation failed: folder left at "${newFolderRel}" while DB points at "${oldFolderRel}"`,
        compErr
      )
    }
    throw e
  }
  return getJob(deps, id)
}
