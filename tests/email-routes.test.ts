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

const EMAIL_TEMPLATES_SRC = path.join(__dirname, '..', 'templates', 'au', 'emails')

let tmp: string
let db: DB
let paths: JobpinPaths
let app: Hono

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jobpin-email-routes-'))
  paths = getPaths(tmp)
  ensureScaffold(paths, { emailTemplatesSrc: EMAIL_TEMPLATES_SRC })
  db = openDatabase(paths.dbFile)
  runMigrations(db, migrations)
  app = createApp({ db, paths, version: '0.1.0' })
})

afterEach(() => {
  db.close()
  rmrfWithRetry(tmp)
})

const json = (body: unknown, method: 'POST' | 'PUT' | 'PATCH' = 'POST') => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
})

async function makeCandidate(): Promise<number> {
  const job = await (await app.request('/jobs', json({ name: 'Barista', jd: 'Make coffee' }))).json()
  const candidate = await (
    await app.request(`/jobs/${job.id}/candidates`, json({ name: 'Jamie Lee', text: 'Ten years of sales.' }))
  ).json()
  return candidate.id
}

describe('GET /email-templates', () => {
  it('returns the 6 manifest entries with the public contract only (no internal file name)', async () => {
    const res = await app.request('/email-templates')
    expect(res.status).toBe(200)
    const templates = await res.json()
    expect(templates).toHaveLength(6)
    expect(templates.map((t: { type: string }) => t.type).sort()).toEqual(
      ['online_invitation', 'onsite_invitation', 'reschedule', 'rejection', 'more_materials', 'onboarding'].sort()
    )
    for (const t of templates) {
      expect(t.file).toBeUndefined()
      expect(typeof t.label).toBe('string')
      expect(typeof t.subject).toBe('string')
      expect(Array.isArray(t.inputs)).toBe(true)
    }
  })
})

describe('POST /candidates/:id/emails', () => {
  it('save:false (or omitted) previews: 200 {subject, body}, no persistence', async () => {
    const candidateId = await makeCandidate()
    const res = await app.request(
      `/candidates/${candidateId}/emails`,
      json({ type: 'rejection', inputs: {}, save: false })
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(typeof body.subject).toBe('string')
    expect(typeof body.body).toBe('string')
    expect(body.id).toBeUndefined()

    const list = await (await app.request(`/candidates/${candidateId}/emails`)).json()
    expect(list).toHaveLength(0)
  })

  it('save:true persists: 201 {id, filePath, subject, body}', async () => {
    const candidateId = await makeCandidate()
    const res = await app.request(
      `/candidates/${candidateId}/emails`,
      json({ type: 'rejection', inputs: {}, save: true })
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(typeof body.id).toBe('number')
    expect(typeof body.filePath).toBe('string')
    expect(typeof body.subject).toBe('string')
    expect(typeof body.body).toBe('string')

    const list = await (await app.request(`/candidates/${candidateId}/emails`)).json()
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(body.id)
  })

  it('400 on malformed JSON body', async () => {
    const candidateId = await makeCandidate()
    const res = await app.request(`/candidates/${candidateId}/emails`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json'
    })
    expect(res.status).toBe(400)
  })

  it('400 when a required input is missing', async () => {
    const candidateId = await makeCandidate()
    const res = await app.request(
      `/candidates/${candidateId}/emails`,
      json({ type: 'online_invitation', inputs: { interview_datetime: '2026-07-20 10:00' }, save: false })
    )
    expect(res.status).toBe(400)
  })

  it('400 for an unknown template type', async () => {
    const candidateId = await makeCandidate()
    const res = await app.request(`/candidates/${candidateId}/emails`, json({ type: 'nonsense', inputs: {} }))
    expect(res.status).toBe(400)
  })

  it('404 for an unknown candidate', async () => {
    const res = await app.request('/candidates/999999/emails', json({ type: 'rejection', inputs: {} }))
    expect(res.status).toBe(404)
  })
})

describe('GET /candidates/:id/emails', () => {
  it('404 for an unknown candidate', async () => {
    expect((await app.request('/candidates/999999/emails')).status).toBe(404)
  })
})

describe('GET /emails/:id', () => {
  it('200 {id, type, createdAt, content}', async () => {
    const candidateId = await makeCandidate()
    const saved = await (
      await app.request(`/candidates/${candidateId}/emails`, json({ type: 'rejection', inputs: {}, save: true }))
    ).json()

    const res = await app.request(`/emails/${saved.id}`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe(saved.id)
    expect(body.type).toBe('rejection')
    expect(typeof body.createdAt).toBe('string')
    expect(body.content).toContain(`Subject: ${saved.subject}`)
  })

  it('404 for an unknown email id', async () => {
    expect((await app.request('/emails/999999')).status).toBe(404)
  })
})

describe('company-settings', () => {
  it('GET returns empty defaults before anything is set', async () => {
    const res = await app.request('/company-settings')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ name: '', senderName: '' })
  })

  it('PUT updates and round-trips via GET', async () => {
    const put = await app.request('/company-settings', json({ name: 'Acme Cafe', senderName: 'Alex Boss' }, 'PUT'))
    expect(put.status).toBe(200)
    expect(await put.json()).toEqual({ name: 'Acme Cafe', senderName: 'Alex Boss' })

    const get = await (await app.request('/company-settings')).json()
    expect(get).toEqual({ name: 'Acme Cafe', senderName: 'Alex Boss' })
  })

  it('PUT accepts a partial update, leaving the other field untouched', async () => {
    await app.request('/company-settings', json({ name: 'Acme Cafe', senderName: 'Alex Boss' }, 'PUT'))
    await app.request('/company-settings', json({ name: 'Acme Cafe v2' }, 'PUT'))
    const get = await (await app.request('/company-settings')).json()
    expect(get).toEqual({ name: 'Acme Cafe v2', senderName: 'Alex Boss' })
  })

  it('400 on malformed JSON body', async () => {
    const res = await app.request('/company-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json'
    })
    expect(res.status).toBe(400)
  })

  it('feeds a subsequent render: setting the name shows up in a preview body/subject', async () => {
    const candidateId = await makeCandidate()
    await app.request('/company-settings', json({ name: 'Acme Cafe', senderName: 'Alex Boss' }, 'PUT'))

    const res = await app.request(
      `/candidates/${candidateId}/emails`,
      json({ type: 'rejection', inputs: {}, save: false })
    )
    const body = await res.json()
    expect(body.subject).toContain('Acme Cafe')
    expect(body.body).toContain('Alex Boss')
    expect(body.body).toContain('Acme Cafe')
  })
})
