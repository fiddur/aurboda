import { describe, expect, test } from 'vitest'

import { renderChallengeShareHtml } from './challenge-object.ts'

const challenge = { name: 'August 10k steps', url: 'https://aurboda.net/u/fiddur/august-10k' }

describe('renderChallengeShareHtml', () => {
  test('renders name heading, sanitised markdown note, and the canonical link', () => {
    const html = renderChallengeShareHtml(challenge, 'Join me — **every step counts**!')
    expect(html).toContain('<p><strong>August 10k steps</strong></p>')
    expect(html).toContain('<strong>every step counts</strong>')
    expect(html).toContain(`<a href="${challenge.url}"`)
    expect(html).toContain('rel="nofollow noopener noreferrer"')
  })

  test('omits the note paragraph when there is no message', () => {
    const html = renderChallengeShareHtml(challenge, null)
    expect(html).toBe(
      '<p><strong>August 10k steps</strong></p>\n' +
        `<p><a href="${challenge.url}" rel="nofollow noopener noreferrer" target="_blank">${challenge.url}</a></p>`,
    )
  })

  test('escapes an HTML-ish challenge name and strips scripts from the note (XSS boundary)', () => {
    const html = renderChallengeShareHtml(
      { name: '<img src=x onerror=alert(1)> race', url: 'https://h.example/u/a/x' },
      'note <script>alert(1)</script> end',
    )
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<script')
    expect(html).toContain('&lt;img')
    expect(html).toContain('note ')
    expect(html).toContain(' end')
  })
})
