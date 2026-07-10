let portPromise: Promise<number> | null = null
const port = (): Promise<number> => (portPromise ??= window.jobpin.getServerPort())

async function handle<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) throw new Error(body.error ?? `request failed (${res.status})`)
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
