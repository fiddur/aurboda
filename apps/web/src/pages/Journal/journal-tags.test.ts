import { describe, expect, test } from 'vitest'

import { entriesLabel, lastUsedLabel, mergeTargetTag, tagFilterHref, tagOptions } from './journal-tags'

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
