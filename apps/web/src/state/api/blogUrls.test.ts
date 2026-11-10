import { describe, expect, test } from 'vitest'

import {
  blogPath,
  buildArticlesAtomUrl,
  buildOfficialFeedAtomUrl,
  buildPublicTagAtomUrl,
  publicTagPath,
} from './blogUrls'

describe('blogPath', () => {
  test('is the profile path plus /articles, username encoded', () => {
    expect(blogPath('fiddur')).toBe('/u/fiddur/articles')
    expect(blogPath('a b')).toBe('/u/a%20b/articles')
  })
})

describe('buildArticlesAtomUrl', () => {
  test('resolves a same-origin API URL against the page origin (prod)', () => {
    expect(buildArticlesAtomUrl('fiddur', '/api', 'https://aurboda.net')).toBe(
      'https://aurboda.net/api/public/fiddur/articles.atom',
    )
  })

  test('keeps an absolute API URL (dev)', () => {
    expect(buildArticlesAtomUrl('fiddur', 'http://localhost:3000/api/', 'http://localhost:5173')).toBe(
      'http://localhost:3000/api/public/fiddur/articles.atom',
    )
  })
})

describe('buildOfficialFeedAtomUrl', () => {
  test('resolves a same-origin API URL against the page origin, and keeps an absolute one', () => {
    expect(buildOfficialFeedAtomUrl('/api', 'https://aurboda.net')).toBe(
      'https://aurboda.net/api/public/official-feed.atom',
    )
    expect(buildOfficialFeedAtomUrl('http://localhost:3000/api/', 'http://localhost:5173')).toBe(
      'http://localhost:3000/api/public/official-feed.atom',
    )
  })
})

describe('public tag page urls', () => {
  test('the page path and the Atom URL, tag encoded', () => {
    expect(publicTagPath('aurboda')).toBe('/tags/aurboda')
    expect(publicTagPath('löpning')).toBe('/tags/l%C3%B6pning')
    expect(buildPublicTagAtomUrl('aurboda', '/api', 'https://aurboda.net')).toBe(
      'https://aurboda.net/api/public/tags/aurboda.atom',
    )
    expect(buildPublicTagAtomUrl('aurboda', 'http://localhost:3000/api/', 'http://localhost:5173')).toBe(
      'http://localhost:3000/api/public/tags/aurboda.atom',
    )
  })
})
