import { useRef } from 'react'
import { ImagePlus, X } from 'lucide-react'
import type { RefItem } from '../../app/workspace'
import { useI18n } from '../../i18n'
import { ACCEPTED_TYPES } from '../../lib/utils'

interface Props {
  refs: RefItem[]
  max: number
  onAdd: (files: File[]) => void
  onRemove: (key: string) => void
  onClear: () => void
  onPreview: (index: number) => void
}

export function ReferenceImages({ refs, max, onAdd, onRemove, onClear, onPreview }: Props) {
  const { t } = useI18n()
  const input = useRef<HTMLInputElement>(null)
  return (
    <div className="refs">
      <div className="section-head">
        <span className="section-title">
          {t('workspace.references')}
          <span className="section-count">{refs.length}/{max}</span>
        </span>
        {refs.length > 0 && (
          <button type="button" className="link-btn" onClick={onClear}>{t('workspace.clearAll')}</button>
        )}
      </div>
      <div className="refs-grid">
        {refs.map((r, i) => (
          <div key={r.key} className="ref-tile">
            <button type="button" className="ref-img" onClick={() => onPreview(i)}>
              <img src={r.kind === 'file' ? r.url : r.image.thumb_url} alt="" />
            </button>
            <button type="button" className="ref-remove" aria-label={t('workspace.removeImage')} onClick={() => onRemove(r.key)}>
              <X size={12} />
            </button>
          </div>
        ))}
        {refs.length < max && (
          <button type="button" className={`ref-add${refs.length === 0 ? ' is-wide' : ''}`} onClick={() => input.current?.click()}>
            <ImagePlus size={refs.length === 0 ? 20 : 18} />
            {refs.length === 0 ? <span>{t('workspace.referencesHint', { max })}</span> : <span>{t('workspace.addImage')}</span>}
          </button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept={ACCEPTED_TYPES.join(',')}
        multiple
        hidden
        onChange={(e) => {
          onAdd(Array.from(e.target.files ?? []))
          e.target.value = ''
        }}
      />
    </div>
  )
}
