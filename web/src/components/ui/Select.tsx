import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'
import { useFloating, useId, useOutside, usePresence } from './hooks'
import { useI18n } from '../../i18n'

export interface SelectOption<T extends string = string> {
  value: T
  label: ReactNode
  /** Plain text used for type-ahead and the trigger when label is a node. */
  text?: string
  description?: ReactNode
  icon?: ReactNode
  badge?: ReactNode
  group?: string
  disabled?: boolean
}

interface Props<T extends string> {
  value: T | null
  options: SelectOption<T>[]
  onChange: (value: T) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  size?: 'sm' | 'md' | 'lg'
  ariaLabel?: string
  /** Custom trigger content for the selected option. */
  renderValue?: (opt: SelectOption<T>) => ReactNode
  menuWidth?: number
}

/** Fully custom listbox replacing the native <select>. */
export function Select<T extends string>({
  value, options, onChange, placeholder, disabled, className = '', size = 'md', ariaLabel, renderValue, menuWidth,
}: Props<T>) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const typeahead = useRef({ text: '', at: 0 })
  const id = useId('select')
  const { mounted, visible } = usePresence(open, 140)
  const { pos } = useFloating(trigger, menu, mounted, 'bottom-start', 6, true)
  const refs = useMemo(() => [trigger, menu], [])
  useOutside(refs, () => setOpen(false), open)

  const selectedIndex = options.findIndex((o) => o.value === value)
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null

  useEffect(() => {
    if (open) setActive(selectedIndex >= 0 ? selectedIndex : options.findIndex((o) => !o.disabled))
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open || active < 0) return
    menu.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active, open, mounted])

  const move = (dir: 1 | -1) => {
    if (!options.length) return
    let i = active
    for (let n = 0; n < options.length; n++) {
      i = (i + dir + options.length) % options.length
      if (!options[i].disabled) break
    }
    setActive(i)
  }

  const choose = (i: number) => {
    const o = options[i]
    if (!o || o.disabled) return
    onChange(o.value)
    setOpen(false)
    trigger.current?.focus()
  }

  const onKey = (e: KeyboardEvent) => {
    if (disabled) return
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        e.preventDefault()
        if (!open) setOpen(true)
        else move(e.key === 'ArrowDown' ? 1 : -1)
        break
      case 'Home':
      case 'End':
        if (open) {
          e.preventDefault()
          setActive(e.key === 'Home' ? 0 : options.length - 1)
        }
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        if (open && active >= 0) choose(active)
        else setOpen(true)
        break
      case 'Escape':
        if (open) {
          e.preventDefault()
          e.stopPropagation()
          setOpen(false)
        }
        break
      case 'Tab':
        setOpen(false)
        break
      default:
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
          const now = Date.now()
          const ta = typeahead.current
          ta.text = now - ta.at > 600 ? e.key.toLowerCase() : ta.text + e.key.toLowerCase()
          ta.at = now
          const i = options.findIndex((o) => !o.disabled && (o.text ?? String(o.label)).toLowerCase().startsWith(ta.text))
          if (i >= 0) {
            if (open) setActive(i)
            else onChange(options[i].value)
          }
        }
    }
  }

  let lastGroup: string | undefined
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={`select-trigger select-${size}${open ? ' is-open' : ''} ${className}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKey}
      >
        <span className="select-value">
          {selected ? (
            renderValue ? renderValue(selected) : (
              <>
                {selected.icon}
                <span className="truncate">{selected.label}</span>
              </>
            )
          ) : (
            <span className="select-placeholder">{placeholder}</span>
          )}
        </span>
        <ChevronDown size={16} className="select-chevron" />
      </button>
      {mounted &&
        createPortal(
          <div
            ref={menu}
            id={id}
            role="listbox"
            tabIndex={-1}
            className={`popover select-menu${visible && pos ? ' is-visible' : ''}`}
            style={{
              top: pos?.top ?? -9999, left: pos?.left ?? -9999, minWidth: pos?.minWidth, width: menuWidth,
              maxHeight: pos ? Math.min(pos.maxHeight, 380) : 380, transformOrigin: pos?.origin,
            }}
            onKeyDown={onKey}
          >
            {options.length === 0 && <div className="select-empty">{t('common.noOptions')}</div>}
            {options.map((o, i) => {
              const header = o.group && o.group !== lastGroup ? o.group : null
              lastGroup = o.group
              return (
                <div key={o.value}>
                  {header && <div className="select-group">{header}</div>}
                  <div
                    role="option"
                    data-index={i}
                    aria-selected={o.value === value}
                    aria-disabled={o.disabled}
                    className={`select-option${i === active ? ' is-active' : ''}${o.value === value ? ' is-selected' : ''}${o.disabled ? ' is-disabled' : ''}`}
                    onPointerEnter={() => setActive(i)}
                    onClick={() => choose(i)}
                  >
                    {o.icon && <span className="select-option-icon">{o.icon}</span>}
                    <span className="select-option-body">
                      <span className="select-option-label">
                        {o.label}
                        {o.badge}
                      </span>
                      {o.description && <span className="select-option-desc">{o.description}</span>}
                    </span>
                    <Check size={16} className="select-check" />
                  </div>
                </div>
              )
            })}
          </div>,
          document.body,
        )}
    </>
  )
}
