import { describe, expect, test } from 'vitest'

import {
  identityToActorUri,
  identityToHandle,
  renderChallengeResultHtml,
  renderChallengeShareHtml,
} from './challenge-object.ts'

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

describe('identity helpers', () => {
  test('map a profile URL to the webfinger handle and the /users/ actor id, keeping an instance sub-path', () => {
    expect(identityToHandle('https://aurboda.net/u/alice')).toBe('alice@aurboda.net')
    expect(identityToActorUri('https://aurboda.net/u/alice')).toBe('https://aurboda.net/users/alice')
    expect(identityToHandle('https://host.example/sub/u/anna/')).toBe('anna@host.example')
    expect(identityToActorUri('https://host.example/sub/u/anna/')).toBe('https://host.example/sub/users/anna')
    expect(identityToActorUri('http://localhost:5173/u/dev?x=1#f')).toBe('http://localhost:5173/users/dev')
    expect(identityToHandle('http://localhost:5173/u/dev')).toBe('dev@localhost:5173')
  })

  test('reject non-profile URLs', () => {
    expect(identityToHandle('https://aurboda.net/challenges')).toBeNull()
    expect(identityToActorUri('https://aurboda.net/u/alice/slug')).toBeNull()
    expect(identityToActorUri('not a url')).toBeNull()
  })
})

describe('renderChallengeShareHtml with a result (completion post)', () => {
  const result = {
    member_count: 4,
    podium: [
      { display_name: 'alice', identity_base_url: 'https://aurboda.net/u/alice', rank: 1, total: 138989 },
      { display_name: 'bob', identity_base_url: 'https://other.example/u/bob', rank: 2, total: 120055.4 },
      { display_name: 'carol', identity_base_url: 'https://aurboda.net/u/carol', rank: 3, total: 9000 },
    ],
    unit: 'steps',
  }

  test('renders the finished heading, the winner as a mention link, runners-up with medals, and the link', () => {
    const html = renderChallengeShareHtml({ ...challenge, result }, null)
    expect(html).toContain('<p><strong>August 10k steps</strong> has finished! 🏁</p>')
    expect(html).toContain(
      '🏆 Winner: <span class="h-card"><a href="https://aurboda.net/u/alice" class="u-url mention">@<span>alice</span></a></span> with 138,989 steps',
    )
    expect(html).toContain('🥈 bob · 120,055 steps<br>🥉 carol · 9,000 steps')
    expect(html).toContain('<p>4 members competed.</p>')
    expect(html).toContain(`<a href="${challenge.url}"`)
  })

  test('a tie for first lists every winner as a mention', () => {
    const tie = {
      ...result,
      podium: [
        { ...result.podium[0] },
        { ...result.podium[1], rank: 1, total: 138989 },
        { ...result.podium[2], rank: 3 },
      ],
    }
    const html = renderChallengeShareHtml({ ...challenge, result: tie }, null)
    expect(html).toContain('🏆 Tied winners: ')
    expect(html).toContain('@<span>alice</span></a></span> and <span class="h-card">')
    expect(html).toContain('@<span>bob</span>')
    expect(html).not.toContain('🥈')
  })

  test('escapes names and units from the result (they came from other instances)', () => {
    const html = renderChallengeResultHtml({
      member_count: 1,
      podium: [{ display_name: '<b>x</b>', identity_base_url: 'https://h/u/<i>', rank: 1, total: 1 }],
      unit: '<script>',
    })
    expect(html).not.toContain('<b>')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('<p>1 member competed.</p>')
  })
})
