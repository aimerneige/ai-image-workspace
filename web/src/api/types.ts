export interface User {
  id: number
  username: string
  role: 'admin' | 'user'
  disabled: boolean
  last_login_at: string | null
  created_at: string
  generations?: number
}

export interface Meta {
  version: string
  allow_registration: boolean
  repo_url: string
  max_upload_mb: number
}

export type ProviderType = 'openai' | 'gemini'

export interface Provider {
  id: number
  name: string
  type: ProviderType
  models: string[]
}

export interface AdminProvider extends Provider {
  base_url: string
  api_key_masked: string
  has_key: boolean
  enabled: boolean
  source: 'config' | 'ui'
  config_key?: string
  created_at: string
  updated_at: string
}

export interface GenParams {
  n?: number
  size?: string
  quality?: string
  background?: string
  output_format?: string
  output_compression?: number
  moderation?: string
  input_fidelity?: string
  aspect_ratio?: string
  image_size?: string
  google_search?: boolean
}

export interface ImageRef {
  id: string
  role: 'input' | 'output'
  url: string
  thumb_url: string
  mime: string
  width: number
  height: number
  bytes: number
}

export type GenStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled'

export interface Generation {
  id: string
  provider_id: number
  provider_name: string
  provider_type: ProviderType
  model: string
  mode: 'generate' | 'edit'
  prompt: string
  params: GenParams
  status: GenStatus
  error?: string
  text?: string
  duration_ms: number
  favorite: boolean
  created_at: string
  started_at: string | null
  finished_at: string | null
  inputs: ImageRef[]
  outputs: ImageRef[]
  request_log?: unknown
  response_meta?: unknown
}

export interface Page<T> {
  items: T[]
  total: number
  page: number
  page_size: number
}

export interface AuditEntry {
  id: number
  user_id: number | null
  username: string
  action: string
  target: string
  detail?: Record<string, unknown>
  ip: string
  user_agent: string
  created_at: string
}

export interface Stats {
  total: number
  succeeded: number
  failed: number
  images: number
  favorites: number
}

export interface Overview {
  version: string
  database: string
  allow_registration: boolean
  users: number
  generation_timeout: string
  max_concurrent: number
  max_upload_mb: number
  default_models: Record<ProviderType, string[]>
}
