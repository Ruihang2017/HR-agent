let portPromise: Promise<number> | null = null
const port = (): Promise<number> => (portPromise ??= window.jobpin.getServerPort())

/** Thrown on any non-2xx response; carries the HTTP status so callers can
 *  distinguish e.g. "404 not found yet" from a real failure. */
export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function handle<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) throw new ApiError(body.error ?? `request failed (${res.status})`, res.status)
  return body as T
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const p = await port()
  const res = await fetch(`http://127.0.0.1:${p}${path}`, {
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init
  })
  return handle<T>(res)
}

export async function apiUpload<T>(path: string, method: string, form: FormData): Promise<T> {
  const p = await port()
  const res = await fetch(`http://127.0.0.1:${p}${path}`, { method, body: form })
  return handle<T>(res)
}
