import { app, dialog, ipcMain, shell } from 'electron'
import os from 'node:os'
import path from 'node:path'
import { resolveContainedPath } from './contained-path'
import { createBackup, readBackup, stageRestore } from '../server/backup'
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
      // Belt-and-braces at the trust boundary: the renderer already refuses to submit an
      // encrypted backup with a blank passphrase, but a bad/compromised caller must never be
      // able to produce a plain zip silently named `.jpbak` (the boss would believe it protected).
      if (payload.format === 'jpbak' && !(payload.passphrase ?? '').trim()) {
        throw new Error('an encrypted backup needs a passphrase')
      }

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

    // STAGE the restore (extract + validate + write the pending marker) WITHOUT touching the
    // live data folder or the DB. The actual swap happens at the next launch, in
    // applyPendingRestore(), before anything opens the DB or the server — that's the only place
    // it can run on Windows without fighting open file handles on jobpin-data (a bad archive is
    // rejected here, so we never restart onto nothing). If staging throws, the live app is
    // untouched and the error surfaces to the renderer.
    await stageRestore(state.paths.dataRoot, zipBytes)

    // Close cleanly, then relaunch to apply the staged restore. If relaunch doesn't take on this
    // platform/run-mode, the marker persists and the restore applies the next time Jobpin opens.
    state.db.close()
    app.relaunch()
    app.exit(0)
    return { canceled: false as const } // unreachable once app.exit() runs; keeps the handler's type honest
  })
}
