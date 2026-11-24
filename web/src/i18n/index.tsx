import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { LocaleMeta, LocaleModule, MessageKey } from './types'

// Every file in ./locales registers itself; add `ko.ts` etc. to extend.
const modules = import.meta.glob<{ default: LocaleModule }>('./locales/*.ts', { eager: true })
const registry: LocaleModule[] = Object.values(modules)
  .map((m) => m.default)
  .sort((a, b) => order(a.meta.code) - order(b.meta.code))

function order(code: string) {
  const preferred = ['zh-CN', 'en', 'ja']
  const i = preferred.indexOf(code)
  return i < 0 ? 99 : i
}

const fallback = registry.find((l) => l.meta.code === 'en')!
const STORAGE_KEY = 'aiw.locale'

export const locales: LocaleMeta[] = registry.map((l) => l.meta)

function detect(): string {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved && registry.some((l) => l.meta.code === saved)) return saved
  for (const lang of navigator.languages ?? [navigator.language]) {
    const lower = lang.toLowerCase()
    const hit = registry.find((l) => l.meta.match.some((m) => lower === m.toLowerCase() || lower.startsWith(m.toLowerCase() + '-')))
    if (hit) return hit.meta.code
  }
  return 'en'
}

// Keys may themselves contain dots (e.g. actions["auth.login"]), so at each
// level the remaining path is first tried as a literal key.
function lookup(tree: unknown, key: string): string | undefined {
  if (tree == null || typeof tree !== 'object') return undefined
  const obj = tree as Record<string, unknown>
  if (typeof obj[key] === 'string') return obj[key] as string
  const dot = key.indexOf('.')
  if (dot < 0) return undefined
  return lookup(obj[key.slice(0, dot)], key.slice(dot + 1))
}

function format(str: string, vars?: Record<string, string | number>) {
  if (!vars) return str
  return str.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m))
}

export type TFunction = (key: MessageKey, vars?: Record<string, string | number>) => string

interface I18nValue {
  locale: string
  setLocale: (code: string) => void
  t: TFunction
  /** Looks up a dynamic key (e.g. an error code) with a fallback string. */
  tx: (key: string, fallbackText?: string, vars?: Record<string, string | number>) => string
  formatDate: (d: string | Date, opts?: Intl.DateTimeFormatOptions) => string
  formatRelative: (d: string | Date) => string
  formatNumber: (n: number, opts?: Intl.NumberFormatOptions) => string
}

const I18nContext = createContext<I18nValue | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState(detect)
  const current = registry.find((l) => l.meta.code === locale) ?? fallback

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const setLocale = useCallback((code: string) => {
    localStorage.setItem(STORAGE_KEY, code)
    setLocaleState(code)
  }, [])

  const value = useMemo<I18nValue>(() => {
    const tx = (key: string, fallbackText?: string, vars?: Record<string, string | number>) => {
      const str = lookup(current.messages, key) ?? lookup(fallback.messages, key) ?? fallbackText ?? key
      return format(str, vars)
    }
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
    return {
      locale,
      setLocale,
      t: (key, vars) => tx(key, undefined, vars),
      tx,
      formatDate: (d, opts) =>
        new Intl.DateTimeFormat(locale, opts ?? { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(d)),
      formatRelative: (d) => {
        const diff = (new Date(d).getTime() - Date.now()) / 1000
        const abs = Math.abs(diff)
        if (abs < 45) return rtf.format(Math.round(diff), 'second')
        if (abs < 2700) return rtf.format(Math.round(diff / 60), 'minute')
        if (abs < 64800) return rtf.format(Math.round(diff / 3600), 'hour')
        if (abs < 6 * 86400) return rtf.format(Math.round(diff / 86400), 'day')
        return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(d))
      },
      formatNumber: (n, opts) => new Intl.NumberFormat(locale, opts).format(n),
    }
  }, [locale, current, setLocale])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n outside I18nProvider')
  return ctx
}
