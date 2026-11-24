import { cloneElement, useRef, useState, type ReactElement, type Ref } from 'react'
import { createPortal } from 'react-dom'
import { useFloating, useId, usePresence, type Placement } from './hooks'

interface Props {
  content: string
  placement?: Placement
  children: ReactElement<Record<string, unknown>>
}

/** Lightweight tooltip shown on hover and keyboard focus. */
export function Tooltip({ content, placement = 'top', children }: Props) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLElement | null>(null)
  const tip = useRef<HTMLDivElement | null>(null)
  const timer = useRef<number>(0)
  const id = useId('tip')
  const { mounted, visible } = usePresence(open, 120)
  const { pos } = useFloating(anchor, tip, mounted, placement, 8)

  const show = () => {
    clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setOpen(true), 350)
  }
  const hide = () => {
    clearTimeout(timer.current)
    setOpen(false)
  }
  const child = children
  const props = child.props as Record<string, ((...a: unknown[]) => void) | undefined>
  return (
    <>
      {cloneElement(child, {
        ref: (el: HTMLElement | null) => {
          anchor.current = el
          const orig = (child.props as { ref?: Ref<HTMLElement> }).ref
          if (typeof orig === 'function') orig(el)
          else if (orig && typeof orig === 'object') (orig as { current: HTMLElement | null }).current = el
        },
        'aria-describedby': open ? id : undefined,
        onPointerEnter: (e: unknown) => {
          props.onPointerEnter?.(e)
          if ((e as PointerEvent).pointerType === 'mouse') show()
        },
        onPointerLeave: (e: unknown) => {
          props.onPointerLeave?.(e)
          hide()
        },
        onPointerDown: (e: unknown) => {
          props.onPointerDown?.(e)
          hide()
        },
        onFocus: (e: unknown) => {
          props.onFocus?.(e)
          if ((e as FocusEvent & { target: HTMLElement }).target.matches?.(':focus-visible')) show()
        },
        onBlur: (e: unknown) => {
          props.onBlur?.(e)
          hide()
        },
      })}
      {mounted &&
        createPortal(
          <div
            ref={tip}
            id={id}
            role="tooltip"
            className={`tooltip${visible && pos ? ' is-visible' : ''}`}
            style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, transformOrigin: pos?.origin }}
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  )
}
