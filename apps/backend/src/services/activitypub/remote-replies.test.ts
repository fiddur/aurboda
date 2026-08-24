import { describe, expect, test } from 'vitest'

import { fetchRemoteReplies, type RemoteRepliesDeps } from './remote-replies.ts'

const POST = 'https://mastodon.example/notes/1'

/** Deps serving a fixed URL → document map; anything else rejects (unreachable). */
const depsFor = (docs: Record<string, unknown>): RemoteRepliesDeps & { calls: string[] } => {
  const calls: string[] = []
  return {
    calls,
    fetchJson: async (url) => {
      calls.push(url)
      if (url in docs) return docs[url]
      throw new Error(`unreachable ${url}`)
    },
  }
}

const reply = (n: number, over: Record<string, unknown> = {}) => ({
  attributedTo: `https://mastodon.example/users/u${n}`,
  content: `<p>reply ${n}</p>`,
  id: `https://mastodon.example/notes/r${n}`,
  published: '2026-08-20T10:00:00Z',
  type: 'Note',
  url: `https://mastodon.example/@u${n}/r${n}`,
  ...over,
})

const actor = (n: number) => ({
  id: `https://mastodon.example/users/u${n}`,
  name: `User ${n}`,
  preferredUsername: `u${n}`,
  type: 'Person',
})

describe('fetchRemoteReplies', () => {
  test('walks an inline collection, sanitising content and resolving authors', async () => {
    const deps = depsFor({
      [POST]: { id: POST, replies: { items: [reply(1, { content: '<p>hi<script>x</script></p>' })] } },
      'https://mastodon.example/users/u1': actor(1),
    })
    const { partial, replies } = await fetchRemoteReplies(POST, deps)
    expect(partial).toBe(false)
    expect(replies).toHaveLength(1)
    expect(replies[0].content).not.toContain('<script>')
    expect(replies[0].content).toContain('hi')
    expect(replies[0].handle).toBe('@u1@mastodon.example')
    expect(replies[0].display_name).toBe('User 1')
    expect(replies[0].url).toBe('https://mastodon.example/@u1/r1')
  })

  test('follows `first` and `next` pages and fetches URI-referenced items', async () => {
    const deps = depsFor({
      [POST]: { id: POST, replies: `${POST}/replies` },
      [`${POST}/replies`]: { first: `${POST}/replies?page=1`, type: 'Collection' },
      [`${POST}/replies?page=1`]: {
        items: ['https://mastodon.example/notes/r1'],
        next: `${POST}/replies?page=2`,
      },
      [`${POST}/replies?page=2`]: { items: [reply(2)] },
      'https://mastodon.example/notes/r1': reply(1),
      'https://mastodon.example/users/u1': actor(1),
      'https://mastodon.example/users/u2': actor(2),
    })
    const { partial, replies } = await fetchRemoteReplies(POST, deps)
    expect(partial).toBe(false)
    expect(replies.map((r) => r.url)).toEqual([
      'https://mastodon.example/@u1/r1',
      'https://mastodon.example/@u2/r2',
    ])
  })

  test('memoises author lookups and skips items without content', async () => {
    const deps = depsFor({
      [POST]: {
        id: POST,
        replies: { items: [reply(1), reply(1, { id: 'x', url: 'x' }), { type: 'Note' }] },
      },
      'https://mastodon.example/users/u1': actor(1),
    })
    const { replies } = await fetchRemoteReplies(POST, deps)
    expect(replies).toHaveLength(2)
    expect(deps.calls.filter((u) => u === 'https://mastodon.example/users/u1')).toHaveLength(1)
  })

  test('caps at the reply budget and reports partial', async () => {
    const items = Array.from({ length: 30 }, (_, i) => reply(i))
    const deps = depsFor({
      [POST]: { id: POST, replies: { items } },
      ...Object.fromEntries(items.map((_, i) => [`https://mastodon.example/users/u${i}`, actor(i)])),
    })
    const { partial, replies } = await fetchRemoteReplies(POST, deps)
    expect(replies.length).toBeLessThanOrEqual(20)
    expect(partial).toBe(true)
  })

  test('drops a non-http(s) url instead of handing the web a javascript: href', async () => {
    const deps = depsFor({
      [POST]: {
        id: POST,
        replies: {
          items: [
            // eslint-disable-next-line no-script-url
            reply(1, { id: 'not a url', url: 'javascript:alert(1)' }),
            reply(2),
          ],
        },
      },
      'https://mastodon.example/users/u1': actor(1),
      'https://mastodon.example/users/u2': actor(2),
    })
    const { replies } = await fetchRemoteReplies(POST, deps)
    expect(replies.map((r) => r.url)).toEqual([null, 'https://mastodon.example/@u2/r2'])
  })

  test('drops an unparseable published timestamp (the web feeds it to date-fns)', async () => {
    const deps = depsFor({
      [POST]: { id: POST, replies: { items: [reply(1, { published: 'whenever' })] } },
      'https://mastodon.example/users/u1': actor(1),
    })
    const { replies } = await fetchRemoteReplies(POST, deps)
    expect(replies[0].published_at).toBeNull()
  })

  test('an unreachable origin yields an empty, non-throwing result', async () => {
    const { partial, replies } = await fetchRemoteReplies(POST, depsFor({}))
    expect(replies).toEqual([])
    expect(partial).toBe(false)
  })
})
