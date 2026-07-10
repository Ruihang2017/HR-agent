import fs from 'node:fs'

/**
 * Remove a directory tree, absorbing transient Windows locks (antivirus /
 * search indexer briefly hold handles on freshly written or renamed files).
 * fs.rmSync's own maxRetries retries in a tight loop without sleeping, which
 * is not enough for an external scanner to release its handle — so retry the
 * whole removal with a real linear-backoff sleep between attempts.
 */
export function rmrfWithRetry(dir: string, attempts = 10, delayMs = 100): void {
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
