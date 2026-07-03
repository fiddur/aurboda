import { describe, expect, test } from 'vitest'

import { buildOEmbedLink, parseShareUrl } from './oembed.ts'

describe('parseShareUrl', () => {
  test('parses a dashboard/challenge share URL', () => {
    expect(parseShareUrl('https://aurboda.net/u/fiddur/abc123')).toEqual({
      slug: 'abc123',
      username: 'fiddur',
    })
  })

  test('parses a profile URL', () => {
    expect(parseShareUrl('https://aurboda.net/u/fiddur')).toEqual({ username: 'fiddur' })
  })

  test('tolerates a sub-path-hosted base', () => {
    expect(parseShareUrl('http://host/some/base/u/fiddur/abc')).toEqual({
      slug: 'abc',
      username: 'fiddur',
    })
  })

  test('decodes percent-encoded segments', () => {
    expect(parseShareUrl('https://aurboda.net/u/a%20b')).toEqual({ username: 'a b' })
  })

  test('returns null for non-share URLs and malformed input', () => {
    expect(parseShareUrl('https://aurboda.net/dashboard')).toBeNull()
    expect(parseShareUrl('https://aurboda.net/u/a/b/c')).toBeNull()
    expect(parseShareUrl('not a url')).toBeNull()
  })
})

describe('buildOEmbedLink', () => {
  test('builds a spec-shaped link document', () => {
    const doc = buildOEmbedLink({
      authorName: 'fiddur',
      authorUrl: 'https://aurboda.net/u/fiddur',
      providerUrl: 'https://aurboda.net',
      thumbnailUrl: 'https://aurboda.net/u/fiddur/abc/opengraph-image.png',
      title: 'My dashboard',
    })
    expect(doc).toMatchObject({
      author_name: 'fiddur',
      provider_name: 'Aurboda',
      thumbnail_height: 630,
      thumbnail_width: 1200,
      title: 'My dashboard',
      type: 'link',
      version: '1.0',
    })
  })
})
