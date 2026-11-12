import express from 'express'
import supertest from 'supertest'
import { describe, expect, test, vi } from 'vitest'

import type { PublicTagPostRecord } from '../services/central-public-tags.ts'
import type { PublicTagActions } from '../services/public-tags.ts'

import { createFeedPublicRouter } from './feed-public-router.ts'

const record: PublicTagPostRecord = {
  actor_uri: 'https://peer.example/users/bob',
  announce_uris: ['https://tags.example/announce/1'],
  avatar_url: null,
  content: '<p>Hello #aurboda</p>',
  created_at: new Date('2026-11-02T00:00:00Z'),
  cursor_ts: '2026-11-01 10:00:00+00',
  display_name: 'Bob',
  handle: '@bob@peer.example',
  id: '11111111-1111-4111-8111-111111111111',
  images: [{ name: 'A <chart>', url: 'https://peer.example/a.png' }],
  local_user: null,
  note_uri: 'https://peer.example/notes/1',
  published_at: new Date('2026-11-01T10:00:00Z'),
  tags: ['aurboda'],
  updated_at: new Date('2026-11-03T00:00:00Z'),
  url: 'https://peer.example/@bob/1',
}

const publicTags: Pick<PublicTagActions, 'latest' | 'page'> = {
  latest: vi.fn(async (tag: string) => (tag === 'aurboda' ? { posts: [record], tag } : null)),
  page: vi.fn(async (tag: string) =>
    tag === 'aurboda'
      ? {
          ok: true as const,
          page: { next_cursor: null, posts: [], retention_days: 30, success: true, tag: 'aurboda' },
        }
      : { ok: false as const },
  ),
}

const app = (deps: { publicTags?: typeof publicTags } = { publicTags }) => {
  const httpd = express()
  httpd.use(
    createFeedPublicRouter({
      apiBaseUrl: 'https://aurboda.example/api',
      webHost: 'https://aurboda.example',
      ...deps,
    }),
  )
  httpd.use((_req, res) => {
    res.status(418).send('next handler')
  })
  return supertest(httpd)
}

describe('GET /public/tags/:tag/posts', () => {
  test('serves a configured tag’s page, uncached, passing the cursor on', async () => {
    const res = await app().get('/public/tags/aurboda/posts?cursor=abc')
    expect(res.status).toBe(200)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.body).toMatchObject({ retention_days: 30, success: true, tag: 'aurboda' })
    expect(publicTags.page).toHaveBeenCalledWith('aurboda', 'abc')
  })

  test('404s a tag without a page, and every tag without the dependency', async () => {
    expect((await app().get('/public/tags/running/posts')).status).toBe(404)
    expect((await app({}).get('/public/tags/aurboda/posts')).status).toBe(404)
  })
})

describe('GET /public/tags/:tag.atom', () => {
  test('serves the newest posts as Atom, each linking to its original', async () => {
    const res = await app().get('/public/tags/aurboda.atom')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('application/atom+xml')
    expect(res.text).toContain('<title type="text">#aurboda on aurboda.example</title>')
    expect(res.text).toContain('href="https://aurboda.example/tags/aurboda"')
    expect(res.text).toContain('href="https://aurboda.example/api/public/tags/aurboda.atom"')
    expect(res.text).toContain('<id>https://peer.example/notes/1</id>')
    expect(res.text).toContain('href="https://peer.example/@bob/1"')
    expect(res.text).toContain('<name>Bob</name>')
    expect(res.text).toContain('&lt;img src=&quot;https://peer.example/a.png&quot;')
    expect(res.text).not.toContain('<chart>')
  })

  test('passes a tag without a page on to the next handler', async () => {
    const res = await app().get('/public/tags/running.atom')
    expect(res.status).toBe(418)
    expect(res.text).toBe('next handler')
    expect((await app({}).get('/public/tags/aurboda.atom')).status).toBe(418)
  })
})

describe('a remote-only official feed', () => {
  const listOfficialRemotePosts = vi.fn(async () => [record])
  const feedApp = (remote_authors: string[] = ['bob@peer.example']) =>
    supertest(
      express().use(
        createFeedPublicRouter({
          apiBaseUrl: 'https://aurboda.example/api',
          listOfficialRemotePosts,
          readOfficialFeed: async () => ({ remote_authors, tags: ['aurboda'], users: [] }),
          webHost: 'https://aurboda.example',
        }),
      ),
    )

  test('is on, listing the remote authors’ posts as a public tag page shows them', async () => {
    listOfficialRemotePosts.mockClear()
    const res = await feedApp().get('/public/official-feed')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      next_cursor: null,
      remote_authors: ['bob@peer.example'],
      success: true,
      tags: ['aurboda'],
      users: [],
    })
    expect(res.body.posts).toEqual([
      {
        actor_uri: 'https://peer.example/users/bob',
        avatar_url: null,
        content: '<p>Hello #aurboda</p>',
        display_name: 'Bob',
        handle: '@bob@peer.example',
        id: record.id,
        images: record.images,
        object_uri: 'https://peer.example/notes/1',
        origin: 'remote',
        published_at: '2026-11-01T10:00:00.000Z',
        received_at: '2026-11-02T00:00:00.000Z',
        tags: ['aurboda'],
        url: 'https://peer.example/@bob/1',
      },
    ])
    expect(listOfficialRemotePosts).toHaveBeenCalledWith(['@bob@peer.example'], ['aurboda'], 21, undefined)
  })

  test('serves the remote posts as Atom entries linking their originals', async () => {
    const res = await feedApp().get('/public/official-feed.atom')
    expect(res.status).toBe(200)
    expect(res.text).toContain('<title type="text">aurboda.example blog</title>')
    expect(res.text).toContain('<id>https://peer.example/notes/1</id>')
    expect(res.text).toContain('href="https://peer.example/@bob/1"')
    expect(res.text).toContain('<title type="text">Hello #aurboda</title>')
    expect(res.text).toContain('<author><name>Bob</name><uri>https://peer.example/users/bob</uri></author>')
  })

  test('is off with neither users nor remote authors', async () => {
    expect((await feedApp([]).get('/public/official-feed')).status).toBe(404)
  })
})
