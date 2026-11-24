import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, Info, X, XCircle, AlertTriangle } from 'lucide-react'

type Kind = 'success' | 'error' | 'info' | 'warning'

interface ToastItem {
  id: number
  kind: Kind
  message: ReactNode
  leaving?: boolean
  action?: { label: string; onClick: () => void }
}

interface ToastApi {
  show: (kind: Kind, message: ReactNode, opts?: { duration?: number; action?: ToastItem['action'] }) => void
  success: (m: ReactNode) => void
  error: (m: ReactNode) => void
  info: (m: ReactNode) => void
}

const ToastContext = createContext<ToastApi | null>(null)

const icons = {
  success: <CheckCircle2 size={18} />,
  error: <XCircle size={18} />,
  info: <Info size={18} />,
  warning: <AlertTriangle size={18} />,
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const seq = useRef(0)

  const dismiss = useCallback((id: number) => {
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, leaving: true } : x)))
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 220)
  }, [])

  const show = useCallback<ToastApi['show']>(
    (kind, message, opts) => {
      const id = ++seq.current
      setItems((xs) => [...xs.slice(-4), { id, kind, message, action: opts?.action }])
      setTimeout(() => dismiss(id), opts?.duration ?? (kind === 'error' ? 6000 : 3200))
    },
    [dismiss],
  )

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (m) => show('success', m),
      error: (m) => show('error', m),
      info: (m) => show('info', m),
    }),
    [show],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div className="toast-stack" aria-live="polite">
          {items.map((it) => (
            <div key={it.id} className={`toast toast-${it.kind}${it.leaving ? ' is-leaving' : ''}`} role="status">
              <span className="toast-icon">{icons[it.kind]}</span>
              <span className="toast-msg">{it.message}</span>
              {it.action && (
                <button
                  type="button"
                  className="toast-action"
                  onClick={() => {
                    it.action!.onClick()
                    dismiss(it.id)
                  }}
                >
                  {it.action.label}
                </button>
              )}
              <button type="button" className="toast-close" aria-label="close" onClick={() => dismiss(it.id)}>
                <X size={14} />
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast outside ToastProvider')
  return ctx
}
