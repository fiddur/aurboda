import { useState } from 'preact/hooks'

import { apiErrorMessage } from '../state/api'
import { confirmsUsername } from './delete-account'
import './DeleteAccountConfirm.css'

interface DeleteAccountConfirmProps {
  /** The account to delete; typing it enables the final button. */
  username: string
  /** Label of the button that opens the confirmation. */
  label: string
  /** Rejects with the server's error, which is shown in the confirmation. */
  onDelete: () => Promise<void>
  onDeleted: () => void
}

export function DeleteAccountConfirm({ username, label, onDelete, onDeleted }: DeleteAccountConfirmProps) {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const close = () => {
    setOpen(false)
    setTyped('')
    setError(null)
  }

  const onConfirm = async () => {
    setError(null)
    setBusy(true)
    try {
      await onDelete()
      onDeleted()
    } catch (err) {
      setError(apiErrorMessage(err, 'Deletion failed'))
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button type="button" class="delete-account-button" onClick={() => setOpen(true)}>
        {label}
      </button>
    )
  }

  const inputId = `delete-account-confirm-${username}`
  return (
    <div class="delete-account-confirm" role="group" aria-label={label}>
      <label for={inputId}>
        Type <strong>{username}</strong> to confirm. This cannot be undone.
      </label>
      <input
        id={inputId}
        type="text"
        autocomplete="off"
        autocapitalize="none"
        spellcheck={false}
        value={typed}
        disabled={busy}
        onInput={(e) => setTyped((e.target as HTMLInputElement).value)}
      />
      <div class="delete-account-actions">
        <button
          type="button"
          class="delete-account-button"
          disabled={busy || !confirmsUsername(typed, username)}
          onClick={onConfirm}
        >
          {busy ? 'Deleting…' : 'Delete permanently'}
        </button>
        <button type="button" class="delete-account-cancel" disabled={busy} onClick={close}>
          Cancel
        </button>
      </div>
      {error && <p class="delete-account-error">{error}</p>}
    </div>
  )
}
