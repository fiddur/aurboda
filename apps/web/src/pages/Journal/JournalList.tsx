import type { Note, NotesSearchResponse } from '@aurboda/api-spec'

import { DELETED_NOTE_RETENTION_DAYS } from '@aurboda/api-spec'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation } from 'preact-iso'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'

import {
  fetchDeletedEntries,
  fetchNoteTemplates,
  type JournalQuery,
  restoreJournalEntry,
  restoreNoteTemplate,
  searchJournal,
} from '../../state/api'
import { renderMarkdown } from '../../utils/markdown'
import { entityHref } from '../Timeline/commentItems'
import { AttachmentStrip } from './Attachments'
import {
  dayHeading,
  daysLeft,
  daysLeftLabel,
  entryGlimpse,
  entryTimeLabel,
  groupEntriesByDay,
  isLongText,
  localToday,
} from './journal-list'
import { DELETED_TEMPLATES_KEY, TEMPLATES_KEY, TemplateManager, useTemplates } from './Templates'

export const JOURNAL_KEY = ['journal'] as const

const browserTimezone = (): string | undefined => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return undefined
  }
}

const useDebounced = <T,>(value: T, ms: number): T => {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return debounced
}

const ANCHOR_LABELS: Partial<Record<Note['entity_type'], string>> = {
  activity: 'On an activity',
  meal: 'On a meal',
  productivity: 'On screen time',
  report: 'On a report',
}

const isJournalEntry = (note: Note) => note.entity_type === 'time' || note.entity_type === 'day'

const editorHref = (note: Note) => `/journal/${encodeURIComponent(note.id ?? '')}`

const EntryHead = ({ note }: { note: Note }) => {
  const time = note.entity_type === 'day' ? 'All day' : entryTimeLabel(note)
  const anchor = note.entity_id ? entityHref(note.entity_type, note.entity_id) : undefined
  return (
    <header class="journal-entry-head">
      {time && <span class="journal-entry-time">{time}</span>}
      {isJournalEntry(note) ? (
        <a class="journal-entry-open" href={editorHref(note)}>
          Open
        </a>
      ) : (
        anchor && (
          <a class="journal-entry-anchor" href={anchor}>
            {ANCHOR_LABELS[note.entity_type] ?? 'Comment'}
          </a>
        )
      )}
    </header>
  )
}

