import { forwardRef, useState, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useI18n } from '../../i18n'

interface FieldProps {
  label?: ReactNode
  hint?: ReactNode
  error?: ReactNode
  htmlFor?: string
  children: ReactNode
  aside?: ReactNode
  className?: string
}

export function Field({ label, hint, error, htmlFor, children, aside, className = '' }: FieldProps) {
  return (
    <div className={`field${error ? ' has-error' : ''} ${className}`}>
      {(label || aside) && (
        <div className="field-head">
          {label && <label htmlFor={htmlFor} className="field-label">{label}</label>}
          {aside && <span className="field-aside">{aside}</span>}
        </div>
      )}
      {children}
      {error ? <div className="field-error" role="alert">{error}</div> : hint ? <div className="field-hint">{hint}</div> : null}
    </div>
  )
}

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  icon?: ReactNode
  suffix?: ReactNode
  invalid?: boolean
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ icon, suffix, invalid, className = '', ...rest }, ref) {
  return (
    <div className={`input-wrap${invalid ? ' is-invalid' : ''}${rest.disabled ? ' is-disabled' : ''} ${className}`}>
      {icon && <span className="input-icon">{icon}</span>}
      <input ref={ref} className="input" {...rest} />
      {suffix && <span className="input-suffix">{suffix}</span>}
    </div>
  )
})

export const PasswordInput = forwardRef<HTMLInputElement, InputProps>(function PasswordInput(props, ref) {
  const [show, setShow] = useState(false)
  const { t } = useI18n()
  return (
    <Input
      ref={ref}
      {...props}
      type={show ? 'text' : 'password'}
      suffix={
        <button
          type="button"
          className="input-reveal"
          aria-label={show ? t('auth.hidePassword') : t('auth.showPassword')}
          onClick={() => setShow((s) => !s)}
          tabIndex={-1}
        >
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      }
    />
  )
})

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextArea(
  { className = '', ...rest },
  ref,
) {
  return <textarea ref={ref} className={`textarea ${className}`} {...rest} />
})
