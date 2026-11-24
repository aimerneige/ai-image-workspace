import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, X } from 'lucide-react'
import { usePresence, useScrollLock, useId } from './hooks'
import { Button } from './Button'
import { IconButton } from './IconButton'
import { useI18n } from '../../i18n'

interface DialogProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  /** Side sheet instead of a centered modal. */
  sheet?: boolean
  className?: string
}

/** Accessible modal with enter/exit animations and focus trapping. */
export function Dialog({ open, onClose, title, description, children, footer, size = 'md', sheet, className = '' }: DialogProps) {
  const { mounted, visible } = usePresence(open, 220)
  const panel = useRef<HTMLDivElement>(null)
  const restore = useRef<HTMLElement | null>(null)
  const titleId = useId('dlg')
  const { t } = useI18n()
  useScrollLock(mounted)

  useEffect(() => {
    if (!open) return
    restore.current = document.activeElement as HTMLElement
    const id = requestAnimationFrame(() => {
      const el = panel.current?.querySelector<HTMLElement>('[data-autofocus], input, textarea, button:not([data-close])')
      ;(el ?? panel.current)?.focus()
    })
    return () => {
      cancelAnimationFrame(id)
      restore.current?.focus?.()
    }
  }, [open])

  if (!mounted) return null
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
    }
    if (e.key === 'Tab' && panel.current) {
      const els = Array.from(
        panel.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])'),
      )
      if (!els.length) return
      const first = els[0]
      const last = els[els.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
  }
  return createPortal(
    <div className={`dialog-root${visible ? ' is-visible' : ''}${sheet ? ' is-sheet' : ''}`} onKeyDown={onKey}>
      <div className="dialog-backdrop" onClick={onClose} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={`dialog dialog-${size} ${className}`}
      >
        {title && (
          <div className="dialog-head">
            <div>
              <h2 id={titleId} className="dialog-title">{title}</h2>
              {description && <p className="dialog-desc">{description}</p>}
            </div>
            <IconButton label={t('common.close')} onClick={onClose} data-close tooltip={false}>
              <X size={18} />
            </IconButton>
          </div>
        )}
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

interface ConfirmOptions {
  title: ReactNode
  body?: ReactNode
  confirmText?: string
  danger?: boolean
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>
const ConfirmContext = createContext<ConfirmFn | null>(null)

/** Provides a promise-based confirm() replacement. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n()
  const [state, setState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null)
  const [open, setOpen] = useState(false)
  const confirm = useCallback<ConfirmFn>(
    (opts) =>
      new Promise((resolve) => {
        setState({ ...opts, resolve })
        setOpen(true)
      }),
    [],
  )
  const close = (v: boolean) => {
    state?.resolve(v)
    setOpen(false)
  }
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog open={open} onClose={() => close(false)} size="sm" className="confirm-dialog">
        {state && (
          <div className="confirm">
            <div className={`confirm-icon${state.danger ? ' is-danger' : ''}`}>
              <AlertTriangle size={22} />
            </div>
            <div>
              <h2 className="dialog-title">{state.title}</h2>
              {state.body && <p className="dialog-desc">{state.body}</p>}
            </div>
          </div>
        )}
        <div className="confirm-actions">
          <Button variant="ghost" onClick={() => close(false)}>{t('common.cancel')}</Button>
          <Button variant={state?.danger ? 'danger' : 'primary'} onClick={() => close(true)} data-autofocus>
            {state?.confirmText ?? t('common.confirm')}
          </Button>
        </div>
      </Dialog>
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm outside ConfirmProvider')
  return ctx
}
