import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api } from '../api/client'
import type { Generation, ImageRef, Provider } from '../api/types'
import { defaultParams, fromApiParams, type ComposerParams } from '../lib/models'
import { useAuth } from './auth'
import { useToast } from '../components/ui'
import { useI18n } from '../i18n'

export type RefItem =
  | { key: string; kind: 'file'; file: File; url: string }
  | { key: string; kind: 'image'; image: ImageRef }

export interface Composer {
  providerId: number | null
  model: string
  prompt: string
  params: ComposerParams
  refs: RefItem[]
}

interface WorkspaceValue {
  providers: Provider[]
  providersLoaded: boolean
  reloadProviders: () => void
  composer: Composer
  setComposer: (fn: (c: Composer) => Composer) => void
  /** Newest-first feed shown in the workspace (session + recent history). */
  feed: Generation[]
  feedLoaded: boolean
  upsert: (g: Generation) => void
  remove: (id: string) => void
  runningCount: number
  loadFromGeneration: (g: Generation, opts?: { withRefs?: boolean }) => void
  addImageRef: (img: ImageRef) => void
}

const Ctx = createContext<WorkspaceValue | null>(null)
const STORAGE = 'aiw.composer'
let refSeq = 0
export const newRefKey = () => `ref-${Date.now()}-${++refSeq}`

function loadComposer(): Composer {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE) || '{}')
    return {
      providerId: raw.providerId ?? null,
      model: raw.model ?? '',
      prompt: raw.prompt ?? '',
      params: { ...defaultParams, ...(raw.params ?? {}) },
      refs: (raw.imageRefs ?? []).map((image: ImageRef) => ({ key: newRefKey(), kind: 'image', image })),
    }
  } catch {
    return { providerId: null, model: '', prompt: '', params: defaultParams, refs: [] }
  }
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const toast = useToast()
  const { t } = useI18n()
  const [providers, setProviders] = useState<Provider[]>([])
  const [providersLoaded, setProvidersLoaded] = useState(false)
  const [composer, setComposerState] = useState<Composer>(loadComposer)
  const [feed, setFeed] = useState<Generation[]>([])
  const [feedLoaded, setFeedLoaded] = useState(false)
  const feedRef = useRef(feed)
  feedRef.current = feed

  const reloadProviders = useCallback(() => {
    api.providers().then((r) => {
      setProviders(r.items)
      setProvidersLoaded(true)
    }).catch(() => setProvidersLoaded(true))
  }, [])

  useEffect(() => {
    if (!user) {
      setFeed([])
      setFeedLoaded(false)
      return
    }
    reloadProviders()
    api.generations({ page: 1, page_size: 12 }).then((r) => {
      setFeed(r.items)
      setFeedLoaded(true)
    }).catch(() => setFeedLoaded(true))
  }, [user, reloadProviders])

  // Keep the selected provider/model valid when the provider list changes.
  useEffect(() => {
    if (!providersLoaded) return
    setComposerState((c) => {
      let p = providers.find((x) => x.id === c.providerId)
      if (!p) p = providers[0]
      if (!p) return { ...c, providerId: null, model: '' }
      const model = p.models.includes(c.model) ? c.model : p.models[0] ?? ''
      if (p.id === c.providerId && model === c.model) return c
      return { ...c, providerId: p.id, model }
    })
  }, [providers, providersLoaded])

  // Persist everything except local files (which cannot be serialised).
  useEffect(() => {
    const imageRefs = composer.refs.filter((r) => r.kind === 'image').map((r) => (r as { image: ImageRef }).image)
    localStorage.setItem(STORAGE, JSON.stringify({ ...composer, refs: undefined, imageRefs }))
  }, [composer])

  const setComposer = useCallback((fn: (c: Composer) => Composer) => setComposerState(fn), [])

  const upsert = useCallback((g: Generation) => {
    setFeed((f) => {
      const i = f.findIndex((x) => x.id === g.id)
      if (i < 0) return [g, ...f]
      const next = f.slice()
      next[i] = g
      return next
    })
  }, [])

  const remove = useCallback((id: string) => setFeed((f) => f.filter((x) => x.id !== id)), [])

  // Poll running generations; works regardless of which page is open.
  const runningIds = feed.filter((g) => g.status === 'running' || g.status === 'queued').map((g) => g.id).join(',')
  useEffect(() => {
    if (!runningIds) return
    const ids = runningIds.split(',')
    const timer = setInterval(async () => {
      for (const id of ids) {
        try {
          const g = await api.generation(id)
          if (g.status !== 'running' && g.status !== 'queued') {
            const prev = feedRef.current.find((x) => x.id === id)
            if (prev && prev.status !== g.status) {
              if (g.status === 'succeeded') toast.success(`${t('gen.status.succeeded')} · ${g.prompt.slice(0, 40)}`)
              else if (g.status === 'failed') toast.error(`${t('gen.status.failed')} · ${g.error?.slice(0, 120) ?? ''}`)
            }
          }
          upsert(g)
        } catch {
          /* transient; retry next tick */
        }
      }
    }, 2000)
    return () => clearInterval(timer)
  }, [runningIds, upsert, toast, t])

  const loadFromGeneration = useCallback((g: Generation, opts?: { withRefs?: boolean }) => {
    setComposerState((c) => ({
      ...c,
      providerId: g.provider_id,
      model: g.model,
      prompt: g.prompt,
      params: { ...c.params, ...fromApiParams(g.provider_type, g.params) },
      refs: opts?.withRefs === false ? c.refs : g.inputs.map((image) => ({ key: newRefKey(), kind: 'image' as const, image })),
    }))
  }, [])

  const addImageRef = useCallback((img: ImageRef) => {
    setComposerState((c) =>
      c.refs.some((r) => r.kind === 'image' && r.image.id === img.id)
        ? c
        : { ...c, refs: [...c.refs, { key: newRefKey(), kind: 'image', image: img }] },
    )
  }, [])

  const runningCount = runningIds ? runningIds.split(',').length : 0

  const value = useMemo<WorkspaceValue>(
    () => ({
      providers, providersLoaded, reloadProviders, composer, setComposer, feed, feedLoaded, upsert, remove,
      runningCount, loadFromGeneration, addImageRef,
    }),
    [providers, providersLoaded, reloadProviders, composer, setComposer, feed, feedLoaded, upsert, remove, runningCount, loadFromGeneration, addImageRef],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useWorkspace() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useWorkspace outside WorkspaceProvider')
  return ctx
}
