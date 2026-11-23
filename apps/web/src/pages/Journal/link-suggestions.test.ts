import type { NoteLinkSuggestion } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import { shownSuggestions, suggestionHint, suggestionLink } from './link-suggestions'
import { linkKey } from './related'

const SARA = '00000000-0000-4000-8000-000000000001'
const WALK = '00000000-0000-4000-8000-000000000002'
const SLEEP = '00000000-0000-4000-8000-000000000003'

const suggestions: NoteLinkSuggestion[] = [
  { entity_id: SARA, entity_type: 'person', label: 'Sara', reason: 'name_in_text' },
  {
    activity_type: 'sleep',
    entity_id: SLEEP,
    entity_type: 'activity',
    label: 'Sleep, 2026-11-20',
    reason: 'night_sleep',
  },
  {
    activity_type: 'walking',
    entity_id: WALK,
    entity_type: 'activity',
    label: 'Walk, 2026-11-20',
    reason: 'same_day',
  },
]

describe('link suggestions', () => {
  test('hint at why each is offered', () => {
    expect(suggestions.map(suggestionHint)).toEqual(['named in the text', 'last night', 'that day'])
  })

  test('a tapped chip adds the link without its reason', () => {
    expect(suggestionLink(suggestions[1]!)).toEqual({
      activity_type: 'sleep',
      entity_id: SLEEP,
      entity_type: 'activity',
      label: 'Sleep, 2026-11-20',
    })
  })

  test('leave out what the entry already links, in any case, and what was just dismissed', () => {
    const links = [{ entity_id: SARA.toUpperCase(), entity_type: 'person' as const, label: 'Sara' }]
    const dismissed = new Set([linkKey(suggestions[2]!)])
    expect(shownSuggestions(suggestions, links, dismissed).map((s) => s.entity_id)).toEqual([SLEEP])
    expect(shownSuggestions(suggestions, [], new Set())).toHaveLength(3)
  })
})
