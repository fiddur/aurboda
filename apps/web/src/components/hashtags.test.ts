import { describe, expect, test } from 'vitest'

import {
  autoTagsFor,
  formatTagsInput,
  invalidTagTokens,
  parseTagFilterInput,
  parseTagsInput,
  profileTagPath,
  tagFilterFromQuery,
} from './hashtags'

describe('tags input', () => {
  test('parses #tags separated by spaces or commas, normalised and deduped', () => {
    expect(parseTagsInput('#Aurboda, running  #aurboda #Löpning')).toEqual(['aurboda', 'running', 'löpning'])
    expect(parseTagsInput('   ')).toEqual([])
  })

  test('drops and reports what is not a tag', () => {
    expect(parseTagsInput('#ok #not-ok 42')).toEqual(['ok'])
    expect(invalidTagTokens('#ok #not-ok 42')).toEqual(['#not-ok', '42'])
  })

  test('parses a filter of more tags than a post may carry', () => {
    const many = Array.from({ length: 15 }, (_, i) => `#tag${i}`).join(' ')
    expect(parseTagFilterInput(many)).toHaveLength(15)
    expect(parseTagFilterInput('#A a #not-ok')).toEqual(['a'])
  })

  test('formats tags with # for the field', () => {
    expect(formatTagsInput(['aurboda', 'running'])).toBe('#aurboda #running')
    expect(formatTagsInput([])).toBe('')
  })
})

describe('autoTagsFor', () => {
  test('defaults to #aurboda plus the kind tag', () => {
    expect(autoTagsFor(undefined, 'challenge')).toEqual(['aurboda', 'challenge'])
  })

  test('follows the settings', () => {
    expect(autoTagsFor({ feed_default_tags: ['qs'], feed_type_tag: false }, 'challenge')).toEqual(['qs'])
    expect(autoTagsFor({ feed_default_tags: [] }, null)).toEqual([])
  })
})

describe('profile tag filter', () => {
  test('reads a normalised ?tag=', () => {
    expect(tagFilterFromQuery('#Running')).toBe('running')
    expect(tagFilterFromQuery('not a tag')).toBeNull()
    expect(tagFilterFromQuery(undefined)).toBeNull()
  })

  test('links a tag to the filtered profile', () => {
    expect(profileTagPath('fiddur', 'löpning')).toBe('/u/fiddur?tag=l%C3%B6pning')
  })
})
