import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

interface Tab<T extends string> {
  value: T
  label: ReactNode
  icon?: ReactNode
}

/** Underlined tabs with an animated indicator. */
export function Tabs<T extends string>({ value, tabs, onChange }: { value: T; tabs: Tab<T>[]; onChange: (v: T) => void }) {
  const root = useRef<HTMLDivElement>(null)
  const [ind, setInd] = useState<{ left: number; width: number } | null>(null)
  useLayoutEffect(() => {
    const el = root.current?.querySelector<HTMLElement>('[aria-selected="true"]')
    if (el) setInd({ left: el.offsetLeft, width: el.offsetWidth })
  }, [value, tabs.length])
  return (
    <div ref={root} className="tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={t.value === value}
          className="tab"
          onClick={() => onChange(t.value)}
        >
          {t.icon}
          {t.label}
        </button>
      ))}
      {ind && <span className="tabs-indicator" style={{ transform: `translateX(${ind.left}px)`, width: ind.width }} />}
    </div>
  )
}
