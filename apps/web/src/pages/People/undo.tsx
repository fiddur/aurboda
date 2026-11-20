import { signal } from '@preact/signals'
import { useEffect, useState } from 'preact/hooks'

export const UNDO_MS = 10_000

interface PendingUndo {
  message: string
  undo: () => Promise<unknown>
}

/** The soft delete that can still be undone; it follows the page from the person to the list. */
export const pendingUndo = signal<PendingUndo | null>(null)

export const offerUndo = (message: string, undo: () => Promise<unknown>) => {
  pendingUndo.value = { message, undo }
}

export function UndoBar() {
  const current = pendingUndo.value
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!current) return
    setError(null)
    const timer = setTimeout(() => {
      if (pendingUndo.value === current) pendingUndo.value = null
    }, UNDO_MS)
    return () => clearTimeout(timer)
  }, [current])

  if (!current) return null
  const undo = async () => {
    setPending(true)
    setError(null)
    try {
      await current.undo()
      pendingUndo.value = null
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t undo. Please try again.')
    } finally {
      setPending(false)
    }
  }
  return (
    <div class="people-undo" role="status">
      <span>{error ?? current.message}</span>
      <button type="button" class="btn-secondary" onClick={undo} disabled={pending}>
        {pending ? 'Undoing…' : 'Undo'}
      </button>
      <button
        type="button"
        class="people-undo-close"
        aria-label="Dismiss"
        onClick={() => (pendingUndo.value = null)}
      >
        ×
      </button>
    </div>
  )
}
