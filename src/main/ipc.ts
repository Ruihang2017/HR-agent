import { ipcMain, shell } from 'electron'
import { resolveContainedPath } from './contained-path'

export interface IpcState {
  port: number
  dataRoot: string
  version: string
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
}
