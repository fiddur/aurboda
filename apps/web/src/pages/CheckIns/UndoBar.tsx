import { useState } from 'preact/hooks'

import './UndoBar.css'

interface Props {
  message: string
  onUndo: () => Promise<unknown>
  onClose: () => void
}

/** "Deleted. Undo" after a soft delete; the thing stays restorable from Recently deleted after it closes. */
export function UndoBar({ message, onUndo, onClose }: Props) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const undo = async () => {
    setPending(true)
    setError(null)
    try {
      await onUndo()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t undo. Please try again.')
    } finally {
      setPending(false)
    }
  }
  return (
    <div class="checkin-undo" role="status">
      <span>{error ?? message}</span>
      <button type="button" class="btn-secondary" onClick={undo} disabled={pending}>
        {pending ? 'Undoing…' : 'Undo'}
      </button>
      <button type="button" class="checkin-undo-close" aria-label="Dismiss" onClick={onClose}>
        ×
      </button>
    </div>
  )
}
