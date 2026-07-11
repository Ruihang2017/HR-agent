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

/**
 * Removes a directory tree with bounded retry for the same transient Windows locks as
 * `renameSyncWithRetry` above. `fs.rmSync`'s own `maxRetries` retries in a tight loop
 * without sleeping, which is not enough for an external scanner to release its handle -
 * so retry the whole removal with a real linear-backoff sleep between attempts.
 * Used by the deletion service (Task 10) to remove a candidate/job folder AFTER its
 * anonymisation/cascade transaction has committed - a failure here throws to the caller,
 * who logs and rethrows so the UI surfaces it (the DB is already consistent by that point).
 */
export function rmrfWithRetry(dir: string, attempts = 10, delayMs = 50): void {
  for (let i = 1; ; i++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
      return
    } catch (e) {
      if (i >= attempts) throw e
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs * i) // sync sleep
    }
  }
}
