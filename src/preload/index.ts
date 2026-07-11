import { contextBridge, ipcRenderer } from 'electron'

export interface BackupRequest {
  format: 'jpbak' | 'zip'
  passphrase?: string
}

export interface BackupOutcome {
  canceled: boolean
  path?: string
  encrypted?: boolean
}

export interface RestoreRequest {
  passphrase?: string
}

export interface RestoreOutcome {
  canceled: boolean
}

const bridge = {
  getServerPort: (): Promise<number> => ipcRenderer.invoke('jobpin:server-port'),
  getAppInfo: (): Promise<{ version: string; dataDir: string }> =>
    ipcRenderer.invoke('jobpin:app-info'),
  openDataFolder: (): Promise<void> => ipcRenderer.invoke('jobpin:open-data-folder'),
  openPath: (relativePath: string): Promise<void> => ipcRenderer.invoke('jobpin:open-path', relativePath),
  // F8.4: backup writes to a boss-chosen file (save dialog, main-side); restore reads one
  // (open dialog, main-side) then relaunches the app. The passphrase only ever travels over
  // this one IPC call — never logged, never persisted by the renderer.
  backup: (request: BackupRequest): Promise<BackupOutcome> => ipcRenderer.invoke('jobpin:backup', request),
  restore: (request: RestoreRequest): Promise<RestoreOutcome> => ipcRenderer.invoke('jobpin:restore', request)
}

contextBridge.exposeInMainWorld('jobpin', bridge)

export type JobpinBridge = typeof bridge
