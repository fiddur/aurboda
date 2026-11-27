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
  const downOnOverlay = useRef(false)

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()
    return () => opener?.focus()
  }, [])

  return (
    <div
      class="dashboard-editor-overlay"
      onPointerDown={(e) => {
        downOnOverlay.current = e.target === e.currentTarget
      }}
      onClick={(e) => {
        if (downOnOverlay.current && e.target === e.currentTarget) onClose()
      }}
    >
      <div
        class="dashboard-editor-modal journal-context-dialog"
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="journal-context-dialog-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !e.defaultPrevented) onClose()
        }}
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
  const unconfigured = settings !== undefined && (settings.journal_context?.length ?? 0) === 0

  return (
    <>
      <div class="journal-context-line">
        {data && data.items.length > 0 && <ContextTokens context={data} />}
        {unconfigured && <span class="journal-context-hint">Add a context line</span>}{' '}
        <button
          type="button"
          class="journal-context-configure"
          aria-label="Configure context line"
          title="Configure context line"
          onClick={() => setOpen(true)}
        >
          ⚙️
        </button>
      </div>
      {open && <ContextDialog date={date} onClose={() => setOpen(false)} />}
    </>
  )
}
