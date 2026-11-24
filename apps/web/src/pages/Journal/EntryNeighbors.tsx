import type { NoteNeighbor } from '@aurboda/api-spec'

import { useQuery } from '@tanstack/react-query'
import { useLocation } from 'preact-iso'
import { useEffect } from 'preact/hooks'

import { fetchJournalNeighbors } from '../../state/api'
import { browserTimezone } from '../../utils/browserTimezone'
import { isTyping } from '../../utils/isTyping'
import { JOURNAL_KEY } from './JournalList'
import { journalEntryHref, neighborDate, neighborLabel, neighborText } from './neighbors'
import '../../components/sessions/sessions.css'

const NeighborText = ({ n }: { n: NoteNeighbor }) => {
  const text = neighborText(n)
  return (
    <>
      {neighborDate(n)}
      {text && <span class="activity-neighbors-title"> · {text}</span>}
    </>
  )
}

/** Under JOURNAL_KEY, so a save, which may move the entry, refreshes them. */
const NeighborsRow = ({
  id,
  anchorKey,
  timeline,
}: {
  id: string
  anchorKey: string
  timeline?: { href: string; title: string }
}) => {
  const { route } = useLocation()
  const { data } = useQuery({
    queryFn: () => fetchJournalNeighbors(id, browserTimezone() ?? undefined),
    queryKey: [...JOURNAL_KEY, 'neighbors', id, anchorKey],
    staleTime: 30_000,
  })
  const previous = data?.previous
  const next = data?.next

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || isTyping(e.target)) return
      const target = e.key === 'ArrowLeft' ? previous : e.key === 'ArrowRight' ? next : undefined
      if (!target) return
      e.preventDefault()
      route(journalEntryHref(target.id))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [previous, next, route])

  if (!previous && !next && !timeline) return null

  return (
    <nav class="activity-neighbors-nav" aria-label="Older and newer entries">
      <div class="activity-neighbors-row">
        {previous ? (
          <a href={journalEntryHref(previous.id)} title={`Older: ${neighborLabel(previous)}`}>
            ← <NeighborText n={previous} />
          </a>
        ) : (
          <span class="session-muted">No earlier</span>
        )}
        {timeline && (
          <span class="activity-neighbors-scope">
            <a href={timeline.href} class="activity-neighbors-timeline" title={timeline.title}>
              Timeline
            </a>
          </span>
        )}
        {next ? (
          <a href={journalEntryHref(next.id)} title={`Newer: ${neighborLabel(next)}`}>
            <NeighborText n={next} /> →
          </a>
        ) : (
          <span class="session-muted">No later</span>
        )}
      </div>
    </nav>
  )
}

/**
 * The older (←) and newer (→) entry in the Journal's order, also on the arrow keys, with a link to
 * the Timeline around the entry between them; none until the entry is loaded or, when new, saved.
 */
export const EntryNeighbors = ({
  id,
  loaded,
  anchorKey,
  timeline,
}: {
  id?: string
  loaded: boolean
  anchorKey: string
  timeline?: { href: string; title: string }
}) => (loaded && id ? <NeighborsRow id={id} anchorKey={anchorKey} timeline={timeline} /> : null)
