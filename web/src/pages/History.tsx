import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  AlertCircle, Copy, Download, Heart, ImageOff, Images, Search, Trash2, Wand2, X, CheckCircle2, XCircle, Layers,
} from 'lucide-react'
import { api, downloadUrl } from '../api/client'
import type { Generation, ImageRef, Stats } from '../api/types'
import { useWorkspace } from '../app/workspace'
import { Badge, Button, Dialog, EmptyState, IconButton, Input, Segmented, Select, Skeleton, Spinner, useConfirm, useToast } from '../components/ui'
import { Lightbox } from '../features/shared/Lightbox'
import { StatusBadge } from '../features/workspace/GenerationCard'
import { ProviderIcon } from '../features/workspace/ModelPicker'
import { useI18n } from '../i18n'
import { modelLabel } from '../lib/models'
import { copyText, formatBytes, formatDuration, triggerDownload } from '../lib/utils'
import { useErrorMessage } from '../lib/errors'

const PAGE = 24

interface Filters {
  q: string
  status: string
  provider_type: string
  favorite: boolean
}

export function HistoryPage() {
  const { t, formatNumber } = useI18n()
  const [params, setParams] = useSearchParams()
  const [filters, setFilters] = useState<Filters>({ q: '', status: '', provider_type: '', favorite: false })
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<Generation[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState<Stats | null>(null)
  const sentinel = useRef<HTMLDivElement>(null)
  const errMsg = useErrorMessage()
  const toast = useToast()
  const detailId = params.get('id')

  // Debounce the search box.
  useEffect(() => {
    const id = setTimeout(() => setFilters((f) => (f.q === query ? f : { ...f, q: query })), 300)
    return () => clearTimeout(id)
  }, [query])

  const load = useCallback(
    async (p: number, f: Filters) => {
      setLoading(true)
      try {
        const r = await api.generations({ page: p, page_size: PAGE, ...f })
        setItems((xs) => (p === 1 ? r.items : [...xs, ...r.items.filter((x) => !xs.some((y) => y.id === x.id))]))
        setTotal(r.total)
        setPage(p)
      } catch (e) {
        toast.error(errMsg(e))
      } finally {
        setLoading(false)
      }
    },
    [toast, errMsg],
  )

  useEffect(() => {
    load(1, filters)
  }, [filters, load])

  useEffect(() => {
    api.stats().then(setStats).catch(() => {})
  }, [])

  const hasMore = items.length < total
  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const io = new IntersectionObserver((es) => {
      if (es[0].isIntersecting && hasMore && !loading) load(page + 1, filters)
    }, { rootMargin: '400px' })
    io.observe(el)
    return () => io.disconnect()
  }, [hasMore, loading, page, filters, load])

  const filtered = filters.q || filters.status || filters.provider_type || filters.favorite
  const update = (g: Generation) => setItems((xs) => xs.map((x) => (x.id === g.id ? { ...x, ...g } : x)))
  const removed = (id: string) => {
    setItems((xs) => xs.filter((x) => x.id !== id))
    setTotal((n) => n - 1)
    setParams({}, { replace: true })
  }

  return (
    <div className="page history">
      <div className="page-head">
        <div>
          <h1 className="page-title">{t('history.title')}</h1>
          <p className="page-subtitle">{t('history.subtitle', { n: formatNumber(total) })}</p>
        </div>
        {stats && (
          <div className="stats">
            <div className="stat"><Layers size={16} /><span className="stat-v">{formatNumber(stats.total)}</span><span className="stat-l">{t('history.total')}</span></div>
            <div className="stat is-success"><CheckCircle2 size={16} /><span className="stat-v">{formatNumber(stats.succeeded)}</span><span className="stat-l">{t('history.succeeded')}</span></div>
            <div className="stat is-danger"><XCircle size={16} /><span className="stat-v">{formatNumber(stats.failed)}</span><span className="stat-l">{t('history.failed')}</span></div>
            <div className="stat is-accent"><Images size={16} /><span className="stat-v">{formatNumber(stats.images)}</span><span className="stat-l">{t('history.images')}</span></div>
          </div>
        )}
      </div>

      <div className="filters">
        <Input
          className="filter-search"
          icon={<Search size={16} />}
          placeholder={t('history.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          suffix={query && (
            <button type="button" className="input-reveal" aria-label={t('common.close')} onClick={() => setQuery('')}><X size={14} /></button>
          )}
        />
        <Select
          className="filter-select"
          value={filters.status}
          onChange={(v) => setFilters((f) => ({ ...f, status: v }))}
          options={[
            { value: '', label: t('history.allStatuses') },
            ...(['succeeded', 'failed', 'running', 'canceled'] as const).map((s) => ({ value: s, label: t(`gen.status.${s}`) })),
          ]}
        />
        <Segmented
          value={filters.provider_type || 'all'}
          onChange={(v) => setFilters((f) => ({ ...f, provider_type: v === 'all' ? '' : v }))}
          options={[
            { value: 'all', label: t('history.allProviders') },
            { value: 'openai', label: 'OpenAI' },
            { value: 'gemini', label: 'Gemini' },
          ]}
        />
        <Button
          variant={filters.favorite ? 'primary' : 'secondary'}
          icon={<Heart size={16} fill={filters.favorite ? 'currentColor' : 'none'} />}
          onClick={() => setFilters((f) => ({ ...f, favorite: !f.favorite }))}
        >
          {t('history.favorites')}
        </Button>
      </div>

      {items.length === 0 && loading ? (
        <div className="history-grid">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} style={{ aspectRatio: '4 / 5', borderRadius: 16 }} />)}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Images size={28} />}
          title={filtered ? t('history.emptyFiltered') : t('history.empty')}
          body={filtered ? undefined : t('history.emptyBody')}
          action={filtered && (
            <Button onClick={() => { setQuery(''); setFilters({ q: '', status: '', provider_type: '', favorite: false }) }}>{t('history.clearFilters')}</Button>
          )}
        />
      ) : (
        <div className="history-grid">
          {items.map((g) => (
            <HistoryTile key={g.id} gen={g} onOpen={() => setParams({ id: g.id })} />
          ))}
        </div>
      )}
      <div ref={sentinel} className="history-sentinel">
        {loading && items.length > 0 && <Spinner />}
        {!hasMore && items.length > PAGE && <span className="muted small">{t('history.end')}</span>}
      </div>

      <DetailSheet id={detailId} onClose={() => setParams({}, { replace: true })} onChange={update} onDeleted={removed} />
    </div>
  )
}

