/**
 * Shared save status indicator — shows saving/saved/error state.
 * Two variants: 'compact' (spinner/checkmark/!) and 'text' (readable messages).
 */
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'

import './SaveStatusIndicator.css'

export type SaveStatus =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved'; time?: Date }
  | { status: 'error'; error?: string }

interface SaveStatusIndicatorProps {
  state: SaveStatus
  variant?: 'compact' | 'text'
}

const formatSavedTime = (time: Date): string => {
  const now = new Date()
  const diffSec = Math.floor((now.getTime() - time.getTime()) / 1000)
  if (diffSec < 5) return 'just now'
  if (diffSec < 60) return `${diffSec} seconds ago`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin} minute${diffMin > 1 ? 's' : ''} ago`
  return time.toLocaleTimeString()
}

export function SaveStatusIndicator({ state, variant = 'text' }: SaveStatusIndicatorProps) {
  if (state.status === 'idle') return null

  if (variant === 'compact') {
    return (
      <span class="save-status-indicator compact">
        {state.status === 'saving' && <span class="status-spinner" title="Saving..." />}
        {state.status === 'saved' && (
          <span class="status-checkmark" title="Saved">
            &#10003;
          </span>
        )}
        {state.status === 'error' && (
          <span
            class="status-error-icon"
            title={state.status === 'error' ? (state.error ?? 'Failed to save') : ''}
          >
            !
          </span>
        )}
      </span>
    )
  }

  return (
    <span class={`save-status-indicator text ${state.status}`}>
      {state.status === 'saving' && 'Saving...'}
      {state.status === 'saved' && `Saved ${state.time ? formatSavedTime(state.time) : ''}`}
      {state.status === 'error' && (state.error ?? 'Error saving')}
    </span>
  )
}

/**
 * Hook that manages SaveStatus state with optional auto-clear.
 * Replaces the copy-pasted useEffect timer pattern.
 */
export function useSaveStatus(autoClearMs?: number): [SaveStatus, (s: SaveStatus) => void] {
  const [status, setStatusRaw] = useState<SaveStatus>({ status: 'idle' })
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const setStatus = useCallback(
    (s: SaveStatus) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = undefined
      }
      setStatusRaw(s)
      if (s.status === 'saved' && autoClearMs) {
        timerRef.current = setTimeout(() => setStatusRaw({ status: 'idle' }), autoClearMs)
      }
    },
    [autoClearMs],
  )

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  return [status, setStatus]
}
