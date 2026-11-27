import type { JournalContext } from '@aurboda/api-spec'

import { useQuery } from '@tanstack/react-query'

import { fetchJournalContext } from '../../state/api'
import { browserTimezone } from '../../utils/browserTimezone'
import { contextToken } from './context-line'

const ContextTokens = ({ context }: { context: JournalContext }) =>
  context.items.length === 0 ? null : (
    <p class="journal-context-line">
      {context.items.map((item, index) => (
        <span key={item.id}>
          {index > 0 && ', '}
          <span title={item.name}>{contextToken(item)}</span>
        </span>
      ))}
    </p>
  )

const FetchedContextLine = ({ date }: { date: string }) => {
  const { data } = useQuery({
    queryFn: () => fetchJournalContext(date, browserTimezone() ?? undefined),
    queryKey: ['journal-context', date],
    staleTime: 60_000,
  })
  return data ? <ContextTokens context={data} /> : null
}

/** The entry's context line: the one the entry came with, else fetched for `date` (a new entry's day). */
export const EntryContextLine = ({ context, date }: { context?: JournalContext; date: string }) =>
  context && context.date === date ? <ContextTokens context={context} /> : <FetchedContextLine date={date} />
