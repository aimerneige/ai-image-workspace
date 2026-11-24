import { useState, type KeyboardEvent } from 'react'
import { Plus, X } from 'lucide-react'

interface Props {
  value: string[]
  onChange: (v: string[]) => void
  placeholder?: string
  suggestions?: string[]
  suggestionsLabel?: string
  disabled?: boolean
}

export function TagInput({ value, onChange, placeholder, suggestions = [], suggestionsLabel, disabled }: Props) {
  const [text, setText] = useState('')
  const add = (raw: string) => {
    const items = raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)
    const next = [...value]
    for (const it of items) if (!next.includes(it)) next.push(it)
    onChange(next)
    setText('')
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === 'Enter' || e.key === ',') && text.trim()) {
      e.preventDefault()
      add(text)
    } else if (e.key === 'Backspace' && !text && value.length) {
      onChange(value.slice(0, -1))
    }
  }
  const rest = suggestions.filter((s) => !value.includes(s))
  return (
    <div className="tag-input-root">
      <div className={`tag-input${disabled ? ' is-disabled' : ''}`}>
        {value.map((v, i) => (
          <span key={v} className={`tag${i === 0 ? ' is-primary' : ''}`}>
            {v}
            {!disabled && (
              <button type="button" aria-label={`remove ${v}`} onClick={() => onChange(value.filter((x) => x !== v))}>
                <X size={12} />
              </button>
            )}
          </span>
        ))}
        {!disabled && (
          <input
            value={text}
            placeholder={value.length ? '' : placeholder}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            onBlur={() => text.trim() && add(text)}
          />
        )}
      </div>
      {!disabled && rest.length > 0 && (
        <div className="tag-suggestions">
          {suggestionsLabel && <span className="tag-suggestions-label">{suggestionsLabel}</span>}
          {rest.map((s) => (
            <button key={s} type="button" className="tag-suggestion" onClick={() => add(s)}>
              <Plus size={12} />
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
