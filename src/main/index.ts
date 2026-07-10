import { app, BrowserWindow, dialog } from 'electron'
import path from 'node:path'
import { getPaths } from '../server/paths'
import { ensureScaffold } from '../server/scaffold'
import { openDatabase, runMigrations } from '../server/db'
import { migrations } from '../server/migrations'
import { createApp } from '../server/app'
import { startServer } from '../server/serve'
import { registerIpc } from './ipc'

let mainWindow: BrowserWindow | null = null

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
      const honoApp = createApp({ db, dataRoot: paths.dataRoot, version: app.getVersion() })
      const { port } = await startServer(honoApp)

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
