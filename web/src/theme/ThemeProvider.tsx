import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'

export type ThemeMode = 'light' | 'dark' | 'system'
type Resolved = 'light' | 'dark'

interface ThemeValue {
  mode: ThemeMode
  resolved: Resolved
  /** origin is the click position used for the circular reveal transition. */
  setMode: (mode: ThemeMode, origin?: { x: number; y: number }) => void
}

const ThemeContext = createContext<ThemeValue | null>(null)
const KEY = 'aiw.theme'
const media = window.matchMedia('(prefers-color-scheme: dark)')

function resolve(mode: ThemeMode): Resolved {
  return mode === 'system' ? (media.matches ? 'dark' : 'light') : mode
}

function apply(r: Resolved) {
  document.documentElement.dataset.theme = r
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => (localStorage.getItem(KEY) as ThemeMode) || 'system')
  const [resolved, setResolved] = useState<Resolved>(() => resolve(mode))

  useEffect(() => {
    const onChange = () => {
      if (mode === 'system') {
        setResolved(resolve('system'))
        apply(resolve('system'))
      }
    }
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [mode])

  const setMode = useCallback((next: ThemeMode, origin?: { x: number; y: number }) => {
    localStorage.setItem(KEY, next)
    const target = resolve(next)
    const commit = () => {
      flushSync(() => {
        setModeState(next)
        setResolved(target)
      })
      apply(target)
    }
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } }
    if (!doc.startViewTransition || reduce || target === document.documentElement.dataset.theme) {
      commit()
      return
    }
    const x = origin?.x ?? window.innerWidth / 2
    const y = origin?.y ?? 0
    const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))
    const vt = doc.startViewTransition(commit)
    vt.ready.then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 520, easing: 'cubic-bezier(.4,0,.2,1)', pseudoElement: '::view-transition-new(root)' },
      )
    })
  }, [])

  return <ThemeContext.Provider value={{ mode, resolved, setMode }}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme outside ThemeProvider')
  return ctx
}
