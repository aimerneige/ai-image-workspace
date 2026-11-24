interface Props {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  label?: string
  size?: 'sm' | 'md'
}

export function Switch({ checked, onChange, disabled, label, size = 'md' }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`switch switch-${size}${checked ? ' is-on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-thumb" />
    </button>
  )
}
