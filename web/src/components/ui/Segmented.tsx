import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

export interface SegmentOption<T extends string> {
  value: T
  label: ReactNode
  title?: string
  disabled?: boolean
}

interface Props<T extends string> {
  value: T
  options: SegmentOption<T>[]
  onChange: (v: T) => void
  size?: 'sm' | 'md'
  block?: boolean
  ariaLabel?: string
}

/** Segmented control with a sliding indicator. */
export function Segmented<T extends string>({ value, options, onChange, size = 'md', block, ariaLabel }: Props<T>) {
  const root = useRef<HTMLDivElement>(null)
  const [ind, setInd] = useState<{ left: number; width: number } | null>(null)

  useLayoutEffect(() => {
    const measure = () => {
      const el = root.current?.querySelector<HTMLElement>('[aria-checked="true"]')
      if (el) setInd({ left: el.offsetLeft, width: el.offsetWidth })
      else setInd(null)
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (root.current) ro.observe(root.current)
    return () => ro.disconnect()
  }, [value, options.length])

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const enabled = options.filter((o) => !o.disabled)
    const i = enabled.findIndex((o) => o.value === value)
    const next = enabled[(i + (e.key === 'ArrowRight' ? 1 : -1) + enabled.length) % enabled.length]
    onChange(next.value)
    requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus())
  }

  return (
    <div ref={root} role="radiogroup" aria-label={ariaLabel} className={`segmented segmented-${size}${block ? ' segmented-block' : ''}`} onKeyDown={onKey}>
      {ind && <span className="segmented-indicator" style={{ transform: `translateX(${ind.left}px)`, width: ind.width }} />}
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          title={o.title}
          disabled={o.disabled}
          className="segmented-item"
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
