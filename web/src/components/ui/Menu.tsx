import { cloneElement, useMemo, useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check } from 'lucide-react'
import { useFloating, useOutside, usePresence, type Placement } from './hooks'

export interface MenuItem {
  key: string
  label: ReactNode
  icon?: ReactNode
  onSelect?: () => void
  checked?: boolean
  danger?: boolean
  divider?: boolean
  header?: boolean
}

interface Props {
  trigger: ReactElement<Record<string, unknown>>
  items: MenuItem[]
  placement?: Placement
  header?: ReactNode
}

/** Dropdown action menu with keyboard support. */
export function Menu({ trigger, items, placement = 'bottom-end', header }: Props) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLElement | null>(null)
  const menu = useRef<HTMLDivElement>(null)
  const { mounted, visible } = usePresence(open, 140)
  const { pos } = useFloating(anchor, menu, mounted, placement, 8)
  const refs = useMemo(() => [anchor, menu], [])
  useOutside(refs, () => setOpen(false), open)

  const focusItem = (dir: 1 | -1 | 0) => {
    const els = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"],[role="menuitemradio"]') ?? [])
    if (!els.length) return
    const i = els.indexOf(document.activeElement as HTMLElement)
    const next = dir === 0 ? 0 : (i + dir + els.length) % els.length
    els[next].focus()
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      setOpen(false)
      anchor.current?.focus()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      focusItem(1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      focusItem(-1)
    } else if (e.key === 'Tab') setOpen(false)
  }

  return (
    <>
      {cloneElement(trigger, {
        ref: (el: HTMLElement | null) => {
          anchor.current = el
        },
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        onClick: () => {
          setOpen((o) => !o)
          if (!open) setTimeout(() => focusItem(0), 30)
        },
        onKeyDown: (e: KeyboardEvent) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault()
            setOpen(true)
            setTimeout(() => focusItem(0), 30)
          }
        },
      })}
      {mounted &&
        createPortal(
          <div
            ref={menu}
            role="menu"
            className={`popover menu${visible && pos ? ' is-visible' : ''}`}
            style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, transformOrigin: pos?.origin }}
            onKeyDown={onKey}
          >
            {header && <div className="menu-header">{header}</div>}
            {items.map((it) =>
              it.divider ? (
                <div key={it.key} className="menu-divider" role="separator" />
              ) : it.header ? (
                <div key={it.key} className="menu-section">{it.label}</div>
              ) : (
                <button
                  key={it.key}
                  type="button"
                  role={it.checked !== undefined ? 'menuitemradio' : 'menuitem'}
                  aria-checked={it.checked}
                  className={`menu-item${it.danger ? ' is-danger' : ''}`}
                  onClick={() => {
                    setOpen(false)
                    it.onSelect?.()
                  }}
                >
                  <span className="menu-item-icon">{it.icon}</span>
                  <span className="menu-item-label">{it.label}</span>
                  {it.checked && <Check size={15} className="menu-check" />}
                </button>
              ),
            )}
          </div>,
          document.body,
        )}
    </>
  )
}
