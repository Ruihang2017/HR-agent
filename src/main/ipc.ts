import { ipcMain, shell } from 'electron'

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
    const path = await import('node:path')
    const target = path.resolve(state.dataRoot, relativePath ?? '')
    const root = path.resolve(state.dataRoot)
    // Containment check: never open anything outside jobpin-data (spec section 7).
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new Error('path escapes the data folder')
    }
    await shell.openPath(target)
  })
}
