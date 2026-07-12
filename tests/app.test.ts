import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase, runMigrations, type DB } from '../src/server/db'
import { migrations } from '../src/server/migrations'
import { createApp } from '../src/server/app'
import { startServer } from '../src/server/serve'
import { getPaths } from '../src/server/paths'

let tmp: string
let db: DB

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jobpin-app-'))
  db = openDatabase(path.join(tmp, 'jobpin.db'))
  runMigrations(db, migrations)
})

afterEach(() => {
  db.close()
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('createApp', () => {
  it('GET /health reports ok, schema version, data dir and encryption:unavailable when keyless', async () => {
    const app = createApp({ db, paths: getPaths(tmp), version: '0.1.0' })
    const res = await app.request('/health')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('ok')
    expect(body.schemaVersion).toBe(4)
    expect(body.dataDir).toBe(tmp)
    expect(typeof body.uptimeSeconds).toBe('number')
    expect(body.encryption).toBe('unavailable')
  })

  it('GET /health reports encryption:on when a data key is threaded through', async () => {
    const app = createApp({ db, paths: getPaths(tmp), version: '0.1.0', dataKey: Buffer.alloc(32, 1) })
    const res = await app.request('/health')
    const body = await res.json()
    expect(body.encryption).toBe('on')
  })

  it('GET /version reports app name and version', async () => {
    const app = createApp({ db, paths: getPaths(tmp), version: '0.1.0' })
    const res = await app.request('/version')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ app: 'jobpin', version: '0.1.0' })
  })
})

describe('startServer', () => {
  it('serves on an OS-assigned 127.0.0.1 port and closes cleanly', async () => {
    const app = createApp({ db, paths: getPaths(tmp), version: '0.1.0' })
    const { port, close } = await startServer(app)
    expect(port).toBeGreaterThan(0)
    const res = await fetch(`http://127.0.0.1:${port}/health`)
    expect(res.status).toBe(200)
    await close()
    await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow()
  })
})
