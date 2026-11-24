import { Minus, Plus } from 'lucide-react'
import { useRipple } from './Button'

interface Props {
  value: number
  min: number
  max: number
  onChange: (v: number) => void
  label?: string
}

function StepButton({ onClick, disabled, children, label }: { onClick: () => void; disabled: boolean; children: React.ReactNode; label: string }) {
  const ripple = useRipple()
  return (
    <button type="button" className="stepper-btn" aria-label={label} disabled={disabled} onClick={onClick} onPointerDown={ripple.onPointerDown}>
      {ripple.node}
      {children}
    </button>
  )
}

export function Stepper({ value, min, max, onChange, label }: Props) {
  return (
    <div className="stepper" role="group" aria-label={label}>
      <StepButton label="-" disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}>
        <Minus size={14} />
      </StepButton>
      <span className="stepper-value" aria-live="polite">{value}</span>
      <StepButton label="+" disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}>
        <Plus size={14} />
      </StepButton>
    </div>
  )
}
