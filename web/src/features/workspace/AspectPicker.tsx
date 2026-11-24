import { ratioBox } from '../../lib/models'
import { useI18n } from '../../i18n'

interface Props {
  ratios: string[]
  value: string
  onChange: (r: string) => void
  allowCustom?: boolean
}

function Glyph({ ratio }: { ratio: string }) {
  if (ratio === 'auto') return <span className="ratio-glyph is-auto" aria-hidden>✦</span>
  if (ratio === 'custom') return <span className="ratio-glyph is-custom" aria-hidden>⤢</span>
  const { w, h } = ratioBox(ratio)
  const max = 20
  const s = max / Math.max(w, h)
  return <span className="ratio-glyph" aria-hidden><span style={{ width: Math.max(4, w * s), height: Math.max(4, h * s) }} /></span>
}

export function AspectPicker({ ratios, value, onChange, allowCustom }: Props) {
  const { t } = useI18n()
  const all = allowCustom ? [...ratios, 'custom'] : ratios
  return (
    <div className="ratio-grid" role="radiogroup" aria-label={t('workspace.aspect')}>
      {all.map((r) => (
        <button
          key={r}
          type="button"
          role="radio"
          aria-checked={value === r}
          className={`ratio-chip${value === r ? ' is-active' : ''}`}
          onClick={() => onChange(r)}
        >
          <Glyph ratio={r} />
          <span>{r === 'auto' ? t('workspace.auto') : r === 'custom' ? t('workspace.custom') : r}</span>
        </button>
      ))}
    </div>
  )
}
