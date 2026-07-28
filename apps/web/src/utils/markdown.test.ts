// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { renderMarkdown, renderRemoteMarkdown } from './markdown'

describe('renderRemoteMarkdown', () => {
  it('drops every media tracker vector, not just <img>', () => {
    const html = renderRemoteMarkdown(
      'text ![](https://tracker.example/a.gif)\n\n' +
        '<div style="background-image:url(https://tracker.example/b.png)"></div>\n' +
        '<video poster="https://tracker.example/c.gif"></video><svg><image href="https://tracker.example/d"/></svg>',
    )
    expect(html).not.toContain('tracker.example')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<video')
    expect(html).not.toContain('poster')
    expect(html).not.toContain('style=')
    expect(html).not.toContain('<svg')
    expect(html).toContain('text')
  })

  it('still renders the safe allowlisted formatting and strips scripts', () => {
    const html = renderRemoteMarkdown(
      '**bold** [x](https://example.com)\n\n| a |\n| - |\n| 1 |\n\n<script>alert(1)</script>',
    )
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('href="https://example.com"')
    expect(html).toContain('<table>')
    expect(html).not.toContain('<script')
  })

  it('hardens links with rel=nofollow noopener noreferrer and target=_blank', () => {
    const html = renderRemoteMarkdown('[x](https://example.com)')
    expect(html).toContain('rel="nofollow noopener noreferrer"')
    expect(html).toContain('target="_blank"')
  })

  it('does not leave the link-hardening hook active for renderMarkdown (own content)', () => {
    // renderRemoteMarkdown adds+removes its afterSanitizeAttributes hook within one
    // synchronous call; a later renderMarkdown must not inherit it.
    renderRemoteMarkdown('[peer](https://peer.example)')
    const own = renderMarkdown('[mine](https://example.com)')
    expect(own).not.toContain('nofollow')
  })
})

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
