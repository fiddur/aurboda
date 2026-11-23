import type { NoteLinkSuggestion, NoteLinkSuggestionReason } from '@aurboda/api-spec'

import { hasLink, linkKey, type RelatedLink } from './related'

const reasonHints: Record<NoteLinkSuggestionReason, string> = {
  name_in_text: 'named in the text',
  night_sleep: 'last night',
  same_day: 'that day',
}

/** Why a chip is offered, as a short hint under its label. */
export const suggestionHint = (suggestion: Pick<NoteLinkSuggestion, 'reason'>): string =>
  reasonHints[suggestion.reason]

/** The link a tapped chip adds: the suggestion without its reason. */
export const suggestionLink = ({ reason: _reason, ...link }: NoteLinkSuggestion): RelatedLink => link

/** The chips to show: not already among the entry's links (a tapped one not yet saved) and not just dismissed. */
export const shownSuggestions = (
  suggestions: readonly NoteLinkSuggestion[],
  links: readonly RelatedLink[],
  dismissed: ReadonlySet<string>,
): NoteLinkSuggestion[] => suggestions.filter((s) => !hasLink(links, s) && !dismissed.has(linkKey(s)))
