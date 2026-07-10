/// <reference types="vite/client" />

interface JobpinBridge {
  getServerPort(): Promise<number>
  getAppInfo(): Promise<{ version: string; dataDir: string }>
  openDataFolder(): Promise<void>
  openPath(relativePath: string): Promise<void>
}

interface Window {
  jobpin: JobpinBridge
}
