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

  it('drops form controls, so a post cannot render a credential-looking form', () => {
    const html = renderMarkdown(
      '<form action="https://evil"><input name="pw"><select><option>a</option></select>' +
        '<textarea>t</textarea><button>go</button></form>',
    )
    for (const tag of ['<form', '<input', '<select', '<textarea', '<button']) expect(html).not.toContain(tag)
  })

  it('drops inline styles and <style> blocks', () => {
    const html = renderMarkdown(
      '<div style="color:red">styled div</div>\n\n<style>body{display:none}</style>',
    )
    expect(html).not.toContain('style=')
    expect(html).not.toContain('<style')
    expect(html).not.toContain('display:none')
    expect(html).toContain('styled div')
  })

  it('keeps an image only from an http(s) URL', () => {
    const dataImg = renderMarkdown('![pic](data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=)')
    expect(dataImg).not.toContain('data:')
    expect(dataImg).toContain('alt="pic"')
    expect(renderMarkdown('<img src="/api/logout" alt="r">')).not.toContain('src=')
    expect(renderMarkdown('<img srcset="data:image/png;base64,AAAA 1x" alt="s">')).not.toContain('data:')
    expect(renderMarkdown('![http](http://example.com/a.png)')).toContain('src="http://example.com/a.png"')
  })

  it('keeps links working, mailto included', () => {
    const html = renderMarkdown('[web](https://example.com) [mail](mailto:a@example.com)')
    expect(html).toContain('href="https://example.com"')
    expect(html).toContain('href="mailto:a@example.com"')
  })

  it('does not change what renderRemoteMarkdown keeps', () => {
    renderMarkdown('![pic](data:image/png;base64,AAAA)')
    expect(renderRemoteMarkdown('[x](https://example.com)')).toContain('href="https://example.com"')
  })
})
