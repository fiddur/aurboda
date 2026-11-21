import type { JournalEntryRef } from '@aurboda/api-spec'

import { JOURNAL_ENTRY_REFS_LIMIT } from '@aurboda/api-spec'

import {
  journalRefHeading,
  journalRefHref,
  journalRefWhen,
  type RelatedFilter,
  relatedFilterHref,
} from './related'
import './style.css'

/** The journal entries related to a person or an activity, newest first, each opening the entry. */
export const JournalEntryRefs = ({
  title,
  entries,
  filter,
  empty,
}: {
  title: string
  entries: readonly JournalEntryRef[]
  filter: RelatedFilter
  empty?: string
}) => (
  <section class="journal-refs" aria-label={title}>
    <div class="journal-refs-head">
      <h2>{title}</h2>
      {entries.length >= JOURNAL_ENTRY_REFS_LIMIT && <a href={relatedFilterHref(filter)}>See all</a>}
    </div>
    {entries.length === 0 ? (
      empty && <p class="journal-muted">{empty}</p>
    ) : (
      <ul class="journal-refs-list">
        {entries.map((entry) => {
          const href = journalRefHref(entry)
          const heading = journalRefHeading(entry)
          const when = journalRefWhen(entry)
          return (
            <li key={entry.id}>
              {href ? <a href={href}>{heading}</a> : <strong>{heading}</strong>}
              {when && <span class="journal-muted"> · {when}</span>}
              {entry.excerpt && <p class="journal-refs-excerpt">{entry.excerpt}</p>}
            </li>
          )
        })}
      </ul>
    )}
  </section>
)
