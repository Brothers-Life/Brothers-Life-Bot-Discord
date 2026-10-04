export class ApiError extends Error {
  status: number
  code: string
  data: unknown

  constructor(status: number, code: string, message: string, data?: unknown) {
    super(message)
    this.status = status
    this.code = code
    this.data = data
  }
}

type Options = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
}

// Thin fetch wrapper: same-origin cookie session, CSRF header on mutations,
// and the server's { error: { code, message } } turned into ApiError.
export async function api<T>(path: string, { method = 'GET', body }: Options = {}): Promise<T> {
  const headers: Record<string, string> = {}
  if (method !== 'GET') headers['X-Requested-With'] = 'panel'
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  const text = await res.text()
  // A proxy or crash page answers in HTML: keep the HTTP status instead of a JSON parse error
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    if (res.ok) throw new ApiError(res.status, 'BAD_RESPONSE', 'Réponse invalide du serveur')
  }

  if (!res.ok) {
    const error = data?.error ?? {}
    throw new ApiError(res.status, error.code ?? 'HTTP', error.message ?? `Erreur ${res.status}`, error)
  }
  return data as T
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return 'Erreur inconnue'
}
