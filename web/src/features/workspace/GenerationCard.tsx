import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertCircle, Copy, Download, FileText, Heart, ImagePlus, Maximize2, MoreHorizontal, RefreshCw, RotateCcw, Square, Trash2, Wand2,
} from 'lucide-react'
import type { Generation, ImageRef } from '../../api/types'
import { api, downloadUrl } from '../../api/client'
import { Badge, Button, IconButton, Menu, useConfirm, useToast } from '../../components/ui'
import { useI18n } from '../../i18n'
import { modelLabel } from '../../lib/models'
import { copyText, formatDuration, triggerDownload } from '../../lib/utils'
import { useErrorMessage } from '../../lib/errors'
import { ProviderIcon } from './ModelPicker'

export function StatusBadge({ status }: { status: Generation['status'] }) {
  const { t } = useI18n()
  const tone = { queued: 'neutral', running: 'accent', succeeded: 'success', failed: 'danger', canceled: 'warning' } as const
  return (
    <Badge tone={tone[status]} className={`status-badge status-${status}`}>
      <span className="status-dot" />
      {t(`gen.status.${status}`)}
    </Badge>
  )
}

/** Aspect ratio (w/h) the generation was asked for; used for placeholders. */
export function requestedAspect(g: Generation): number {
  const p = g.params
  if (p.size && p.size !== 'auto') {
    const [w, h] = p.size.split('x').map(Number)
    if (w && h) return w / h
  }
  if (p.aspect_ratio) {
    const [a, b] = p.aspect_ratio.split(':').map(Number)
    if (a && b) return a / b
  }
  return 1
}

function Elapsed({ since }: { since: string }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [])
  const s = Math.max(0, (now - new Date(since).getTime()) / 1000)
  return <span className="elapsed">{s.toFixed(1)}s</span>
}

interface Props {
  gen: Generation
  onOpen: (images: ImageRef[], index: number) => void
  onReuse: (g: Generation) => void
  onRerun: (g: Generation) => void
  onUseAsReference: (img: ImageRef) => void
  onChange: (g: Generation) => void
  onDeleted: (id: string) => void
}

