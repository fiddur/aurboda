import { describe, expect, test } from 'vitest'

import { docsUrl } from '../../utils/docs-url'
import { BUG_REPORT_LINK, DISCUSSION_LINKS, DOCS_LINKS } from './help-links'

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
})
