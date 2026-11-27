import { describe, expect, test } from 'vitest'

import {
  completeTyped,
  entriesAndCommentsLabel,
  entriesLabel,
  lastTypedWord,
  lastUsedLabel,
  mergeButtonLabel,
  mergedLabel,
  mergeTargetTag,
  tagFilterHref,
  tagOptions,
  tagSuggestions,
} from './journal-tags'

const tags = [
  { count: 5, last_used: '2026-11-20T08:00:00.000Z', tag: 'run' },
  { count: 3, last_used: '2026-11-19T08:00:00.000Z', tag: 'running' },
  { count: 1, last_used: '2026-11-01T08:00:00.000Z', tag: 'family' },
]

describe('mergeTargetTag', () => {
  test('trims, strips a leading # and lowercases', () => {
    expect(mergeTargetTag('  #Run ')).toBe('run')
    expect(mergeTargetTag('Löpning')).toBe('löpning')
  })

  test('null for what is not a tag', () => {
    expect(mergeTargetTag('')).toBeNull()
    expect(mergeTargetTag('#')).toBeNull()
    expect(mergeTargetTag('123')).toBeNull()
    expect(mergeTargetTag('two words')).toBeNull()
  })
})

describe('tagOptions', () => {
  test('all of them, in the order given, with no search', () => {
    expect(tagOptions(tags, '').map((t) => t.tag)).toEqual(['run', 'running', 'family'])
  })

  test('those holding the search, with or without #, whatever its casing', () => {
    expect(tagOptions(tags, 'RUN').map((t) => t.tag)).toEqual(['run', 'running'])
    expect(tagOptions(tags, ' #nni ').map((t) => t.tag)).toEqual(['running'])
    expect(tagOptions(tags, 'mil').map((t) => t.tag)).toEqual(['family'])
    expect(tagOptions(tags, 'swim')).toEqual([])
  })

  test('leaves out the excluded ones', () => {
    expect(tagOptions(tags, 'run', ['run']).map((t) => t.tag)).toEqual(['running'])
  })
})

describe('labels', () => {
  test('entriesLabel', () => {
    expect(entriesLabel(1)).toBe('1 entry')
    expect(entriesLabel(0)).toBe('0 entries')
    expect(entriesLabel(12)).toBe('12 entries')
  })

  test('lastUsedLabel gives the local date, nothing for a bad one', () => {
    expect(lastUsedLabel(new Date(2026, 10, 20, 12).toISOString())).toBe('20 Nov 2026')
    expect(lastUsedLabel('not a date')).toBe('')
  })

  test('tagFilterHref', () => {
    expect(tagFilterHref('löpning')).toBe('/journal?tag=l%C3%B6pning')
  })
})

describe('tagSuggestions', () => {
  const more = [{ count: 9, last_used: '2026-11-21T08:00:00.000Z', tag: 'longrun' }, ...tags]

  test('the most used tags when nothing is typed yet', () => {
    expect(tagSuggestions(more, '', []).map((t) => t.tag)).toEqual(['longrun', 'run', 'running', 'family'])
  })

  test('tags starting with the word first, then those holding it, each most used first', () => {
    expect(tagSuggestions(more, 'ru', []).map((t) => t.tag)).toEqual(['run', 'running', 'longrun'])
  })

  test('completes the last word only, with or without #', () => {
    expect(tagSuggestions(more, 'family, #fam', []).map((t) => t.tag)).toEqual(['family'])
    expect(tagSuggestions(more, 'run ', []).map((t) => t.tag)).toEqual([
      'longrun',
      'run',
      'running',
      'family',
    ])
  })

  test('matches tags ignoring accents', () => {
    const swedish = [
      { count: 2, last_used: '2026-11-21T08:00:00.000Z', tag: 'kvällslöpning' },
      { count: 1, last_used: '2026-11-21T08:00:00.000Z', tag: 'löpning' },
    ]
    expect(tagSuggestions(swedish, 'lop', []).map((t) => t.tag)).toEqual(['löpning', 'kvällslöpning'])
    expect(tagOptions(swedish, 'KVALL').map((t) => t.tag)).toEqual(['kvällslöpning'])
  })

  test('leaves out the tags the entry already has', () => {
    expect(tagSuggestions(more, 'run', ['run', 'longrun']).map((t) => t.tag)).toEqual(['running'])
  })

  test('at most eight', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      count: 12 - i,
      last_used: '2026-11-01T08:00:00.000Z',
      tag: `t${i}`,
    }))
    expect(tagSuggestions(many, '', [])).toHaveLength(8)
  })
})

describe('lastTypedWord and completeTyped', () => {
  test('the word after the last space or comma', () => {
    expect(lastTypedWord('')).toBe('')
    expect(lastTypedWord('run')).toBe('run')
    expect(lastTypedWord('run, fam')).toBe('fam')
    expect(lastTypedWord('run ')).toBe('')
  })

  test('replaces only that word', () => {
    expect(completeTyped('fam', 'family')).toBe('family')
    expect(completeTyped('run, #fam', 'family')).toBe('run, family')
    expect(completeTyped('run ', 'family')).toBe('run family')
  })
})

describe('merge labels', () => {
  test('entriesAndCommentsLabel', () => {
    expect(entriesAndCommentsLabel(1)).toBe('1 entry or comment')
    expect(entriesAndCommentsLabel(5)).toBe('5 entries and comments')
  })

  test('the button names what the dry run will change, once known', () => {
    expect(mergeButtonLabel('running', 'run', 5)).toBe('Merge #running (5 entries and comments) into #run')
    expect(mergeButtonLabel('running', 'run', undefined)).toBe('Merge #running into #run')
  })

  test('the result says what was skipped and that merging again picks it up', () => {
    expect(mergedLabel({ changed: 5, skipped: 0 })).toBe('Merged: 5 entries and comments changed.')
    expect(mergedLabel({ changed: 4, skipped: 1 })).toBe(
      'Merged: 4 entries and comments changed. 1 entry or comment changed meanwhile and was skipped; merge again to include it.',
    )
    expect(mergedLabel({ changed: 3, skipped: 2 })).toBe(
      'Merged: 3 entries and comments changed. 2 entries and comments changed meanwhile and were skipped; merge again to include them.',
    )
  })
})
