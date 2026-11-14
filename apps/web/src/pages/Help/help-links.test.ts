import { describe, expect, test } from 'vitest'

import { docsUrl } from '../../utils/docs-url'
import { BUG_REPORT_LINK, DISCUSSION_LINKS, DOCS_LINKS, versionLink } from './help-links'

describe('help links', () => {
  test('every external link is https', () => {
    for (const { href } of [...DISCUSSION_LINKS, BUG_REPORT_LINK, ...DOCS_LINKS]) {
      expect(href).toMatch(/^https:\/\//)
    }
  })

  test('the discussion links open the right categories', () => {
    const hrefs = DISCUSSION_LINKS.map((l) => l.href)
    expect(hrefs.some((h) => h.includes('category=q-a'))).toBe(true)
    expect(hrefs.some((h) => h.includes('category=ideas'))).toBe(true)
  })

  test('every docs entry points into the documentation', () => {
    const base = docsUrl('')
    for (const { href } of DOCS_LINKS) {
      expect(href.startsWith(base)).toBe(true)
      expect(href.length).toBeGreaterThan(base.length)
    }
  })

  test('a release version links to its release notes', () => {
    expect(versionLink('1.0.3600')).toEqual({
      href: 'https://github.com/fiddur/aurboda/releases/tag/v1.0.3600',
      label: '1.0.3600',
    })
  })

  test('a commit version links to the commit, labelled short', () => {
    const sha = '09a681f2c5e1b7d3a4f6e8c0b2d4f6a8c0e2a4b6'
    expect(versionLink(sha)).toEqual({
      href: `https://github.com/fiddur/aurboda/commit/${sha}`,
      label: '09a681f',
    })
  })

  test('a local build has nothing to link to', () => {
    expect(versionLink('dev')).toBeUndefined()
  })
})
