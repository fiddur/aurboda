import { describe, expect, it } from 'vitest'

import { attachmentImageSrc, mastodonGridLayout } from './mastodon-preview'

describe('mastodonGridLayout', () => {
  it('lays out one, two, three and four images', () => {
    expect([1, 2, 3, 4].map(mastodonGridLayout)).toEqual(['single', 'two', 'three', 'four'])
  })
})

describe('attachmentImageSrc', () => {
  const base = { figure: 1, name: 'Figure 1', shown_in_mastodon: true }

  it('draws a figure from its SVG markup', () => {
    expect(attachmentImageSrc({ ...base, image_svg: '<svg width="1"/>' })).toBe(
      'data:image/svg+xml;charset=utf-8,%3Csvg%20width%3D%221%22%2F%3E',
    )
  })

  it("uses a prose image's URL, and nothing for a figure with no data", () => {
    expect(attachmentImageSrc({ ...base, url: 'https://ex.example/cup.png' })).toBe(
      'https://ex.example/cup.png',
    )
    expect(attachmentImageSrc({ ...base, image_svg: null })).toBeNull()
  })
})
