import type { NoteLinkSuggestion } from '@aurboda/api-spec'

import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'preact/hooks'

import { dismissNoteLinkSuggestion, fetchNoteLinkSuggestions } from '../../state/api'
import { shownSuggestions, suggestionHint, suggestionLink } from './link-suggestions'
import { ChipIcon, useTypeIcon } from './Related'
import { linkKey, type RelatedLink } from './related'

/**
 * One-tap chips under the Related row: people named in the text, the night's sleep and the day's
 * activities. A tap adds the link as the picker does; × dismisses it for this entry. Nothing is
 * linked without a tap.
 */
export const LinkSuggestions = ({
  noteId,
  savedAt,
  links,
  onAdd,
}: {
  /** None until the entry is first saved: there is nothing to suggest for. */
  noteId: string | undefined
  /** The entry's last saved `updated_at`: the chips are read again after each save. */
  savedAt: string | undefined
  links: readonly RelatedLink[]
  onAdd: (link: RelatedLink) => void
}) => {
  const typeIcon = useTypeIcon()
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set())
  // A save's answer can land before a dismissal's: that chip stays hidden until the server knows.
  const pendingDismissals = useRef(new Set<string>())
  useEffect(() => setDismissed(new Set(pendingDismissals.current)), [savedAt])
  const suggestions = useQuery({
    enabled: noteId !== undefined,
    queryFn: () => fetchNoteLinkSuggestions(noteId!),
    queryKey: ['journal-link-suggestions', noteId, savedAt],
    staleTime: 60_000,
  })
  const shown = shownSuggestions(suggestions.data ?? [], links, dismissed)
  if (noteId === undefined || shown.length === 0) return null

  const dismiss = (suggestion: NoteLinkSuggestion) => {
    const key = linkKey(suggestion)
    setDismissed((current) => new Set([...current, key]))
    pendingDismissals.current.add(key)
    dismissNoteLinkSuggestion(noteId, {
      entity_id: suggestion.entity_id,
      entity_type: suggestion.entity_type,
    })
      .catch(() =>
        setDismissed((current) => {
          const next = new Set(current)
          next.delete(key)
          return next
        }),
      )
      .finally(() => pendingDismissals.current.delete(key))
  }

  return (
    <div class="journal-field journal-suggestions">
      <span>Suggested</span>
      <ul class="journal-related-chips" aria-label="Suggested links">
        {shown.map((suggestion) => (
          <li
            key={linkKey(suggestion)}
            class={`journal-related-chip journal-suggestion-chip is-${suggestion.entity_type}`}
          >
            <button
              type="button"
              class="journal-suggestion-add"
              title={`Relate this entry to ${suggestion.label}`}
              onClick={() => onAdd(suggestionLink(suggestion))}
            >
              <ChipIcon link={suggestion} typeIcon={typeIcon(suggestion.activity_type)} />
              <span class="journal-suggestion-label">{suggestion.label}</span>
              <small class="journal-muted">{suggestionHint(suggestion)}</small>
            </button>
            <button
              type="button"
              aria-label={`Don't suggest ${suggestion.label}`}
              title="Don't suggest this again"
              onClick={() => dismiss(suggestion)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