export function GenerationCard({ gen, onOpen, onReuse, onRerun, onUseAsReference, onChange, onDeleted }: Props) {
  const { t, formatRelative } = useI18n()
  const toast = useToast()
  const confirm = useConfirm()
  const errMsg = useErrorMessage()
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState(false)
  const [showText, setShowText] = useState(false)
  const running = gen.status === 'running' || gen.status === 'queued'
  const aspect = requestedAspect(gen)
  const placeholders = Math.min(gen.params.n ?? 1, 4)

  const toggleFav = async () => {
    try {
      await api.setFavorite(gen.id, !gen.favorite)
      onChange({ ...gen, favorite: !gen.favorite })
    } catch (e) {
      toast.error(errMsg(e))
    }
  }
  const del = async () => {
    const ok = await confirm({ title: t('gen.deleteConfirmTitle'), body: t('gen.deleteConfirmBody'), confirmText: t('common.delete'), danger: true })
    if (!ok) return
    try {
      await api.deleteGeneration(gen.id)
      onDeleted(gen.id)
      toast.success(t('gen.deleted'))
    } catch (e) {
      toast.error(errMsg(e))
    }
  }
  const cancel = async () => {
    try {
      await api.cancelGeneration(gen.id)
      toast.info(t('gen.canceled'))
    } catch (e) {
      toast.error(errMsg(e))
    }
  }

  return (
    <article className={`gen-card is-${gen.status}`}>
      <header className="gen-head">
        <div className="gen-meta">
          <StatusBadge status={gen.status} />
          <span className="gen-model">
            <ProviderIcon type={gen.provider_type} size={16} />
            {modelLabel(gen.model) ?? gen.model}
          </span>
          <span className="gen-chip">{t(`gen.mode.${gen.mode}`)}</span>
          {gen.params.size && gen.params.size !== 'auto' && <span className="gen-chip">{gen.params.size.replace('x', '×')}</span>}
          {gen.params.aspect_ratio && <span className="gen-chip">{gen.params.aspect_ratio}</span>}
          {gen.params.image_size && <span className="gen-chip">{gen.params.image_size}</span>}
          {gen.params.quality && <span className="gen-chip">{t(`workspace.${gen.params.quality}` as 'workspace.high')}</span>}
        </div>
        <div className="gen-head-right">
          <span className="gen-time" title={new Date(gen.created_at).toLocaleString()}>{formatRelative(gen.created_at)}</span>
          <IconButton size="sm" label={gen.favorite ? t('gen.unfavorite') : t('gen.favorite')} active={gen.favorite} className="fav-btn" onClick={toggleFav}>
            <Heart size={16} fill={gen.favorite ? 'currentColor' : 'none'} />
          </IconButton>
          <Menu
            trigger={<IconButton size="sm" label={t('gen.details')}><MoreHorizontal size={16} /></IconButton>}
            items={[
              { key: 'reuse', label: t('gen.reuse'), icon: <Wand2 size={16} />, onSelect: () => onReuse(gen) },
              { key: 'rerun', label: t('gen.retry'), icon: <RotateCcw size={16} />, onSelect: () => onRerun(gen) },
              { key: 'copy', label: t('gen.copyPrompt'), icon: <Copy size={16} />, onSelect: async () => (await copyText(gen.prompt)) && toast.success(t('gen.copied')) },
              { key: 'details', label: t('gen.details'), icon: <FileText size={16} />, onSelect: () => navigate(`/history?id=${gen.id}`) },
              { key: 'd', label: '', divider: true },
              { key: 'del', label: t('gen.delete'), icon: <Trash2 size={16} />, danger: true, onSelect: del },
            ]}
          />
        </div>
      </header>

      <p className={`gen-prompt${expanded ? ' is-expanded' : ''}`} onClick={() => setExpanded((e) => !e)}>{gen.prompt}</p>

      {gen.inputs.length > 0 && (
        <div className="gen-inputs">
          {gen.inputs.map((img, i) => (
            <button key={img.id} type="button" className="gen-input" onClick={() => onOpen(gen.inputs, i)}>
              <img src={img.thumb_url} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}

      {running && (
        <div className="gen-running">
          <div className={`gen-grid count-${placeholders}`}>
            {Array.from({ length: placeholders }).map((_, i) => (
              <div key={i} className="gen-placeholder" style={{ aspectRatio: String(aspect) }}>
                <div className="gen-placeholder-glow" />
              </div>
            ))}
          </div>
          <div className="gen-running-bar">
            <span className="gen-running-text">
              <span className="pulse-dot" />
              {t('gen.waiting')}
              {gen.started_at && <Elapsed since={gen.started_at} />}
            </span>
            <Button size="sm" variant="ghost" icon={<Square size={14} />} onClick={cancel}>{t('gen.cancel')}</Button>
          </div>
        </div>
      )}

      {gen.outputs.length > 0 && (
        <div className={`gen-grid count-${Math.min(gen.outputs.length, 4)}`}>
          {gen.outputs.map((img, i) => (
            <div key={img.id} className="gen-image" style={{ aspectRatio: img.width && img.height ? `${img.width} / ${img.height}` : undefined }}>
              <button type="button" className="gen-image-btn" onClick={() => onOpen(gen.outputs, i)}>
                <img src={img.thumb_url} alt="" loading="lazy" />
              </button>
              <div className="gen-image-actions">
                <IconButton size="sm" variant="overlay" label={t('gen.useAsReference')} onClick={() => onUseAsReference(img)}><ImagePlus size={15} /></IconButton>
                <IconButton size="sm" variant="overlay" label={t('gen.download')} onClick={() => triggerDownload(downloadUrl(img.url))}><Download size={15} /></IconButton>
                <IconButton size="sm" variant="overlay" label={t('gen.details')} onClick={() => onOpen(gen.outputs, i)}><Maximize2 size={15} /></IconButton>
              </div>
            </div>
          ))}
        </div>
      )}

      {(gen.status === 'failed' || gen.status === 'canceled') && (
        <div className={`gen-error${gen.status === 'canceled' ? ' is-muted' : ''}`}>
          <AlertCircle size={18} />
          <span className="gen-error-text">{gen.error || t(`gen.status.${gen.status}`)}</span>
          <Button size="sm" variant="secondary" icon={<RefreshCw size={14} />} onClick={() => onRerun(gen)}>{t('gen.retry')}</Button>
        </div>
      )}

      {gen.text && (
        <div className="gen-text">
          <button type="button" className="link-btn" onClick={() => setShowText((s) => !s)}>
            <FileText size={14} /> {t('gen.modelText')}
          </button>
          {showText && <p>{gen.text}</p>}
        </div>
      )}

      {!running && gen.duration_ms > 0 && (
        <footer className="gen-foot">
          <span>{gen.provider_name}</span>
          <span>·</span>
          <span>{t('gen.duration')} {formatDuration(gen.duration_ms)}</span>
          {gen.outputs[0]?.width > 0 && (
            <>
              <span>·</span>
              <span>{gen.outputs[0].width} × {gen.outputs[0].height}</span>
            </>
          )}
        </footer>
      )}
    </article>
  )
}
