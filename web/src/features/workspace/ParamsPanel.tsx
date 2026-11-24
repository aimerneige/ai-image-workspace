import { useState } from 'react'
import { ChevronDown, Globe } from 'lucide-react'
import { Input, Segmented, Slider, Stepper, Switch } from '../../components/ui'
import { AspectPicker } from './AspectPicker'
import { resolvedSize, validateCustomSize, type Capabilities, type ComposerParams } from '../../lib/models'
import { useI18n } from '../../i18n'
import type { MessageKey } from '../../i18n/types'

interface Props {
  caps: Capabilities
  params: ComposerParams
  hasRefs: boolean
  onChange: (p: Partial<ComposerParams>) => void
}

function Row({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="param-row">
      <div className="param-label">
        <span>{label}</span>
        {hint && <span className="param-hint">{hint}</span>}
      </div>
      <div className="param-control">{children}</div>
    </div>
  )
}

export function ParamsPanel({ caps, params: p, hasRefs, onChange }: Props) {
  const { t } = useI18n()
  const [advanced, setAdvanced] = useState(false)
  const label = (k: string) => t(`workspace.${k}` as MessageKey)
  const ratio = caps.ratios.includes(p.ratio) || (p.ratio === 'custom' && caps.customSize) ? p.ratio : 'auto'
  const size = resolvedSize(caps, { ...p, ratio })
  const sizeErr = ratio === 'custom' ? validateCustomSize(p.customW, p.customH) : null
  const showTier = caps.tiers.length > 0 && (caps.type === 'gemini' || (ratio !== 'auto' && ratio !== 'custom'))
  const isOpenAI = caps.type === 'openai'

  return (
    <div className="params">
      <div className="param-block">
        <div className="section-head">
          <span className="section-title">{t('workspace.aspect')}</span>
          {size && !sizeErr && <span className="size-readout">{t('workspace.outputSize', { w: size.w, h: size.h })}</span>}
        </div>
        <AspectPicker ratios={caps.ratios} value={ratio} allowCustom={caps.customSize} onChange={(r) => onChange({ ratio: r })} />
        {ratio === 'custom' && (
          <div className="custom-size">
            <Input type="number" inputMode="numeric" step={16} min={16} max={3840} value={p.customW} aria-label={t('workspace.width')}
              suffix="W" invalid={!!sizeErr} onChange={(e) => onChange({ customW: Number(e.target.value) })} />
            <span className="custom-x">×</span>
            <Input type="number" inputMode="numeric" step={16} min={16} max={3840} value={p.customH} aria-label={t('workspace.height')}
              suffix="H" invalid={!!sizeErr} onChange={(e) => onChange({ customH: Number(e.target.value) })} />
          </div>
        )}
        {sizeErr && <div className="field-error">{t(`workspace.${sizeErr}`)}</div>}
      </div>

      {showTier && (
        <Row label={t('workspace.resolution')} hint={isOpenAI && p.tier === '4K' ? t('workspace.experimental') : undefined}>
          <Segmented block size="sm" value={caps.tiers.includes(p.tier) ? p.tier : caps.tiers[0]} onChange={(v) => onChange({ tier: v })}
            options={caps.tiers.map((x) => ({ value: x, label: x }))} />
        </Row>
      )}

      {caps.qualities.length > 0 && (
        <Row label={t('workspace.quality')}>
          <Segmented block size="sm" value={caps.qualities.includes(p.quality) ? p.quality : 'auto'} onChange={(v) => onChange({ quality: v })}
            options={caps.qualities.map((q) => ({ value: q, label: label(q) }))} />
        </Row>
      )}

      <Row label={t('workspace.count')}>
        <Stepper value={Math.min(p.n, caps.maxN)} min={1} max={caps.maxN} onChange={(n) => onChange({ n })} label={t('workspace.count')} />
      </Row>

      {caps.googleSearch && (
        <div className="param-toggle">
          <Globe size={16} />
          <div className="param-toggle-text">
            <span>{t('workspace.googleSearch')}</span>
            <span className="param-hint">{t('workspace.googleSearchHint')}</span>
          </div>
          <Switch checked={p.googleSearch} onChange={(v) => onChange({ googleSearch: v })} label={t('workspace.googleSearch')} />
        </div>
      )}

      {isOpenAI && (
        <>
          <button type="button" className={`advanced-toggle${advanced ? ' is-open' : ''}`} onClick={() => setAdvanced((a) => !a)} aria-expanded={advanced}>
            {t('workspace.advanced')}
            <ChevronDown size={16} />
          </button>
          <div className={`collapse${advanced ? ' is-open' : ''}`}>
            <div className="collapse-inner">
              {caps.transparent && (
                <Row label={t('workspace.background')}>
                  <Segmented block size="sm" value={p.background} onChange={(v) => onChange({ background: v, ...(v === 'transparent' && p.outputFormat === 'jpeg' ? { outputFormat: 'png' } : {}) })}
                    options={['auto', 'opaque', 'transparent'].map((x) => ({ value: x, label: label(x) }))} />
                </Row>
              )}
              <Row label={t('workspace.format')}>
                <Segmented block size="sm" value={p.outputFormat} onChange={(v) => onChange({ outputFormat: v })}
                  options={[
                    { value: 'png', label: 'PNG' },
                    { value: 'webp', label: 'WebP' },
                    { value: 'jpeg', label: 'JPEG', disabled: p.background === 'transparent' },
                  ]} />
              </Row>
              {p.outputFormat !== 'png' && (
                <Row label={t('workspace.compression')}>
                  <Slider value={p.compression} min={0} max={100} step={5} onChange={(v) => onChange({ compression: v })} format={(v) => `${v}%`} label={t('workspace.compression')} />
                </Row>
              )}
              <Row label={t('workspace.moderation')}>
                <Segmented block size="sm" value={p.moderation} onChange={(v) => onChange({ moderation: v })}
                  options={[{ value: 'auto', label: t('workspace.standard') }, { value: 'low', label: t('workspace.low') }]} />
              </Row>
              {caps.inputFidelity && hasRefs && (
                <Row label={t('workspace.fidelity')} hint={t('workspace.fidelityHint')}>
                  <Segmented block size="sm" value={p.inputFidelity} onChange={(v) => onChange({ inputFidelity: v })}
                    options={[{ value: 'low', label: t('workspace.low') }, { value: 'high', label: t('workspace.high') }]} />
                </Row>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
