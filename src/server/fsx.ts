import fs from 'node:fs'

/**
 * fs.renameSync with bounded retry for transient Windows locks (EPERM/EBUSY/
 * EACCES): antivirus and the search indexer briefly hold handles on freshly
 * created files, making directory renames race-prone. Linear backoff.
 */
export function renameSyncWithRetry(oldPath: string, newPath: string, attempts = 10, delayMs = 50): void {
  for (let i = 1; ; i++) {
    try {
      fs.renameSync(oldPath, newPath)
      return
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (i >= attempts || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw e
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs * i) // sync sleep
    }
  }
}
