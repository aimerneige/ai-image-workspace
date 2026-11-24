import { useRef, type KeyboardEvent, type PointerEvent } from 'react'

interface Props {
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
  label?: string
  disabled?: boolean
  format?: (v: number) => string
}

/** Pointer + keyboard slider; no native range input. */
export function Slider({ value, min, max, step = 1, onChange, label, disabled, format }: Props) {
  const track = useRef<HTMLDivElement>(null)
  const pct = ((value - min) / (max - min)) * 100

  const fromPointer = (clientX: number) => {
    const r = track.current!.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
    const raw = min + ratio * (max - min)
    const v = Math.round(raw / step) * step
    onChange(Math.min(max, Math.max(min, Number(v.toFixed(4)))))
  }

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled) return
    e.currentTarget.setPointerCapture(e.pointerId)
    fromPointer(e.clientX)
  }

  const onKey = (e: KeyboardEvent) => {
    const map: Record<string, number> = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step, PageUp: step * 10, PageDown: -step * 10 }
    if (e.key in map) {
      e.preventDefault()
      onChange(Math.min(max, Math.max(min, value + map[e.key])))
    } else if (e.key === 'Home') onChange(min)
    else if (e.key === 'End') onChange(max)
  }

  return (
    <div className={`slider${disabled ? ' is-disabled' : ''}`}>
      <div
        ref={track}
        className="slider-track"
        onPointerDown={onDown}
        onPointerMove={(e) => e.buttons === 1 && !disabled && fromPointer(e.clientX)}
      >
        <div className="slider-fill" style={{ width: `${pct}%` }} />
        <div
          className="slider-thumb"
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-label={label}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
          aria-valuetext={format?.(value)}
          style={{ left: `${pct}%` }}
          onKeyDown={onKey}
        />
      </div>
      <span className="slider-value">{format ? format(value) : value}</span>
    </div>
  )
}
