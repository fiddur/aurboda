import { describe, expect, test } from 'vitest'

import {
  journalEntryHref,
  NEIGHBOR_EXCERPT_MAX,
  neighborAnchorKey,
  neighborDate,
  neighborLabel,
  neighborText,
} from './neighbors'

const id = '9d0124e7-d161-4855-a54f-fa8bdb45c4f2'

describe('journal neighbours', () => {
  test('the date of a day entry, or of a timed entry in local time', () => {
    expect(neighborDate({ date: '2024-01-15' })).toBe('15 Jan 2024')
    expect(neighborDate({ start_time: '2024-01-15T08:00:00.000Z' })).toBe('15 Jan 2024')
    expect(neighborDate({})).toBe('')
  })

  test('the title, or else the excerpt cut short', () => {
    expect(neighborText({ excerpt: 'Text', title: ' Monday ' })).toBe('Monday')
    expect(neighborText({ excerpt: ' Short line ', title: '' })).toBe('Short line')
    const long = neighborText({ excerpt: 'word '.repeat(20) })
    expect(long.length).toBeLessThanOrEqual(NEIGHBOR_EXCERPT_MAX)
    expect(long.endsWith('…')).toBe(true)
    expect(neighborText({ excerpt: '' })).toBe('')
  })

  test('the label joins the date and the text, leaving out an empty one', () => {
    expect(neighborLabel({ date: '2024-01-15', entity_type: 'day', excerpt: 'Walked', id })).toBe(
      '15 Jan 2024 · Walked',
    )
    expect(neighborLabel({ date: '2024-01-15', entity_type: 'day', excerpt: '', id })).toBe('15 Jan 2024')
  })

  test('the anchor key follows the kind of entry', () => {
    const form = { allDay: true, date: '2024-01-15', start: '2024-01-15T08:00' }
    expect(neighborAnchorKey(form)).toBe('day:2024-01-15')
    expect(neighborAnchorKey({ ...form, allDay: false })).toBe('time:2024-01-15T08:00')
  })

  test('an entry links to its editor', () => {
    expect(journalEntryHref(id)).toBe(`/journal/${id}`)
  })
})
