import { app, BrowserWindow, dialog } from 'electron'
import path from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { getPaths } from '../server/paths'
import { ensureScaffold } from '../server/scaffold'
import { openDatabase, runMigrations } from '../server/db'
import { migrations } from '../server/migrations'
import { sweepCandidateFiles } from '../server/data-migrations'
import { createApp } from '../server/app'
import { startServer } from '../server/serve'
import { registerIpc } from './ipc'
import { getOrCreateDataKey } from './key-provider'
import { DevTokenIssuer } from '../server/ai/subscription'
import { createAiRuntime } from '../server/ai/runtime'

let mainWindow: BrowserWindow | null = null

/** Dev-only .env loader: KEY=VALUE lines, no expansion, never logged. */
function loadDevEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env }
  const envFile = path.join(process.cwd(), '.env')
  if (!app.isPackaged && existsSync(envFile)) {
    for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim())
      if (m) {
        let v = m[2].trim()
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
        if (env[m[1]] === undefined) env[m[1]] = v
      }
    }
  }
  return env
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 720,
    height: 480,
    title: 'Jobpin',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
  return win
}

// Spec section 3, step 1: single instance - second launch focuses the window.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    try {
      // Steps 2-3: paths + first-run scaffold (never overwrites). Email templates ship
      // alongside `out/` (see electron-builder.yml's `files:`), so the bundled source sits
      // two levels above this compiled file in both dev (repo root) and packaged (asar root) layouts.
      const paths = getPaths()
      ensureScaffold(paths, { emailTemplatesSrc: path.join(__dirname, '../../templates/au/emails') })

      // Step 4: data key (safeStorage-wrapped), then open DB keyed with it, apply migrations.
      // `dataKey` is null when safeStorage has no OS keychain to wrap it with - Jobpin then
      // runs keyless (unchanged pre-encryption behaviour) and reports this via /health.
      const dataKey = getOrCreateDataKey(paths.dataRoot)
      const db = openDatabase(paths.dbFile, dataKey ?? undefined)
      runMigrations(db, migrations)

      // First-boot (and resumable) candidate-file encryption sweep: only runs once a
      // data key exists, and only touches files still plaintext (idempotent by construction).
      if (dataKey) {
        const { encrypted, skipped } = sweepCandidateFiles({ db, paths, dataKey })
        console.log(`candidate-file sweep: ${encrypted} file(s) encrypted, ${skipped} already encrypted`)
      } else {
        console.warn(
          'safeStorage encryption is unavailable on this system - Jobpin is running WITHOUT ' +
            'at-rest encryption for the database and candidate files.'
        )
      }

      // Step 5: start the localhost server on an OS-assigned port.
      const ai = createAiRuntime({ db, paths, issuer: new DevTokenIssuer(loadDevEnv()), dataKey: dataKey ?? undefined })
      const honoApp = createApp({ db, paths, version: app.getVersion(), ai, dataKey: dataKey ?? undefined })
      const { port } = await startServer(honoApp)

      // Boot recovery: any task left 'running' from a previous crash/kill is
      // requeued, then the workers are kicked to drain the backlog.
      ai.queue.resetRunning()
      ai.queue.kick()

      // Step 6: bridge + window.
      registerIpc({ port, dataRoot: paths.dataRoot, version: app.getVersion(), paths, db, dataKey: dataKey ?? undefined })
      mainWindow = createWindow()
    } catch (err) {
      // Honesty-in-failure (spec section 3): plain-language dialog, clean exit.
      const message = err instanceof Error ? err.message : String(err)
      dialog.showErrorBox(
        'Jobpin failed to start',
        `${message}\n\nNothing was left half-initialized. ` +
          'Fix the problem above and start Jobpin again.'
      )
      app.exit(1)
    }
  })

  app.on('window-all-closed', () => app.quit())
}
