import { app, BrowserWindow, dialog } from 'electron'
import path from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { getPaths } from '../server/paths'
import { ensureScaffold } from '../server/scaffold'
import { openDatabase, runMigrations } from '../server/db'
import { migrations } from '../server/migrations'
import { createApp } from '../server/app'
import { startServer } from '../server/serve'
import { registerIpc } from './ipc'
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
      if (m && env[m[1]] === undefined) env[m[1]] = m[2]
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
      // Steps 2-3: paths + first-run scaffold (never overwrites).
      const paths = getPaths()
      ensureScaffold(paths)

      // Step 4: open DB, apply migrations.
      const db = openDatabase(paths.dbFile)
      runMigrations(db, migrations)

      // Step 5: start the localhost server on an OS-assigned port.
      const ai = createAiRuntime({ db, paths, issuer: new DevTokenIssuer(loadDevEnv()) })
      const honoApp = createApp({ db, paths, version: app.getVersion(), ai })
      const { port } = await startServer(honoApp)

      // Boot recovery: any task left 'running' from a previous crash/kill is
      // requeued, then the workers are kicked to drain the backlog.
      ai.queue.resetRunning()
      ai.queue.kick()

      // Step 6: bridge + window.
      registerIpc({ port, dataRoot: paths.dataRoot, version: app.getVersion() })
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
