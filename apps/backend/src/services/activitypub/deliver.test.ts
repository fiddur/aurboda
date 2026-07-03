import { Tombstone } from '@fedify/fedify/vocab'
import { describe, expect, test } from 'vitest'

import { buildFeedDelete, type DeliverablePost, imageAttachments, recipients } from './deliver.ts'
import { createFeedFederation } from './federation.ts'

const PUBLIC = 'https://www.w3.org/ns/activitystreams#Public'
const followers = new URL('https://aurboda.net/users/fiddur/followers')

const hrefs = (urls: URL[]) => urls.map((u) => u.href)

describe('recipients', () => {
  test('public → Public in to, followers in cc', () => {
    const { to, cc } = recipients('public', followers)
    expect(hrefs(to)).toEqual([PUBLIC])
    expect(hrefs(cc)).toEqual([followers.href])
  })

  test('unlisted → followers in to, Public in cc', () => {
    const { to, cc } = recipients('unlisted', followers)
    expect(hrefs(to)).toEqual([followers.href])
    expect(hrefs(cc)).toEqual([PUBLIC])
  })

  test('followers → followers only, never Public', () => {
    const { to, cc } = recipients('followers', followers)
    expect(hrefs(to)).toEqual([followers.href])
    expect(cc).toEqual([])
  })
})

describe('buildFeedDelete', () => {
  const ORIGIN = 'https://aurboda.example'
  const deliverablePost = (visibility: DeliverablePost['visibility']): DeliverablePost => ({
    created_at: new Date('2026-07-01T00:00:00Z'),
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    include_chart: false,
    include_map: false,
    included_metrics: [],
    updated_at: new Date('2026-07-01T00:00:00Z'),
    visibility,
  })

  // No DB: builds a Fedify context off the federation's registered dispatchers
  // (URL builders only), so the Delete/Tombstone shape is unit-testable.
  const contextFor = () => createFeedFederation(ORIGIN).createContext(new URL(ORIGIN))

  test('wraps a Tombstone at the post object id, addressed by visibility', async () => {
    const ctx = await contextFor()
    const post = deliverablePost('public')
    const del = buildFeedDelete(ctx, 'fiddur', post)

    const noteId = `${ORIGIN}/users/fiddur/feed/${post.id}`
    expect(del.actorId?.href).toBe(`${ORIGIN}/users/fiddur`)
    expect(del.id?.href).toBe(`${noteId}#delete`)

    const object = await del.getObject()
    expect(object).toBeInstanceOf(Tombstone)
    expect(object?.id?.href).toBe(noteId)

    expect(hrefs([...del.toIds])).toContain(PUBLIC)
    expect(hrefs([...del.ccIds])).toContain(`${ORIGIN}/users/fiddur/followers`)
  })

  test('addresses a followers-only delete to followers, never Public', async () => {
    const ctx = await contextFor()
    const del = buildFeedDelete(ctx, 'fiddur', deliverablePost('followers'))
    expect(hrefs([...del.toIds])).toEqual([`${ORIGIN}/users/fiddur/followers`])
    expect([...del.ccIds]).toEqual([])
  })
})

describe('imageAttachments', () => {
  const actorUri = new URL('https://aurboda.example/users/fiddur')
  const POST_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const base = `https://aurboda.example/api/public/fiddur/feed/${POST_ID}`
  const post = (overrides: Partial<DeliverablePost>): DeliverablePost => ({
    created_at: new Date('2026-07-01T00:00:00Z'),
    id: POST_ID,
    include_chart: false,
    include_map: false,
    included_metrics: [],
    updated_at: new Date('2026-07-01T00:00:00Z'),
    visibility: 'public',
    ...overrides,
  })

  test('attaches only the opted-in images, at the public endpoints', () => {
    const chartOnly = imageAttachments(actorUri, 'fiddur', post({ include_chart: true }))
    expect(chartOnly.map((a) => a.url?.href)).toEqual([`${base}/chart.png`])

    const both = imageAttachments(actorUri, 'fiddur', post({ include_chart: true, include_map: true }))
    expect(both.map((a) => a.url?.href)).toEqual([`${base}/chart.png`, `${base}/route.png`])
  })

  test('attaches nothing for a followers-only post (image endpoint is unauthenticated)', () => {
    const atts = imageAttachments(
      actorUri,
      'fiddur',
      post({ include_chart: true, include_map: true, visibility: 'followers' }),
    )
    expect(atts).toEqual([])
  })

  test('attaches nothing when neither flag is set', () => {
    expect(imageAttachments(actorUri, 'fiddur', post({}))).toEqual([])
  })
})
