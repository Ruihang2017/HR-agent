/// <reference types="vite/client" />

interface JobpinBackupRequest {
  format: 'jpbak' | 'zip'
  passphrase?: string
}

interface JobpinBackupOutcome {
  canceled: boolean
  path?: string
  encrypted?: boolean
}

interface JobpinRestoreRequest {
  passphrase?: string
}

interface JobpinRestoreOutcome {
  canceled: boolean
}

interface JobpinBridge {
  getServerPort(): Promise<number>
  getAppInfo(): Promise<{ version: string; dataDir: string }>
  openDataFolder(): Promise<void>
  openPath(relativePath: string): Promise<void>
  // F8.4 (Task 11/12): the passphrase only ever travels over this one IPC call — never
  // logged, never persisted by the renderer, never put in a URL.
  backup(request: JobpinBackupRequest): Promise<JobpinBackupOutcome>
  restore(request: JobpinRestoreRequest): Promise<JobpinRestoreOutcome>
}

interface Window {
  jobpin: JobpinBridge
}