function HistoryTile({ gen, onOpen }: { gen: Generation; onOpen: () => void }) {
  const { formatRelative, t } = useI18n()
  const cover = gen.outputs[0]
  return (
    <button type="button" className={`history-tile is-${gen.status}`} onClick={onOpen}>
      <div className="history-cover">
        {cover ? (
          <img src={cover.thumb_url} alt="" loading="lazy" />
        ) : (
          <div className="history-cover-empty">
            {gen.status === 'running' ? <Spinner size={22} /> : gen.status === 'failed' ? <AlertCircle size={22} /> : <ImageOff size={22} />}
            <span>{gen.status === 'failed' ? t('gen.status.failed') : t('history.noOutput')}</span>
          </div>
        )}
        {gen.outputs.length > 1 && <span className="history-count"><Images size={12} />{gen.outputs.length}</span>}
        {gen.favorite && <span className="history-fav"><Heart size={13} fill="currentColor" /></span>}
      </div>
      <div className="history-body">
        <p className="history-prompt">{gen.prompt}</p>
        <div className="history-meta">
          <span className="history-model"><ProviderIcon type={gen.provider_type} size={14} />{modelLabel(gen.model) ?? gen.model}</span>
          <span>{formatRelative(gen.created_at)}</span>
        </div>
      </div>
    </button>
  )
}

function JsonBlock({ value }: { value: unknown }) {
  const { t } = useI18n()
  const toast = useToast()
  const text = JSON.stringify(value, null, 2)
  return (
    <div className="json-block">
      <IconButton size="sm" className="json-copy" label={t('common.copy')} onClick={async () => (await copyText(text)) && toast.success(t('gen.copied'))}>
        <Copy size={14} />
      </IconButton>
      <pre>{text}</pre>
    </div>
  )
}

