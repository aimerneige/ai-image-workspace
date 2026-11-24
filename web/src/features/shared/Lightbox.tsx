import { useEffect, useRef, useState, type PointerEvent, type WheelEvent } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, Copy, Download, ImagePlus, Maximize, X, ZoomIn, ZoomOut } from 'lucide-react'
import type { ImageRef } from '../../api/types'
import { downloadUrl } from '../../api/client'
import { IconButton, useToast } from '../../components/ui'
import { usePresence, useScrollLock } from '../../components/ui/hooks'
import { useI18n } from '../../i18n'
import { copyImage, formatBytes, triggerDownload } from '../../lib/utils'

interface Props {
  images: ImageRef[]
  index: number | null
  onIndex: (i: number | null) => void
  onUseAsReference?: (img: ImageRef) => void
}

export function Lightbox({ images, index, onIndex, onUseAsReference }: Props) {
  const { t } = useI18n()
  const toast = useToast()
  const open = index !== null && images.length > 0
  const { mounted, visible } = usePresence(open, 200)
  const [last, setLast] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [loaded, setLoaded] = useState(false)
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null)
  useScrollLock(mounted)

  useEffect(() => {
    if (index !== null) setLast(index)
    setZoom(1)
    setPan({ x: 0, y: 0 })
    setLoaded(false)
  }, [index])

  const i = index ?? last
  const img = images[Math.min(i, images.length - 1)]
  const go = (d: number) => images.length > 1 && onIndex((i + d + images.length) % images.length)
  const setZ = (z: number) => {
    const nz = Math.min(6, Math.max(1, z))
    setZoom(nz)
    if (nz === 1) setPan({ x: 0, y: 0 })
  }

  useEffect(() => {
    if (!open) return
    // Capture phase + stopPropagation so an underlying dialog does not also
    // react to Escape/arrow keys.
    const onKey = (e: KeyboardEvent) => {
      const handled = ['Escape', 'ArrowRight', 'ArrowLeft', '+', '=', '-', '0']
      if (!handled.includes(e.key)) return
      e.stopPropagation()
      e.preventDefault()
      if (e.key === 'Escape') onIndex(null)
      else if (e.key === 'ArrowRight') go(1)
      else if (e.key === 'ArrowLeft') go(-1)
      else if (e.key === '+' || e.key === '=') setZ(zoom * 1.5)
      else if (e.key === '-') setZ(zoom / 1.5)
      else setZ(1)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  if (!mounted || !img) return null

  const onWheel = (e: WheelEvent) => setZ(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15))
  const onDown = (e: PointerEvent) => {
    if (zoom === 1) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }
  }
  const onMove = (e: PointerEvent) => {
    if (!drag.current) return
    setPan({ x: drag.current.px + (e.clientX - drag.current.x) / zoom, y: drag.current.py + (e.clientY - drag.current.y) / zoom })
  }

  return createPortal(
    <div className={`lightbox${visible ? ' is-visible' : ''}`} role="dialog" aria-modal="true">
      <div className="lightbox-backdrop" onClick={() => onIndex(null)} />
      <div className="lightbox-top">
        <span className="lightbox-info">
          {images.length > 1 && <strong>{i + 1} / {images.length}</strong>}
          {img.width > 0 && <span>{img.width} × {img.height}</span>}
          <span>{formatBytes(img.bytes)}</span>
        </span>
        <div className="lightbox-actions">
          <IconButton variant="overlay" label={t('gen.zoomOut')} onClick={() => setZ(zoom / 1.5)} disabled={zoom <= 1} placement="bottom"><ZoomOut size={18} /></IconButton>
          <IconButton variant="overlay" label={t('gen.resetZoom')} onClick={() => setZ(1)} placement="bottom"><Maximize size={18} /></IconButton>
          <IconButton variant="overlay" label={t('gen.zoomIn')} onClick={() => setZ(zoom * 1.5)} disabled={zoom >= 6} placement="bottom"><ZoomIn size={18} /></IconButton>
          <span className="lightbox-sep" />
          {onUseAsReference && (
            <IconButton variant="overlay" label={t('gen.useAsReference')} placement="bottom" onClick={() => { onUseAsReference(img); onIndex(null) }}>
              <ImagePlus size={18} />
            </IconButton>
          )}
          <IconButton
            variant="overlay"
            label={t('gen.copyImage')}
            placement="bottom"
            onClick={async () => ((await copyImage(img.url)) ? toast.success(t('gen.imageCopied')) : toast.error(t('gen.copyFailed')))}
          >
            <Copy size={18} />
          </IconButton>
          <IconButton variant="overlay" label={t('gen.download')} placement="bottom" onClick={() => triggerDownload(downloadUrl(img.url))}><Download size={18} /></IconButton>
          <IconButton variant="overlay" label={t('common.close')} placement="bottom" onClick={() => onIndex(null)}><X size={20} /></IconButton>
        </div>
      </div>
      <div
        className={`lightbox-stage${zoom > 1 ? ' is-zoomed' : ''}`}
        onWheel={onWheel}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={() => (drag.current = null)}
        onClick={(e) => e.target === e.currentTarget && zoom === 1 && onIndex(null)}
      >
        {!loaded && <img className="lightbox-img lightbox-placeholder" src={img.thumb_url} alt="" aria-hidden />}
        <img
          key={img.id}
          className={`lightbox-img${loaded ? ' is-loaded' : ''}`}
          src={img.url}
          alt=""
          draggable={false}
          onLoad={() => setLoaded(true)}
          onDoubleClick={() => setZ(zoom > 1 ? 1 : 2.5)}
          style={{ transform: `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)` }}
        />
      </div>
      {images.length > 1 && (
        <>
          <button type="button" className="lightbox-nav is-prev" aria-label={t('gen.previous')} onClick={() => go(-1)}><ChevronLeft size={26} /></button>
          <button type="button" className="lightbox-nav is-next" aria-label={t('gen.next')} onClick={() => go(1)}><ChevronRight size={26} /></button>
          <div className="lightbox-strip">
            {images.map((im, k) => (
              <button key={im.id} type="button" className={`lightbox-thumb${k === i ? ' is-active' : ''}`} onClick={() => onIndex(k)}>
                <img src={im.thumb_url} alt="" />
              </button>
            ))}
          </div>
        </>
      )}
    </div>,
    document.body,
  )
}
