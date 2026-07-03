import { Note } from '@fedify/fedify/vocab'
import { describe, expect, test } from 'vitest'

import type { FeedFollowingRecord } from '../../db/index.ts'

import { dateToTemporalInstant } from './temporal-interop.ts'
import { noteToTimelineInput, sanitizeRemoteHtml } from './timeline-ingest.ts'

/** Build the ambient `Temporal.Instant` a `Note` expects from an ISO string. */
const published = (iso: string) => dateToTemporalInstant(new Date(iso))

describe('sanitizeRemoteHtml', () => {
  test('keeps benign Mastodon-style content', () => {
    const html = '<p>Nice run! <a href="https://ex.ample/tag">#running</a></p>'
    const out = sanitizeRemoteHtml(html)
    expect(out).toContain('<p>')
    expect(out).toContain('#running')
    expect(out).toContain('href="https://ex.ample/tag"')
  })

  test('strips <script> and inline event handlers (XSS)', () => {
    const out = sanitizeRemoteHtml('<p onclick="steal()">hi</p><script>alert(1)</script>')
    expect(out).not.toContain('<script')
    expect(out).not.toContain('onclick')
    expect(out).not.toContain('alert(1)')
    expect(out).toContain('hi')
  })

  test('drops javascript: and data: URLs on links', () => {
    const out = sanitizeRemoteHtml('<a href="javascript:alert(1)">x</a><a href="data:text/html,x">y</a>')
    expect(out).not.toContain('javascript:')
    expect(out).not.toContain('data:text/html')
  })

  test('removes images, iframes, and style attributes', () => {
    const out = sanitizeRemoteHtml(
      '<img src="https://x/y.png"><iframe src="https://evil"></iframe><p style="color:red">z</p>',
    )
    expect(out).not.toContain('<img')
    expect(out).not.toContain('<iframe')
    expect(out).not.toContain('style=')
    expect(out).toContain('z')
  })

  test('forces safe rel/target on surviving links', () => {
    const out = sanitizeRemoteHtml('<a href="https://ex.ample">link</a>')
    expect(out).toContain('rel="nofollow noopener noreferrer"')
    expect(out).toContain('target="_blank"')
  })
})

describe('noteToTimelineInput', () => {
  const author: FeedFollowingRecord = {
    accepted: true,
    actor_uri: 'https://mastodon.example/users/alice',
    avatar_url: 'https://mastodon.example/avatars/alice.png',
    created_at: new Date('2026-07-01T00:00:00Z'),
    display_name: 'Alice',
    handle: '@alice@mastodon.example',
    id: '11111111-1111-1111-1111-111111111111',
    inbox_uri: 'https://mastodon.example/users/alice/inbox',
    shared_inbox_uri: null,
  }

  test('maps a Note to a timeline input, sanitising content and using the cached author', () => {
    const note = new Note({
      content: '<p>Hello <script>evil()</script></p>',
      id: new URL('https://mastodon.example/notes/1'),
      published: published('2026-07-02T08:30:00Z'),
      url: new URL('https://mastodon.example/@alice/1'),
    })
    const input = noteToTimelineInput(note, author)
    expect(input).not.toBeNull()
    expect(input?.object_uri).toBe('https://mastodon.example/notes/1')
    expect(input?.actor_uri).toBe(author.actor_uri)
    expect(input?.handle).toBe('@alice@mastodon.example')
    expect(input?.content).toContain('Hello')
    expect(input?.content).not.toContain('<script')
    expect(input?.published_at.toISOString()).toBe('2026-07-02T08:30:00.000Z')
    expect(input?.url).toBe('https://mastodon.example/@alice/1')
  })

  test('falls back to the object id when the Note has no url', () => {
    const note = new Note({
      content: '<p>x</p>',
      id: new URL('https://mastodon.example/notes/2'),
      published: published('2026-07-02T09:00:00Z'),
    })
    expect(noteToTimelineInput(note, author)?.url).toBe('https://mastodon.example/notes/2')
  })

  test('returns null when the Note lacks an id or published time', () => {
    const noId = new Note({ content: 'x', published: published('2026-07-02T09:00:00Z') })
    expect(noteToTimelineInput(noId, author)).toBeNull()
    const noPublished = new Note({ content: 'x', id: new URL('https://mastodon.example/notes/3') })
    expect(noteToTimelineInput(noPublished, author)).toBeNull()
  })

  test('rejects a Note whose id is on a different host than the sender (id-collision spoof)', () => {
    // An accepted followee delivering a Note with an id on ANOTHER actor's host
    // could otherwise overwrite that actor's entry via the global object_uri key.
    const spoof = new Note({
      content: '<p>pwned</p>',
      id: new URL('https://good.example/notes/1'),
      published: published('2026-07-02T08:30:00Z'),
    })
    expect(noteToTimelineInput(spoof, author)).toBeNull()
  })

  test('rejects a Note attributed to a different actor', () => {
    const spoof = new Note({
      attribution: new URL('https://mastodon.example/users/mallory'),
      content: '<p>not mine</p>',
      id: new URL('https://mastodon.example/notes/9'),
      published: published('2026-07-02T08:30:00Z'),
    })
    expect(noteToTimelineInput(spoof, author)).toBeNull()
  })

  test('accepts a Note correctly attributed to the sender', () => {
    const note = new Note({
      attribution: new URL(author.actor_uri),
      content: '<p>mine</p>',
      id: new URL('https://mastodon.example/notes/10'),
      published: published('2026-07-02T08:30:00Z'),
    })
    expect(noteToTimelineInput(note, author)?.object_uri).toBe('https://mastodon.example/notes/10')
  })
})
