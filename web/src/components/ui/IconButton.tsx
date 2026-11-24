import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { useRipple } from './Button'
import { Tooltip } from './Tooltip'
import type { Placement } from './hooks'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  children: ReactNode
  size?: 'sm' | 'md'
  variant?: 'ghost' | 'solid' | 'danger' | 'overlay'
  active?: boolean
  tooltip?: boolean
  placement?: Placement
}

export const IconButton = forwardRef<HTMLButtonElement, Props>(function IconButton(
  { label, children, size = 'md', variant = 'ghost', active, tooltip = true, placement = 'top', className = '', onPointerDown, ...rest },
  ref,
) {
  const ripple = useRipple()
  const btn = (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      className={`icon-btn icon-btn-${size} icon-btn-${variant}${active ? ' is-active' : ''} ${className}`}
      onPointerDown={(e) => {
        ripple.onPointerDown(e)
        onPointerDown?.(e)
      }}
      {...rest}
    >
      {ripple.node}
      {children}
    </button>
  )
  return tooltip ? (
    <Tooltip content={label} placement={placement}>
      {btn}
    </Tooltip>
  ) : (
    btn
  )
})
