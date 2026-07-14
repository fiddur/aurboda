// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { renderMarkdown } from './markdown'

describe('renderMarkdown', () => {
  it('renders GFM markdown to HTML', () => {
    const html = renderMarkdown('**bold** and [a link](https://example.com)')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('href="https://example.com"')
  })

  it('honours hard line breaks (breaks: true)', () => {
    expect(renderMarkdown('a\nb')).toContain('<br')
  })

  it('strips a <script> tag', () => {
    const html = renderMarkdown('hi <script>alert(1)</script>')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('alert(1)')
  })

  it('strips an event-handler attribute (the stored-XSS vector)', () => {
    const html = renderMarkdown('<img src=x onerror="alert(1)">')
    expect(html).not.toContain('onerror')
  })

  it('strips a javascript: URL', () => {
    const html = renderMarkdown('[x](javascript:alert(1))')
    expect(html.toLowerCase()).not.toContain('javascript:')
  })

  it('keeps a safe inline image', () => {
    expect(renderMarkdown('![alt](https://example.com/a.png)')).toContain('src="https://example.com/a.png"')
  })
})
