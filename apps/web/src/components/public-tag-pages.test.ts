import { describe, expect, test } from 'vitest'

import { publicTagSummary, tagLinks } from './public-tag-pages'

describe('publicTagSummary', () => {
  test('names the tag and the retention', () => {
    expect(publicTagSummary('aurboda', 30)).toBe(
      'Public posts tagged #aurboda, from this server and others, from the last 30 days',
    )
    expect(publicTagSummary('aurboda', 1)).toMatch(/last 1 day$/)
  })
})

describe('tagLinks', () => {
  test('links only the tags that have a page', () => {
    expect(tagLinks(['aurboda', 'running'], ['aurboda'])).toEqual([
      { href: '/tags/aurboda', tag: 'aurboda' },
      { href: null, tag: 'running' },
    ])
  })
})
