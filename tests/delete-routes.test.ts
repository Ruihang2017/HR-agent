import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Hono } from 'hono'
import { getPaths, type JobpinPaths } from '../src/server/paths'
import { ensureScaffold } from '../src/server/scaffold'
import { openDatabase, runMigrations, type DB } from '../src/server/db'
import { migrations } from '../src/server/migrations'
import { createApp } from '../src/server/app'
import { rmrfWithRetry } from './helpers'

let tmp: string
let db: DB
let paths: JobpinPaths
let app: Hono

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jobpin-delete-routes-'))
  paths = getPaths(tmp)
  ensureScaffold(paths)
  db = openDatabase(paths.dbFile)
  runMigrations(db, migrations)
  app = createApp({ db, paths, version: '0.1.0' })
})

afterEach(() => {
  db.close()
  rmrfWithRetry(tmp)
})

const json = (body: unknown) => ({
  method: 'POST' as const,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
})

describe('DELETE /candidates/:id', () => {
  it('200 {deleted:true}; anonymises the row (survives, scrubbed) rather than removing it, but the API now 404s it (D-17 resurrection fix)', async () => {
    const { id: jobId } = await (await app.request('/jobs', json({ name: 'Barista' }))).json()
    const { id: candidateId, folderPath } = await (
      await app.request(`/jobs/${jobId}/candidates`, json({ name: 'Alex', text: 'resume text' }))
    ).json()
    const folderAbs = path.join(paths.dataRoot, folderPath)
    expect(fs.existsSync(folderAbs)).toBe(true)

    const res = await app.request(`/candidates/${candidateId}`, { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ deleted: true })

    // The row is anonymised at the DB level, not removed - kept for ranking_items FK integrity.
    const row = db.prepare('SELECT name, status, email FROM candidates WHERE id = ?').get(candidateId) as {
      name: string
      status: string
      email: string | null
    }
    expect(row.name).toBe('Deleted candidate')
    expect(row.status).toBe('deleted')
    expect(row.email).toBeNull()

    // But a follow-up GET now 404s: a deleted candidate must not resurface with live action
    // buttons on the detail page (the resurrection fix - getCandidate throws NotFoundError for
    // status='deleted').
    const after = await app.request(`/candidates/${candidateId}`)
    expect(after.status).toBe(404)

    // Filesystem folder for the candidate is gone.
    expect(fs.existsSync(folderAbs)).toBe(false)
  })

  it('404s for an unknown candidate id', async () => {
    expect((await app.request('/candidates/999999', { method: 'DELETE' })).status).toBe(404)
  })
})

describe('DELETE /jobs/:id', () => {
  it('200 {deleted:true}; fully removes the job, its candidates, and the folder', async () => {
    const { id: jobId, folderPath } = await (await app.request('/jobs', json({ name: 'Chef' }))).json()
    await app.request(`/jobs/${jobId}/candidates`, json({ name: 'Sam', text: 'resume text' }))
    const folderAbs = path.join(paths.dataRoot, folderPath)
    expect(fs.existsSync(folderAbs)).toBe(true)

    const res = await app.request(`/jobs/${jobId}`, { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ deleted: true })

    expect((await app.request(`/jobs/${jobId}`)).status).toBe(404)
    expect(fs.existsSync(folderAbs)).toBe(false)
  })

  it('404s for an unknown job id', async () => {
    expect((await app.request('/jobs/999999', { method: 'DELETE' })).status).toBe(404)
  })
})
