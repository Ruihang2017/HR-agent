import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Hono } from 'hono'
import { getPaths, type JobpinPaths } from '../src/server/paths'
import { ensureScaffold } from '../src/server/scaffold'
import { openDatabase, runMigrations, type DB } from '../src/server/db'
import { migrations } from '../src/server/migrations'
import { createApp } from '../src/server/app'
import { rmrfWithRetry } from './helpers'

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures')

let tmp: string
let db: DB
let paths: JobpinPaths
let app: Hono

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jobpin-routes-'))
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

describe('job routes', () => {
  it('POST /jobs creates; GET /jobs lists; GET /jobs/:id details', async () => {
    const created = await app.request('/jobs', json({ name: 'Barista', jd: 'Make coffee' }))
    expect(created.status).toBe(201)
    const { id } = await created.json()

    const list = await (await app.request('/jobs')).json()
    expect(list).toHaveLength(1)
    expect(list[0].candidateCount).toBe(0)

    const detail = await (await app.request(`/jobs/${id}`)).json()
    expect(detail.jd).toBe('Make coffee')
  })

  it('maps typed errors: 400 empty name, 409 duplicate, 404 unknown', async () => {
    expect((await app.request('/jobs', json({ name: ' ' }))).status).toBe(400)
    await app.request('/jobs', json({ name: 'Barista' }))
    expect((await app.request('/jobs', json({ name: 'Barista' }))).status).toBe(409)
    expect((await app.request('/jobs/999')).status).toBe(404)
  })

  it('PATCH /jobs/:id renames', async () => {
    const { id } = await (await app.request('/jobs', json({ name: 'Barsita' }))).json()
    const res = await app.request(`/jobs/${id}`, { ...json({ name: 'Barista' }), method: 'PATCH' })
    expect(res.status).toBe(200)
    expect((await res.json()).name).toBe('Barista')
  })

  it('PUT /jobs/:id/jd accepts text and multipart file', async () => {
    const { id } = await (await app.request('/jobs', json({ name: 'Barista' }))).json()
    const t = await app.request(`/jobs/${id}/jd`, { ...json({ text: 'JD v2' }), method: 'PUT' })
    expect(t.status).toBe(200)

    const fd = new FormData()
    fd.append('file', new File([fs.readFileSync(path.join(fixtures, 'sample.txt'))], 'jd.txt'))
    const f = await app.request(`/jobs/${id}/jd`, { method: 'PUT', body: fd })
    expect(f.status).toBe(200)
    expect((await f.json()).jd).toContain('espresso')
  })

  it('PUT /jobs/:id/jd returns 422 when file extraction fails', async () => {
    const { id } = await (await app.request('/jobs', json({ name: 'Barista' }))).json()
    const fd = new FormData()
    fd.append('file', new File([fs.readFileSync(path.join(fixtures, 'corrupt.pdf'))], 'jd.pdf'))
    expect((await app.request(`/jobs/${id}/jd`, { method: 'PUT', body: fd })).status).toBe(422)
  })
})

describe('candidate routes', () => {
  let jobId: number
  beforeEach(async () => {
    jobId = (await (await app.request('/jobs', json({ name: 'Barista' }))).json()).id
  })

  it('POST multipart file → 201; needs_review for empty pdf', async () => {
    const fd = new FormData()
    fd.append('file', new File([fs.readFileSync(path.join(fixtures, 'sample.pdf'))], 'Alex.pdf'))
    const ok = await app.request(`/jobs/${jobId}/candidates`, { method: 'POST', body: fd })
    expect(ok.status).toBe(201)
    expect((await ok.json()).status).toBe('new')

    const fd2 = new FormData()
    fd2.append('file', new File([fs.readFileSync(path.join(fixtures, 'empty.pdf'))], 'scan.pdf'))
    const flagged = await (await app.request(`/jobs/${jobId}/candidates`, { method: 'POST', body: fd2 })).json()
    expect(flagged.status).toBe('needs_review')
  })

  it('POST paste JSON → 201; 400 without name', async () => {
    const ok = await app.request(`/jobs/${jobId}/candidates`, json({ name: 'Pat', text: 'resume text' }))
    expect(ok.status).toBe(201)
    expect((await app.request(`/jobs/${jobId}/candidates`, json({ text: 'no name' }))).status).toBe(400)
  })

  it('413 on oversize upload', async () => {
    const fd = new FormData()
    fd.append('file', new File([new Uint8Array(21 * 1024 * 1024)], 'big.pdf'))
    expect((await app.request(`/jobs/${jobId}/candidates`, { method: 'POST', body: fd })).status).toBe(413)
  })

  it('GET list + GET candidate detail', async () => {
    const { id } = await (await app.request(`/jobs/${jobId}/candidates`, json({ name: 'Pat', text: 'abc' }))).json()
    const list = await (await app.request(`/jobs/${jobId}/candidates`)).json()
    expect(list).toHaveLength(1)
    const detail = await (await app.request(`/candidates/${id}`)).json()
    expect(detail.extractedText).toBe('abc')
    expect((await app.request('/candidates/999')).status).toBe(404)
  })
})