function DetailSheet({ id, onClose, onChange, onDeleted }: { id: string | null; onClose: () => void; onChange: (g: Generation) => void; onDeleted: (id: string) => void }) {
  const { t, formatDate } = useI18n()
  const [gen, setGen] = useState<Generation | null>(null)
  const [tab, setTab] = useState<'params' | 'request' | 'response'>('params')
  const [lightbox, setLightbox] = useState<{ images: ImageRef[]; index: number | null }>({ images: [], index: null })
  const ws = useWorkspace()
  const navigate = useNavigate()
  const toast = useToast()
  const confirm = useConfirm()
  const errMsg = useErrorMessage()

  useEffect(() => {
    if (!id) return
    setGen(null)
    setTab('params')
    api.generation(id).then(setGen).catch((e) => {
      toast.error(errMsg(e))
      onClose()
    })
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep polling while the job is still running.
  useEffect(() => {
    if (!gen || (gen.status !== 'running' && gen.status !== 'queued')) return
    const timer = setInterval(() => api.generation(gen.id).then((g) => { setGen(g); onChange(g) }).catch(() => {}), 2000)
    return () => clearInterval(timer)
  }, [gen, onChange])

  const fav = async () => {
    if (!gen) return
    try {
      await api.setFavorite(gen.id, !gen.favorite)
      const g = { ...gen, favorite: !gen.favorite }
      setGen(g)
      onChange(g)
    } catch (e) {
      toast.error(errMsg(e))
    }
  }

  const del = async () => {
    if (!gen) return
    if (!(await confirm({ title: t('gen.deleteConfirmTitle'), body: t('gen.deleteConfirmBody'), confirmText: t('common.delete'), danger: true }))) return
    try {
      await api.deleteGeneration(gen.id)
      ws.remove(gen.id)
      toast.success(t('gen.deleted'))
      onDeleted(gen.id)
    } catch (e) {
      toast.error(errMsg(e))
    }
  }

  const openInWorkspace = () => {
    if (!gen) return
    ws.loadFromGeneration(gen)
    navigate('/')
  }

  const meta = gen?.response_meta as Record<string, unknown> | undefined
  return (
    <Dialog open={!!id} onClose={onClose} sheet size="lg" title={t('gen.details')} description={gen ? formatDate(gen.created_at) : undefined}>
      {!gen ? (
        <div className="sheet-loading"><Spinner size={24} /></div>
      ) : (
        <div className="detail">
          <div className="detail-badges">
            <StatusBadge status={gen.status} />
            <Badge><ProviderIcon type={gen.provider_type} size={14} /> {gen.provider_name}</Badge>
            <Badge tone="accent">{modelLabel(gen.model) ?? gen.model}</Badge>
            <Badge>{t(`gen.mode.${gen.mode}`)}</Badge>
            {gen.duration_ms > 0 && <Badge>{formatDuration(gen.duration_ms)}</Badge>}
          </div>

          <div className="detail-prompt">
            <p>{gen.prompt}</p>
            <IconButton size="sm" label={t('gen.copyPrompt')} onClick={async () => (await copyText(gen.prompt)) && toast.success(t('gen.copied'))}><Copy size={14} /></IconButton>
          </div>

          <div className="detail-actions">
            <Button variant="primary" icon={<Wand2 size={16} />} onClick={openInWorkspace}>{t('history.openInWorkspace')}</Button>
            {gen.outputs.length > 0 && (
              <Button icon={<Download size={16} />} onClick={() => gen.outputs.forEach((o, i) => setTimeout(() => triggerDownload(downloadUrl(o.url)), i * 250))}>
                {gen.outputs.length > 1 ? t('gen.downloadAll') : t('gen.download')}
              </Button>
            )}
            <Button icon={<Heart size={16} fill={gen.favorite ? 'currentColor' : 'none'} />} className={gen.favorite ? 'is-fav' : ''} onClick={fav}>
              {gen.favorite ? t('gen.unfavorite') : t('gen.favorite')}
            </Button>
            <Button variant="ghost" className="danger-text" icon={<Trash2 size={16} />} onClick={del}>{t('gen.delete')}</Button>
          </div>

          {gen.error && (
            <div className="gen-error"><AlertCircle size={18} /><span className="gen-error-text">{gen.error}</span></div>
          )}

          {gen.outputs.length > 0 && (
            <section className="detail-section">
              <h3>{t('gen.outputs')}</h3>
              <div className={`detail-images count-${Math.min(gen.outputs.length, 2)}`}>
                {gen.outputs.map((img, i) => (
                  <button key={img.id} type="button" className="detail-image" onClick={() => setLightbox({ images: gen.outputs, index: i })}>
                    <img src={img.thumb_url} alt="" />
                    <span className="detail-image-meta">{img.width} × {img.height} · {formatBytes(img.bytes)}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {gen.inputs.length > 0 && (
            <section className="detail-section">
              <h3>{t('gen.inputs')}</h3>
              <div className="detail-inputs">
                {gen.inputs.map((img, i) => (
                  <button key={img.id} type="button" className="gen-input" onClick={() => setLightbox({ images: gen.inputs, index: i })}>
                    <img src={img.thumb_url} alt="" />
                  </button>
                ))}
              </div>
            </section>
          )}

          {gen.text && (
            <section className="detail-section">
              <h3>{t('gen.modelText')}</h3>
              <p className="detail-text">{gen.text}</p>
            </section>
          )}

          <section className="detail-section">
            <Segmented
              size="sm"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'params', label: t('history.params') },
                { value: 'request', label: t('history.requestLog') },
                { value: 'response', label: t('history.responseMeta') },
              ]}
            />
            <div className="detail-tab">
              {tab === 'params' && (
                <dl className="kv">
                  {[
                    [t('history.provider'), gen.provider_name],
                    [t('history.model'), <code key="m">{gen.model}</code>],
                    ...Object.entries(gen.params).map(([k, v]) => [k, <code key={k}>{String(v)}</code>]),
                    [t('gen.createdAt'), formatDate(gen.created_at)],
                    ...(gen.finished_at ? [[t('gen.duration'), formatDuration(gen.duration_ms)]] : []),
                  ].map(([k, v], i) => (
                    <div key={i} className="kv-row"><dt>{k}</dt><dd>{v}</dd></div>
                  ))}
                </dl>
              )}
              {tab === 'request' && (gen.request_log ? <JsonBlock value={gen.request_log} /> : <p className="muted">—</p>)}
              {tab === 'response' && (meta ? <JsonBlock value={meta} /> : <p className="muted">—</p>)}
            </div>
          </section>
        </div>
      )}
      <Lightbox
        images={lightbox.images}
        index={lightbox.index}
        onIndex={(index) => setLightbox((l) => ({ ...l, index }))}
        onUseAsReference={(img) => { ws.addImageRef(img); toast.success(t('workspace.addedReference')) }}
      />
    </Dialog>
  )
}
