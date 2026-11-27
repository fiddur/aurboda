import type { JournalContext } from '@aurboda/api-spec'

import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'preact/hooks'

import { JournalContextSettings } from '../../components/JournalContextSettings'
import { fetchJournalContext, fetchUserSettings } from '../../state/api'
import { auth } from '../../state/auth'
import { browserTimezone } from '../../utils/browserTimezone'
import { ContextTokens } from './ContextTokens'
import '../../components/DashboardEditor/style.css'

const ContextDialog = ({ date, onClose }: { date: string; onClose: () => void }) => {
  const { data: settings } = useQuery({
    enabled: Boolean(auth.value.token),
    queryFn: fetchUserSettings,
    queryKey: ['userSettings'],
    staleTime: 5 * 60_000,
  })
  const closeRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      opener?.focus()
    }
  }, [])

  return (
    <div class="dashboard-editor-overlay" onClick={onClose}>
      <div
        class="dashboard-editor-modal journal-context-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="journal-context-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div class="modal-header">
          <h3 id="journal-context-dialog-title">Context line</h3>
          <button ref={closeRef} type="button" class="close-btn" onClick={onClose} aria-label="Close">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div class="modal-content">
          {settings && <JournalContextSettings settings={settings} date={date} />}
        </div>
      </div>
    </div>
  )
}

/**
 * The entry's context line, with the button that configures it: the line the entry came with until it is
 * refetched, else the one fetched for `date` (a new entry's day).
 */
export const EntryContextLine = ({ context, date }: { context?: JournalContext; date: string }) => {
  const [open, setOpen] = useState(false)
  const { data: settings } = useQuery({
    enabled: Boolean(auth.value.token),
    queryFn: fetchUserSettings,
    queryKey: ['userSettings'],
    staleTime: 5 * 60_000,
  })
  const { data } = useQuery({
    initialData: context && context.date === date ? context : undefined,
    queryFn: () => fetchJournalContext(date, browserTimezone() ?? undefined),
    queryKey: ['journal-context', date],
    staleTime: 60_000,
  })
  const configured = (settings?.journal_context?.length ?? 0) > 0

  return (
    <div class="journal-context-line">
      {configured && data && <ContextTokens context={data} />}
      {settings && !configured && <span class="journal-context-hint">Add a context line</span>}{' '}
      <button
        type="button"
        class="journal-context-configure"
        aria-label="Configure context line"
        title="Configure context line"
        onClick={() => setOpen(true)}
      >
        ⚙️
      </button>
      {open && <ContextDialog date={date} onClose={() => setOpen(false)} />}
    </div>
  )
}
