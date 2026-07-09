import { serve } from '@hono/node-server'
import type { Hono } from 'hono'

export interface RunningServer {
  port: number
  close: () => Promise<void>
}

/** Binds 127.0.0.1 on an OS-assigned port. Never a non-loopback interface. */
export function startServer(app: Hono): Promise<RunningServer> {
  return new Promise((resolve, reject) => {
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }, info => {
      resolve({
        port: info.port,
        close: () =>
          new Promise<void>((res, rej) => server.close(err => (err ? rej(err) : res())))
      })
    })
    server.on('error', reject)
  })
}
