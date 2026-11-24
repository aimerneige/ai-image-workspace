import { forwardRef, useCallback, useState, type ButtonHTMLAttributes, type PointerEvent, type ReactNode } from 'react'
import { Spinner } from './Spinner'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle' | 'gradient'

interface Ripple {
  id: number
  x: number
  y: number
  size: number
}

let rippleId = 0

/** Adds a material-like ripple at the pointer position. */
export function useRipple() {
  const [ripples, setRipples] = useState<Ripple[]>([])
  const onPointerDown = useCallback((e: PointerEvent<HTMLElement>) => {
    const el = e.currentTarget
    const r = el.getBoundingClientRect()
    const size = Math.hypot(r.width, r.height) * 2
    const ripple = { id: ++rippleId, x: e.clientX - r.left, y: e.clientY - r.top, size }
    setRipples((rs) => [...rs.slice(-3), ripple])
  }, [])
  const node = (
    <span className="ripple-host" aria-hidden>
      {ripples.map((r) => (
        <span
          key={r.id}
          className="ripple"
          style={{ left: r.x - r.size / 2, top: r.y - r.size / 2, width: r.size, height: r.size }}
          onAnimationEnd={() => setRipples((rs) => rs.filter((x) => x.id !== r.id))}
        />
      ))}
    </span>
  )
  return { onPointerDown, node }
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  icon?: ReactNode
  iconRight?: ReactNode
  block?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, iconRight, block, className = '', children, disabled, onPointerDown, type = 'button', ...rest },
  ref,
) {
  const ripple = useRipple()
  return (
    <button
      ref={ref}
      type={type}
      className={`btn btn-${variant} btn-${size}${block ? ' btn-block' : ''}${loading ? ' is-loading' : ''} ${className}`}
      disabled={disabled || loading}
      onPointerDown={(e) => {
        if (!disabled && !loading) ripple.onPointerDown(e)
        onPointerDown?.(e)
      }}
      {...rest}
    >
      {ripple.node}
      <span className="btn-content">
        {loading ? <Spinner size={size === 'sm' ? 14 : 16} /> : icon}
        {children != null && <span className="btn-label">{children}</span>}
        {iconRight}
      </span>
    </button>
  )
})
