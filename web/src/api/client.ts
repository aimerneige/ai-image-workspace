import type {
  AdminProvider, AuditEntry, Generation, GenParams, Meta, Overview, Page, Provider, Stats, User,
} from './types'

export class ApiError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message || code)
  }
}

type Query = Record<string, string | number | boolean | undefined | null>

function qs(q?: Query) {
  if (!q) return ''
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(q)) {
    if (v !== undefined && v !== null && v !== '' && v !== false) p.set(k, String(v))
  }
  const s = p.toString()
  return s ? `?${s}` : ''
}

let onUnauthorized: (() => void) | null = null
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn
}

async function request<T>(method: string, path: string, body?: unknown, query?: Query): Promise<T> {
  const headers: Record<string, string> = { 'X-Requested-With': 'aiw' }
  let payload: BodyInit | undefined
  if (body instanceof FormData) payload = body
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  let res: Response
  try {
    res = await fetch(`/api${path}${qs(query)}`, { method, headers, body: payload, credentials: 'same-origin' })
  } catch {
    throw new ApiError(0, 'network')
  }
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const code = data?.error?.code ?? 'internal'
    if (res.status === 401 && code === 'unauthorized') onUnauthorized?.()
    throw new ApiError(res.status, code, data?.error?.message)
  }
  return data as T
}

export const api = {
  meta: () => request<Meta>('GET', '/meta'),
  me: () => request<{ user: User }>('GET', '/auth/me'),
  login: (username: string, password: string) => request<{ user: User }>('POST', '/auth/login', { username, password }),
  register: (username: string, password: string) => request<{ user: User }>('POST', '/auth/register', { username, password }),
  logout: () => request<void>('POST', '/auth/logout'),
  changePassword: (current_password: string, new_password: string) =>
    request<void>('PUT', '/account/password', { current_password, new_password }),
  myActivity: (page: number) => request<Page<AuditEntry>>('GET', '/account/activity', undefined, { page, page_size: 20 }),
  stats: () => request<Stats>('GET', '/stats'),
  providers: () => request<{ items: Provider[] }>('GET', '/providers'),

  createGeneration: (input: {
    provider_id: number
    model: string
    prompt: string
    params: GenParams
    reference_image_ids: string[]
    files: File[]
  }) => {
    const { files, ...payload } = input
    if (files.length === 0) return request<Generation>('POST', '/generations', payload)
    const fd = new FormData()
    fd.set('payload', JSON.stringify(payload))
    files.forEach((f) => fd.append('images', f, f.name))
    return request<Generation>('POST', '/generations', fd)
  },
  generations: (q: Query) => request<Page<Generation>>('GET', '/generations', undefined, q),
  generation: (id: string) => request<Generation>('GET', `/generations/${id}`),
  setFavorite: (id: string, favorite: boolean) => request<void>('PATCH', `/generations/${id}`, { favorite }),
  cancelGeneration: (id: string) => request<void>('POST', `/generations/${id}/cancel`),
  deleteGeneration: (id: string) => request<void>('DELETE', `/generations/${id}`),

  admin: {
    overview: () => request<Overview>('GET', '/admin/overview'),
    providers: () => request<{ items: AdminProvider[] }>('GET', '/admin/providers'),
    createProvider: (body: Partial<AdminProvider> & { api_key?: string }) => request<AdminProvider>('POST', '/admin/providers', body),
    updateProvider: (id: number, body: Partial<AdminProvider> & { api_key?: string }) =>
      request<AdminProvider>('PUT', `/admin/providers/${id}`, body),
    deleteProvider: (id: number) => request<void>('DELETE', `/admin/providers/${id}`),
    testProvider: (id: number) => request<{ ok: boolean; latency_ms: number; error?: string; hint?: 'check_base_url' }>('POST', `/admin/providers/${id}/test`),
    users: () => request<{ items: User[] }>('GET', '/admin/users'),
    createUser: (body: { username: string; password: string; role: string }) => request<User>('POST', '/admin/users', body),
    updateUser: (id: number, body: { role?: string; disabled?: boolean }) => request<User>('PATCH', `/admin/users/${id}`, body),
    resetPassword: (id: number, password: string) => request<void>('PUT', `/admin/users/${id}/password`, { password }),
    deleteUser: (id: number) => request<void>('DELETE', `/admin/users/${id}`),
    audit: (q: Query) => request<Page<AuditEntry>>('GET', '/admin/audit-logs', undefined, q),
  },
}

/** Image URL helper adding the download flag. */
export const downloadUrl = (url: string) => `${url}${url.includes('?') ? '&' : '?'}download=1`
