import { contextBridge, ipcRenderer } from 'electron'

const bridge = {
  getServerPort: (): Promise<number> => ipcRenderer.invoke('jobpin:server-port'),
  getAppInfo: (): Promise<{ version: string; dataDir: string }> =>
    ipcRenderer.invoke('jobpin:app-info'),
  openDataFolder: (): Promise<void> => ipcRenderer.invoke('jobpin:open-data-folder'),
  openPath: (relativePath: string): Promise<void> => ipcRenderer.invoke('jobpin:open-path', relativePath)
}

contextBridge.exposeInMainWorld('jobpin', bridge)

export type JobpinBridge = typeof bridge