const EntryText = ({ content }: { content: string }) => {
  const [expanded, setExpanded] = useState(false)
  const long = isLongText(content)
  if (!content.trim()) return null
  return (
    <>
      <div
        class={`journal-entry-text${long && !expanded ? ' clamped' : ''}`}
        dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
      />
      {long && (
        <button type="button" class="journal-link-btn" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </>
  )
}

const EntryFoot = ({
  tags,
  replies,
  onTag,
}: {
  tags: string[]
  replies: number
  onTag: (tag: string) => void
}) =>
  tags.length > 0 || replies > 0 ? (
    <footer class="journal-entry-foot">
      {tags.map((tag) => (
        <button
          key={tag}
          type="button"
          class="journal-chip"
          onClick={() => onTag(tag)}
          title={`Show #${tag}`}
        >
          #{tag}
        </button>
      ))}
      {replies > 0 && (
        <span class="journal-muted journal-replies">{replies === 1 ? '1 reply' : `${replies} replies`}</span>
      )}
    </footer>
  ) : null

const EntryCard = ({ note, onTag }: { note: Note; onTag: (tag: string) => void }) => (
  <article class="journal-entry">
    <EntryHead note={note} />
    {note.title && (
      <h3 class="journal-entry-title">
        {isJournalEntry(note) ? <a href={editorHref(note)}>{note.title}</a> : note.title}
      </h3>
    )}
    <EntryText content={note.content} />
    {note.id && (note.attachments ?? []).length > 0 && (
      <AttachmentStrip noteId={note.id} attachments={note.attachments ?? []} />
    )}
    <EntryFoot tags={note.tags ?? []} replies={note.replies?.length ?? 0} onTag={onTag} />
  </article>
)

const OnThisDay = ({ today }: { today: string }) => {
  const query = useQuery({
    queryFn: () => searchJournal({ limit: 20, on_this_day: today, tz: browserTimezone() }),
    queryKey: [...JOURNAL_KEY, 'on-this-day', today],
  })
  const entries = query.data?.data ?? []
  if (entries.length === 0) return null
  return (
    <section class="journal-card journal-on-this-day" aria-label="On this day">
      <h2>On this day</h2>
      <ul>
        {entries.map((note) => {
          const year = (note.date ?? note.start_time ?? '').slice(0, 4)
          const label = entryGlimpse(note) || 'Pictures and recordings'
          return (
            <li key={note.id}>
              <span class="journal-year">{year}</span>
              {isJournalEntry(note) ? <a href={editorHref(note)}>{label}</a> : <span>{label}</span>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

const RecentlyDeleted = () => {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const deleted = useQuery({
    enabled: open,
    queryFn: fetchDeletedEntries,
    queryKey: [...JOURNAL_KEY, 'deleted'],
  })
  const restore = useMutation({
    mutationFn: (id: string) => restoreJournalEntry(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: JOURNAL_KEY }),
  })
  const deletedTemplates = useQuery({
    enabled: open,
    queryFn: () => fetchNoteTemplates({ deleted: true }),
    queryKey: DELETED_TEMPLATES_KEY,
  })
  const restoreTemplate = useMutation({
    mutationFn: (id: string) => restoreNoteTemplate(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TEMPLATES_KEY }),
  })
  const entries = (deleted.data ?? []).filter(isJournalEntry)
  const templates = deletedTemplates.data ?? []

  return (
    <details class="journal-card journal-deleted" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Recently deleted</summary>
      <p class="journal-muted">
        Deleted entries stay here for {DELETED_NOTE_RETENTION_DAYS} days, then they are gone for good.
      </p>
      {deleted.isLoading && <p class="journal-muted">Loading…</p>}
      {open && !deleted.isLoading && entries.length === 0 && templates.length === 0 && (
        <p class="journal-muted">Nothing deleted.</p>
      )}
      {entries.length > 0 && (
        <ul class="journal-deleted-list">
          {entries.map((note) => (
            <li key={note.id}>
              <span class="journal-deleted-text">
                <span>{entryGlimpse(note) || 'Pictures and recordings'}</span>
                <small class="journal-muted">
                  {note.date ?? (note.start_time ? note.start_time.slice(0, 10) : '')} ·{' '}
                  {daysLeftLabel(daysLeft(note.purge_at))}
                </small>
              </span>
              <button
                type="button"
                class="btn-secondary"
                disabled={restore.isPending}
                onClick={() => note.id && restore.mutate(note.id)}
              >
                Restore
              </button>
            </li>
          ))}
        </ul>
      )}
      {templates.length > 0 && (
        <ul class="journal-deleted-list">
          {templates.map((template) => (
            <li key={template.id}>
              <span class="journal-deleted-text">
                <span>Template: {template.name}</span>
                <small class="journal-muted">{daysLeftLabel(daysLeft(template.purge_at))}</small>
              </span>
              <button
                type="button"
                class="btn-secondary"
                disabled={restoreTemplate.isPending}
                onClick={() => restoreTemplate.mutate(template.id)}
              >
                Restore
              </button>
            </li>
          ))}
        </ul>
      )}
    </details>
  )
}

const JournalHeader = () => {
  const { route } = useLocation()
  const templates = useTemplates()
  const [picking, setPicking] = useState(false)
  const list = templates.data ?? []
  return (
    <>
      <div class="journal-header">
        <h1>Journal</h1>
        <div class="journal-row">
          <a class="btn-primary journal-new" href="/journal/new">
            New entry
          </a>
          {list.length > 0 && (
            <button type="button" class="btn-secondary" onClick={() => setPicking(!picking)}>
              New entry from template
            </button>
          )}
        </div>
      </div>
      {picking && list.length > 0 && (
        <ul class="journal-card journal-template-pick" aria-label="Templates">
          {list.map((template) => (
            <li key={template.id}>
              <button
                type="button"
                class="journal-link-btn"
                onClick={() => route(`/journal/new?template=${encodeURIComponent(template.id)}`)}
              >
                {template.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

interface Filters {
  search: string
  tags: string[]
  jumpTo: string
  withComments: boolean
  needsText: boolean
}

const JournalFilters = ({
  filters,
  today,
  onChange,
}: {
  filters: Filters
  today: string
  onChange: (patch: Partial<Filters>) => void
}) => (
  <>
    <div class="journal-controls">
      <input
        type="search"
        class="journal-search"
        placeholder="Search your journal"
        aria-label="Search your journal"
        value={filters.search}
        onInput={(e) => onChange({ search: e.currentTarget.value })}
      />
      <label class="journal-date-jump">
        <span>Go to date</span>
        <input
          type="date"
          value={filters.jumpTo}
          max={today}
          onInput={(e) => onChange({ jumpTo: e.currentTarget.value })}
        />
      </label>
      {filters.jumpTo && (
        <button type="button" class="journal-link-btn" onClick={() => onChange({ jumpTo: '' })}>
          Back to today
        </button>
      )}
    </div>
    <div class="journal-filters">
      <label class="journal-switch">
        <input
          type="checkbox"
          checked={filters.withComments}
          onChange={(e) => onChange({ withComments: e.currentTarget.checked })}
        />
        <span>Also show comments on activities, meals and reports</span>
      </label>
      <label class="journal-switch">
        <input
          type="checkbox"
          checked={filters.needsText}
          onChange={(e) => onChange({ needsText: e.currentTarget.checked })}
        />
        <span>Photos without text</span>
      </label>
    </div>
    {filters.tags.length > 0 && (
      <div class="journal-active-tags" aria-label="Showing entries tagged">
        {filters.tags.map((tag) => (
          <button
            key={tag}
            type="button"
            class="journal-chip active"
            onClick={() => onChange({ tags: filters.tags.filter((t) => t !== tag) })}
            aria-label={`Stop filtering by #${tag}`}
          >
            #{tag} ✕
          </button>
        ))}
      </div>
    )}
  </>
)

const EmptyJournal = ({ unfiltered }: { unfiltered: boolean }) => (
  <div class="journal-empty">
    {unfiltered ? (
      <>
        <p>
          Your journal is a calm place for what happened and how it felt: a few lines a day, a photo of a page
          from a paper diary, or a voice note.
        </p>
        <p>Comments you write on the Timeline show up here too.</p>
      </>
    ) : (
      <p>No entries match.</p>
    )}
  </div>
)

const JournalEntries = ({
  query,
  today,
  unfiltered,
  onTag,
}: {
  query: JournalQuery
  today: string
  unfiltered: boolean
  onTag: (tag: string) => void
}) => {
  const list = useInfiniteQuery({
    getNextPageParam: (last: NotesSearchResponse) => last.next_cursor ?? undefined,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      searchJournal({ ...query, cursor: pageParam }),
    queryKey: [...JOURNAL_KEY, 'list', query],
  })
  const notes = useMemo(() => list.data?.pages.flatMap((page) => page.data ?? []) ?? [], [list.data])
  const days = useMemo(() => groupEntriesByDay(notes), [notes])

  const sentinel = useRef<HTMLDivElement>(null)
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = list
  useEffect(() => {
    const node = sentinel.current
    if (!node || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((seen) => {
      if (seen.some((entry) => entry.isIntersecting) && hasNextPage && !isFetchingNextPage) {
        void fetchNextPage()
      }
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  return (
    <>
      {list.isLoading && <p class="journal-muted">Loading your journal…</p>}
      {list.isError && <p class="journal-error">The journal could not be loaded. Please try again.</p>}
      {!list.isLoading && !list.isError && notes.length === 0 && <EmptyJournal unfiltered={unfiltered} />}
      {days.map((day) => (
        <section class="journal-day" key={day.date} aria-label={dayHeading(day.date, today)}>
          <h2 class="journal-day-heading">{dayHeading(day.date, today)}</h2>
          {day.entries.map((note) => (
            <EntryCard key={note.id} note={note} onTag={onTag} />
          ))}
        </section>
      ))}
      <div ref={sentinel} class="journal-sentinel" />
      {hasNextPage && (
        <button
          type="button"
          class="btn-secondary journal-more"
          disabled={isFetchingNextPage}
          onClick={() => void fetchNextPage()}
        >
          {isFetchingNextPage ? 'Loading…' : 'Load more'}
        </button>
      )}
    </>
  )
}

/** The journal: every entry by day, newest first, with search, tags, a date to jump to and filters. */
export const JournalList = () => {
  const { query: urlQuery } = useLocation()
  const [filters, setFilters] = useState<Filters>({
    jumpTo: urlQuery.date ?? '',
    needsText: false,
    search: '',
    tags: [],
    withComments: false,
  })
  const [showTemplates, setShowTemplates] = useState(false)
  const q = useDebounced(filters.search, 350)
  const today = localToday()
  const change = (patch: Partial<Filters>) => setFilters((current) => ({ ...current, ...patch }))

  const query: JournalQuery = {
    include_comments: filters.withComments,
    needs_text: filters.needsText,
    q,
    tags: filters.tags,
    to: filters.jumpTo || undefined,
    tz: browserTimezone(),
  }
  const unfiltered =
    !q.trim() && filters.tags.length === 0 && !filters.jumpTo && !filters.withComments && !filters.needsText

  return (
    <div class="journal-page">
      <JournalHeader />
      <JournalFilters filters={filters} today={today} onChange={change} />
      {unfiltered && <OnThisDay today={today} />}
      <JournalEntries
        query={query}
        today={today}
        unfiltered={unfiltered}
        onTag={(tag) => change({ tags: filters.tags.includes(tag) ? filters.tags : [...filters.tags, tag] })}
      />
      <RecentlyDeleted />
      <details
        class="journal-card journal-templates-section"
        onToggle={(e) => setShowTemplates(e.currentTarget.open)}
      >
        <summary>Manage templates</summary>
        {showTemplates && <TemplateManager />}
      </details>
    </div>
  )
}
