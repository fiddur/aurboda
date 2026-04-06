import { useState } from 'preact/hooks'

import './ConfirmButton.css'

interface ConfirmButtonProps {
  label: string
  confirmMessage?: string
  confirmLabel?: string
  onConfirm: () => void
  isPending?: boolean
  pendingLabel?: string
  buttonClass?: string
  disabled?: boolean
}

export function ConfirmButton({
  label,
  confirmMessage = 'Are you sure?',
  confirmLabel,
  onConfirm,
  isPending = false,
  pendingLabel,
  buttonClass = 'btn-danger',
  disabled = false,
}: ConfirmButtonProps) {
  const [confirming, setConfirming] = useState(false)

  if (!confirming) {
    return (
      <button type="button" class={buttonClass} disabled={disabled} onClick={() => setConfirming(true)}>
        {label}
      </button>
    )
  }

  const resolvedConfirmLabel = confirmLabel ?? label
  const resolvedPendingLabel = pendingLabel ?? `${label}...`

  return (
    <div class="confirm-inline">
      <span>{confirmMessage}</span>
      <button type="button" class="btn-danger" onClick={onConfirm} disabled={isPending}>
        {isPending ? resolvedPendingLabel : resolvedConfirmLabel}
      </button>
      <button type="button" class="btn-secondary" onClick={() => setConfirming(false)}>
        Cancel
      </button>
    </div>
  )
}
