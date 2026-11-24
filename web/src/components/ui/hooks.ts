import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'

/** Keeps an element mounted while its exit animation plays. */
export function usePresence(open: boolean, exitMs = 160) {
  const [mounted, setMounted] = useState(open)
  const [visible, setVisible] = useState(open)
  useEffect(() => {
    if (open) {
      setMounted(true)
      const id = requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)))
      return () => cancelAnimationFrame(id)
    }
    setVisible(false)
    const t = setTimeout(() => setMounted(false), exitMs)
    return () => clearTimeout(t)
  }, [open, exitMs])
  return { mounted, visible }
}

export type Placement = 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end' | 'top' | 'bottom'

interface Pos {
  top: number
  left: number
  origin: string
  minWidth: number
  maxHeight: number
}

/** Positions a fixed floating element next to an anchor, flipping if needed. */
export function useFloating(
  anchor: RefObject<HTMLElement | null>,
  floating: RefObject<HTMLElement | null>,
  open: boolean,
  placement: Placement = 'bottom-start',
  offset = 6,
  matchWidth = false,
) {
  const [pos, setPos] = useState<Pos | null>(null)
  const update = useCallback(() => {
    const a = anchor.current
    const f = floating.current
    if (!a || !f) return
    const r = a.getBoundingClientRect()
    const fw = f.offsetWidth
    const fh = f.scrollHeight
    const vw = window.innerWidth
    const vh = window.innerHeight
    const below = vh - r.bottom - offset - 8
    const above = r.top - offset - 8
    let vertical: 'top' | 'bottom' = placement.startsWith('top') ? 'top' : 'bottom'
    if (vertical === 'bottom' && fh > below && above > below) vertical = 'top'
    if (vertical === 'top' && fh > above && below > above) vertical = 'bottom'
    const maxHeight = Math.max(120, vertical === 'bottom' ? below : above)
    const height = Math.min(fh, maxHeight)
    const top = vertical === 'bottom' ? r.bottom + offset : r.top - offset - height
    const width = Math.max(fw, matchWidth ? r.width : 0)
    let left: number
    if (placement.endsWith('end')) left = r.right - width
    else if (placement === 'top' || placement === 'bottom') left = r.left + r.width / 2 - width / 2
    else left = r.left
    left = Math.min(Math.max(8, left), vw - width - 8)
    const originX = placement.endsWith('end') ? 'right' : placement === 'top' || placement === 'bottom' ? 'center' : 'left'
    setPos({ top, left, origin: `${originX} ${vertical === 'bottom' ? 'top' : 'bottom'}`, minWidth: matchWidth ? r.width : 0, maxHeight })
  }, [anchor, floating, placement, offset, matchWidth])

  useLayoutEffect(() => {
    if (!open) return
    update()
    const id = requestAnimationFrame(update)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      cancelAnimationFrame(id)
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open, update])
  return { pos, update }
}

/** Calls handler on pointerdown outside every given element. */
export function useOutside(refs: RefObject<HTMLElement | null>[], handler: () => void, active: boolean) {
  const h = useRef(handler)
  h.current = handler
  useEffect(() => {
    if (!active) return
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (refs.some((r) => r.current?.contains(target))) return
      h.current()
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [active, refs])
}

let idCounter = 0
export function useId(prefix = 'aiw') {
  const [id] = useState(() => `${prefix}-${++idCounter}`)
  return id
}

/** Locks body scroll while active (supports nesting). */
let lockCount = 0
export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return
    lockCount++
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      lockCount--
      if (lockCount === 0) document.body.style.overflow = prev
    }
  }, [active])
}
