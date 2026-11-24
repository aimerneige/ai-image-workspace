import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, ClipboardPaste, Command, ImagePlus, Plug, Sparkles, Wand2, X } from 'lucide-react'
import { api } from '../api/client'
import type { Generation, ImageRef } from '../api/types'
import { newRefKey, useWorkspace, type RefItem } from '../app/workspace'
import { useAuth } from '../app/auth'
import { Button, EmptyState, IconButton, Kbd, Skeleton, TextArea, useToast } from '../components/ui'
import { ModelPicker } from '../features/workspace/ModelPicker'
import { ReferenceImages } from '../features/workspace/ReferenceImages'
import { ParamsPanel } from '../features/workspace/ParamsPanel'
import { GenerationCard } from '../features/workspace/GenerationCard'
import { Lightbox } from '../features/shared/Lightbox'
import { capabilities, toApiParams, validateCustomSize } from '../lib/models'
import { useErrorMessage } from '../lib/errors'
import { ACCEPTED_TYPES } from '../lib/utils'
import { useI18n } from '../i18n'

export function WorkspacePage() {
  const { t } = useI18n()
  const { user, meta } = useAuth()
  const toast = useToast()
  const errMsg = useErrorMessage()
  const ws = useWorkspace()
  const { composer, setComposer, providers, providersLoaded } = ws
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [lightbox, setLightbox] = useState<{ images: ImageRef[]; index: number | null }>({ images: [], index: null })
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const dragDepth = useRef(0)

  const provider = providers.find((p) => p.id === composer.providerId) ?? null
  const caps = useMemo(() => (provider ? capabilities(provider.type, composer.model) : null), [provider, composer.model])
  const maxRefs = caps?.maxRefs ?? 0
  const maxMB = meta?.max_upload_mb ?? 20

  const addFiles = useCallback(
    (files: File[]) => {
      if (!files.length) return
      setComposer((c) => {
        const next: RefItem[] = [...c.refs]
        for (const f of files) {
          if (!ACCEPTED_TYPES.includes(f.type)) {
            toast.error(t('errors.fileType'))
            continue
          }
          if (f.size > maxMB * 1024 * 1024) {
            toast.error(t('errors.fileTooLarge', { name: f.name, max: maxMB }))
            continue
          }
          if (maxRefs && next.length >= maxRefs) {
            toast.error(t('errors.tooManyRefs', { max: maxRefs }))
            break
          }
          next.push({ key: newRefKey(), kind: 'file', file: f, url: URL.createObjectURL(f) })
        }
        return { ...c, refs: next }
      })
    },
    [setComposer, toast, t, maxMB, maxRefs],
  )

  // Paste images from anywhere on the page.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'))
      if (files.length) {
        e.preventDefault()
        addFiles(files)
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [addFiles])

  const removeRef = (key: string) =>
    setComposer((c) => {
      const r = c.refs.find((x) => x.key === key)
      if (r?.kind === 'file') URL.revokeObjectURL(r.url)
      return { ...c, refs: c.refs.filter((x) => x.key !== key) }
    })

  const clearRefs = () =>
    setComposer((c) => {
      c.refs.forEach((r) => r.kind === 'file' && URL.revokeObjectURL(r.url))
      return { ...c, refs: [] }
    })

  const sizeInvalid = !!caps && caps.customSize && composer.params.ratio === 'custom' && !!validateCustomSize(composer.params.customW, composer.params.customH)
  const canSubmit = !!provider && !!composer.model && composer.prompt.trim().length > 0 && !sizeInvalid && !busy

  const submit = async () => {
    if (!provider || !caps) return
    if (!composer.prompt.trim()) {
      toast.error(t('errors.promptRequired'))
      promptRef.current?.focus()
      return
    }
    if (!canSubmit) return
    setBusy(true)
    try {
      const refs = composer.refs.slice(0, caps.maxRefs)
      const g = await api.createGeneration({
        provider_id: provider.id,
        model: composer.model,
        prompt: composer.prompt.trim(),
        params: toApiParams(caps, composer.params, refs.length > 0),
        reference_image_ids: refs.filter((r) => r.kind === 'image').map((r) => (r as { image: ImageRef }).image.id),
        files: refs.filter((r) => r.kind === 'file').map((r) => (r as { file: File }).file),
      })
      ws.upsert(g)
      // Uploaded files are now stored server-side; keep them as image refs so
      // follow-up runs do not upload again.
      setComposer((c) => ({
        ...c,
        refs: g.inputs.length === refs.length ? g.inputs.map((image) => ({ key: newRefKey(), kind: 'image' as const, image })) : c.refs,
      }))
    } catch (e) {
      toast.error(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  const rerun = async (g: Generation) => {
    try {
      const next = await api.createGeneration({
        provider_id: g.provider_id, model: g.model, prompt: g.prompt, params: g.params,
        reference_image_ids: g.inputs.map((i) => i.id), files: [],
      })
      ws.upsert(next)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (e) {
      toast.error(errMsg(e))
    }
  }

  const reuse = (g: Generation) => {
    ws.loadFromGeneration(g)
    toast.info(t('workspace.reused'))
    promptRef.current?.focus()
  }

  const useAsRef = (img: ImageRef) => {
    ws.addImageRef(img)
    toast.success(t('workspace.addedReference'))
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      submit()
    }
  }

  const refImages: ImageRef[] = composer.refs.map((r) =>
    r.kind === 'image' ? r.image : { id: r.key, role: 'input', url: r.url, thumb_url: r.url, mime: r.file.type, width: 0, height: 0, bytes: r.file.size },
  )
  const hasRefs = composer.refs.length > 0
  const running = ws.feed.filter((g) => g.status === 'running' || g.status === 'queued').length

  return (
    <div
      className="workspace"
      onKeyDown={onKeyDown}
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        dragDepth.current++
        setDragging(true)
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (dragDepth.current === 0) setDragging(false)
      }}
      onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        dragDepth.current = 0
        setDragging(false)
        addFiles(Array.from(e.dataTransfer.files))
      }}
    >
      <aside className="composer">
        {!providersLoaded ? (
          <div className="composer-inner">
            <Skeleton style={{ height: 56 }} />
            <Skeleton style={{ height: 160 }} />
            <Skeleton style={{ height: 120 }} />
          </div>
        ) : providers.length === 0 ? (
          <div className="composer-inner">
            <EmptyState
              icon={<Plug size={26} />}
              title={t('workspace.noProviders')}
              body={user?.role === 'admin' ? t('workspace.noProvidersAdmin') : t('workspace.noProvidersUser')}
              action={user?.role === 'admin' && (
                <Link to="/admin"><Button variant="primary" iconRight={<ArrowRight size={16} />}>{t('workspace.goToAdmin')}</Button></Link>
              )}
            />
          </div>
        ) : (
          <>
            <div className="composer-inner">
              <div className="composer-section">
                <div className="section-head"><span className="section-title">{t('workspace.model')}</span></div>
                <ModelPicker
                  providers={providers}
                  providerId={composer.providerId}
                  model={composer.model}
                  onChange={(providerId, model) => setComposer((c) => ({ ...c, providerId, model }))}
                />
              </div>

              <div className="composer-section">
                <div className="section-head">
                  <span className="section-title">{t('workspace.prompt')}</span>
                  {composer.prompt && (
                    <span className="section-tools">
                      <span className="muted small">{t('workspace.characters', { n: composer.prompt.length })}</span>
                      <IconButton size="sm" label={t('workspace.clearPrompt')} onClick={() => setComposer((c) => ({ ...c, prompt: '' }))}><X size={14} /></IconButton>
                    </span>
                  )}
                </div>
                <div className="prompt-box">
                  <TextArea
                    ref={promptRef}
                    className="prompt-input"
                    value={composer.prompt}
                    placeholder={hasRefs ? t('workspace.promptEditPlaceholder') : t('workspace.promptPlaceholder')}
                    onChange={(e) => setComposer((c) => ({ ...c, prompt: e.target.value }))}
                    rows={5}
                  />
                </div>
              </div>

              <div className="composer-section">
                <ReferenceImages
                  refs={composer.refs}
                  max={maxRefs}
                  onAdd={addFiles}
                  onRemove={removeRef}
                  onClear={clearRefs}
                  onPreview={(i) => setLightbox({ images: refImages, index: i })}
                />
              </div>

              {caps && (
                <div className="composer-section">
                  <ParamsPanel caps={caps} params={composer.params} hasRefs={hasRefs} onChange={(p) => setComposer((c) => ({ ...c, params: { ...c.params, ...p } }))} />
                </div>
              )}
            </div>
            <div className="composer-footer">
              <Button
                variant="gradient"
                size="lg"
                block
                className="generate-btn"
                loading={busy}
                disabled={!canSubmit}
                icon={hasRefs ? <Wand2 size={18} /> : <Sparkles size={18} />}
                onClick={submit}
              >
                {hasRefs ? t('workspace.editImages') : t('workspace.generate')}
              </Button>
              <div className="composer-hint">
                <Kbd><Command size={11} /> / Ctrl</Kbd> + <Kbd>Enter</Kbd>
              </div>
            </div>
          </>
        )}
      </aside>

      <section className="feed">
        <div className="feed-head">
          <h2 className="feed-title">
            {t('workspace.results')}
            {running > 0 && <span className="feed-running"><span className="pulse-dot" />{t('workspace.running', { n: running })}</span>}
          </h2>
          {ws.feed.length > 0 && (
            <Link to="/history" className="link-btn">{t('workspace.viewAll')} <ArrowRight size={14} /></Link>
          )}
        </div>
        {!ws.feedLoaded ? (
          <div className="feed-list">
            <Skeleton style={{ height: 320, borderRadius: 18 }} />
            <Skeleton style={{ height: 240, borderRadius: 18 }} />
          </div>
        ) : ws.feed.length === 0 ? (
          <div className="feed-empty">
            <div className="feed-empty-art" aria-hidden>
              <span /><span /><span />
              <Sparkles size={30} />
            </div>
            <h3>{t('workspace.emptyTitle')}</h3>
            <p>{t('workspace.emptyBody')}</p>
            <ul className="feed-tips">
              <li><ClipboardPaste size={16} />{t('workspace.tipPaste')}</li>
              <li><Command size={16} />{t('workspace.tipShortcut')}</li>
            </ul>
          </div>
        ) : (
          <div className="feed-list">
            {ws.feed.map((g) => (
              <GenerationCard
                key={g.id}
                gen={g}
                onOpen={(images, index) => setLightbox({ images, index })}
                onReuse={reuse}
                onRerun={rerun}
                onUseAsReference={useAsRef}
                onChange={ws.upsert}
                onDeleted={ws.remove}
              />
            ))}
          </div>
        )}
      </section>

      {dragging && (
        <div className="drop-overlay">
          <div className="drop-overlay-inner">
            <ImagePlus size={36} />
            <span>{t('workspace.dropHere')}</span>
          </div>
        </div>
      )}

      <Lightbox
        images={lightbox.images}
        index={lightbox.index}
        onIndex={(index) => setLightbox((l) => ({ ...l, index }))}
        onUseAsReference={lightbox.images[0]?.role === 'output' ? useAsRef : undefined}
      />
    </div>
  )
}
