import { app, dialog, ipcMain, shell } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveContainedPath } from './contained-path'
import { createBackup, extractBackupTo, readBackup } from '../server/backup'
import { renameSyncWithRetry } from '../server/fsx'
import type { DB } from '../server/db'
import type { JobpinPaths } from '../server/paths'

export interface IpcState {
  port: number
  dataRoot: string
  version: string
  paths: JobpinPaths
  db: DB
  dataKey?: Buffer
}

/** `jobpin-backup-<yyyymmdd-hhmm>.<ext>` — the save dialog's suggested filename (spec section 8). */
function defaultBackupFilename(format: 'jpbak' | 'zip', now = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
  return `jobpin-backup-${stamp}.${format}`
}

export function registerIpc(state: IpcState): void {
  ipcMain.handle('jobpin:server-port', () => state.port)
  ipcMain.handle('jobpin:app-info', () => ({ version: state.version, dataDir: state.dataRoot }))
  ipcMain.handle('jobpin:open-data-folder', async () => {
    await shell.openPath(state.dataRoot)
  })
  ipcMain.handle('jobpin:open-path', async (_e, relativePath: string) => {
    await shell.openPath(resolveContainedPath(state.dataRoot, relativePath))
  })

  // Backup/restore (F8.4, Task 11). Electron-free logic lives in src/server/backup.ts; this
  // layer only owns the dialogs, the safety-rename, and the relaunch. The passphrase travels
  // in the IPC payload and is NEVER logged anywhere in this handler.
  ipcMain.handle(
    'jobpin:backup',
    async (_e, payload: { format: 'jpbak' | 'zip'; passphrase?: string }) => {
      const { canceled, filePath } = await dialog.showSaveDialog({
        title: 'Back up Jobpin data',
        defaultPath: path.join(os.homedir(), defaultBackupFilename(payload.format)),
        filters:
          payload.format === 'jpbak'
            ? [{ name: 'Jobpin encrypted backup', extensions: ['jpbak'] }]
            : [{ name: 'Zip archive', extensions: ['zip'] }]
      })
      if (canceled || !filePath) return { canceled: true as const }

      const result = await createBackup(
        { db: state.db, paths: state.paths, dataKey: state.dataKey },
        filePath,
        { passphrase: payload.format === 'jpbak' ? payload.passphrase : undefined }
      )
      return { canceled: false as const, path: result.path, encrypted: result.encrypted }
    }
  )

  ipcMain.handle('jobpin:restore', async (_e, payload: { passphrase?: string }) => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Restore Jobpin data',
      properties: ['openFile'],
      filters: [{ name: 'Jobpin backups', extensions: ['jpbak', 'zip'] }]
    })
    if (canceled || filePaths.length === 0) return { canceled: true as const }

    // Throws a clean 'wrong passphrase or corrupt backup' before anything on disk is touched.
    const zipBytes = readBackup(filePaths[0], { passphrase: payload.passphrase })

    const tmpExtractDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobpin-restore-'))
    await extractBackupTo(zipBytes, tmpExtractDir)

    // Close the live connection BEFORE renaming: on Windows, an open handle on jobpin.db (or
    // its -wal/-shm siblings) blocks renaming the directory that contains it. Safe here only
    // because we are seconds from app.exit() — nothing else touches `state.db` again.
    state.db.close()

    // Safety-rename first (never delete): the boss can always recover the pre-restore state
    // by hand. Only once that succeeds do we move the restored tree into place.
    const dataRoot = state.paths.dataRoot
    const preRestorePath = `${dataRoot}.pre-restore-${Date.now()}`
    renameSyncWithRetry(dataRoot, preRestorePath)
    renameSyncWithRetry(tmpExtractDir, dataRoot)

    app.relaunch()
    app.exit(0)
    return { canceled: false as const } // unreachable once app.exit() runs; keeps the handler's type honest
  })
}
