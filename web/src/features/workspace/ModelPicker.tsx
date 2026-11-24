import { Sparkles } from 'lucide-react'
import type { Provider } from '../../api/types'
import { Select, type SelectOption } from '../../components/ui'
import { isFeatured, modelLabel } from '../../lib/models'
import { useI18n } from '../../i18n'

export function ProviderIcon({ type, size = 18 }: { type: string; size?: number }) {
  return <span className={`provider-icon provider-${type}`} style={{ width: size, height: size, fontSize: Math.round(size * 0.5) }} aria-hidden>{type === 'openai' ? 'O' : 'G'}</span>
}

interface Props {
  providers: Provider[]
  providerId: number | null
  model: string
  onChange: (providerId: number, model: string) => void
}

/** Grouped picker: provider → models, with friendly names. */
export function ModelPicker({ providers, providerId, model, onChange }: Props) {
  const { t } = useI18n()
  const options: SelectOption[] = providers.flatMap((p) =>
    p.models.map((m) => {
      const label = modelLabel(m)
      return {
        value: `${p.id}::${m}`,
        text: label ?? m,
        group: p.name,
        icon: <ProviderIcon type={p.type} />,
        label: label ?? m,
        description: label ? m : p.type === 'openai' ? t('admin.providers.typeOpenAI') : t('admin.providers.typeGemini'),
        badge: isFeatured(m) ? <Sparkles size={13} className="featured-badge" /> : undefined,
      }
    }),
  )
  const current = providerId ? `${providerId}::${model}` : null
  return (
    <Select
      size="lg"
      value={current}
      options={options}
      ariaLabel={t('workspace.model')}
      onChange={(v) => {
        const [id, ...rest] = v.split('::')
        onChange(Number(id), rest.join('::'))
      }}
      renderValue={(o) => (
        <span className="model-value">
          {o.icon}
          <span className="model-value-text">
            <span className="model-value-label">{o.label}{o.badge}</span>
            <span className="model-value-sub">{o.group} · {o.value.split('::').slice(1).join('::')}</span>
          </span>
        </span>
      )}
    />
  )
}
