import type { ArticleContent } from '@aurboda/api-spec'

import { Note, Tombstone } from '@fedify/fedify/vocab'
import { describe, expect, test } from 'vitest'

import {
  buildArticleNote,
  buildArticleNoteCreate,
  buildChallengeNote,
  buildChallengeNoteCreate,
  buildFeedDelete,
  type DeliverableArticle,
  type DeliverableChallenge,
  type DeliverablePost,
  imageAttachments,
  recipients,
} from './deliver.ts'
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
    image_token: 'secret-token',
    include_chart: false,
    include_map: false,
    included_metrics: [],
    series_metrics: [],
    updated_at: new Date('2026-07-01T00:00:00Z'),
    visibility,
  })

  // No DB: builds a Fedify context off the federation's registered dispatchers
  // (URL builders only), so the Delete/Tombstone shape is unit-testable.
  const contextFor = () => createFeedFederation(ORIGIN, `${ORIGIN}/api`).createContext(new URL(ORIGIN))

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
  const apiBaseUrl = 'https://aurboda.example/api'
  const POST_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const base = `https://aurboda.example/api/public/fiddur/feed/${POST_ID}`
  const post = (overrides: Partial<DeliverablePost>): DeliverablePost => ({
    created_at: new Date('2026-07-01T00:00:00Z'),
    id: POST_ID,
    image_token: 'secret-token',
    include_chart: false,
    include_map: false,
    included_metrics: [],
    series_metrics: [],
    updated_at: new Date('2026-07-01T00:00:00Z'),
    visibility: 'public',
    ...overrides,
  })

  test('attaches only the opted-in images, at the public endpoints (no token for public)', () => {
    const chartOnly = imageAttachments(apiBaseUrl, 'fiddur', post({ include_chart: true }))
    expect(chartOnly.map((a) => a.url?.href)).toEqual([`${base}/chart.png`])

    const both = imageAttachments(apiBaseUrl, 'fiddur', post({ include_chart: true, include_map: true }))
    expect(both.map((a) => a.url?.href)).toEqual([`${base}/chart.png`, `${base}/route.png`])
  })

  test('attaches unlisted images without a token', () => {
    const atts = imageAttachments(apiBaseUrl, 'fiddur', post({ include_chart: true, visibility: 'unlisted' }))
    expect(atts.map((a) => a.url?.href)).toEqual([`${base}/chart.png`])
  })

  test('attaches followers-only images carrying the capability token (#893)', () => {
    const atts = imageAttachments(
      apiBaseUrl,
      'fiddur',
      post({ include_chart: true, include_map: true, visibility: 'followers' }),
    )
    expect(atts.map((a) => a.url?.href)).toEqual([
      `${base}/chart.png?token=secret-token`,
      `${base}/route.png?token=secret-token`,
    ])
  })

  test('attaches nothing when neither flag is set', () => {
    expect(imageAttachments(apiBaseUrl, 'fiddur', post({}))).toEqual([])
  })
})

describe('article delivery', () => {
  const ORIGIN = 'https://aurboda.example'
  const POST_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const articleContent: ArticleContent = {
    blocks: [
      { markdown: 'I slept **better** after cutting caffeine.', type: 'prose' },
      {
        caption: 'HR',
        end: '2026-07-02T00:00:00Z',
        metric: 'heart_rate',
        start: '2026-07-01T00:00:00Z',
        type: 'chart',
      },
    ],
    title: 'Caffeine & sleep',
  }
  const deliverableArticle = (visibility: DeliverableArticle['visibility']): DeliverableArticle => ({
    article: articleContent,
    created_at: new Date('2026-07-03T00:00:00Z'),
    id: POST_ID,
    image_token: 'secret-token',
    updated_at: new Date('2026-07-04T09:00:00Z'),
    visibility,
  })

  const contextFor = () => createFeedFederation(ORIGIN, `${ORIGIN}/api`).createContext(new URL(ORIGIN))
  // An article's Note shares the standard Note object id (a post is an article OR
  // an activity, never both), so a deleted article tombstones there like any post.
  const noteId = `${ORIGIN}/users/fiddur/feed/${POST_ID}`
  // Attachments are embedded Image objects, iterated (not URL refs in attachmentIds).
  const countAttachments = async (object: Note): Promise<number> => {
    let n = 0
    for await (const _ of object.getAttachments()) n++
    return n
  }

  test('buildArticleNote is a Note with title, prose HTML, one attachment per chart block', async () => {
    const ctx = await contextFor()
    const object = buildArticleNote(ctx, 'fiddur', deliverableArticle('public'), `${ORIGIN}/api`)
    // A Note (not an AS2 Article) — Mastodon discards Article content, so a Note is
    // what renders the prose + images inline.
    expect(object).toBeInstanceOf(Note)
    expect(object.id?.href).toBe(noteId)
    expect(object.name?.toString()).toBe('Caffeine & sleep')
    expect(object.content?.toString()).toContain('<strong>better</strong>')
    // One attachment for the single chart block; its URL/token logic is asserted
    // in article-object.test.ts.
    expect(await countAttachments(object)).toBe(1)
  })

  test('a followers-only article addresses followers, never Public', async () => {
    const ctx = await contextFor()
    const object = buildArticleNote(ctx, 'fiddur', deliverableArticle('followers'), `${ORIGIN}/api`)
    expect(hrefs([...object.toIds])).toEqual([`${ORIGIN}/users/fiddur/followers`])
    expect(hrefs([...object.ccIds])).toEqual([])
  })

  test('buildArticleNoteCreate wraps the Note in a Create at the #create fragment', async () => {
    const ctx = await contextFor()
    const create = buildArticleNoteCreate(ctx, 'fiddur', deliverableArticle('public'), `${ORIGIN}/api`)
    expect(create.id?.href).toBe(`${noteId}#create`)
    expect(create.actorId?.href).toBe(`${ORIGIN}/users/fiddur`)
    const object = await create.getObject()
    expect(object).toBeInstanceOf(Note)
    expect(object?.id?.href).toBe(noteId)
  })
})

describe('buildChallengeNote / buildChallengeNoteCreate', () => {
  const ORIGIN = 'https://aurboda.example'
  const contextFor = () => createFeedFederation(ORIGIN, `${ORIGIN}/api`).createContext(new URL(ORIGIN))

  const deliverableChallenge = (
    visibility: DeliverableChallenge['visibility'],
    message: string | null = 'Join me — **daily**!',
  ): DeliverableChallenge => ({
    challenge: { name: 'August 10k', url: `${ORIGIN}/u/fiddur/august-10k` },
    created_at: new Date('2026-08-01T00:00:00Z'),
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    message,
    updated_at: new Date('2026-08-01T00:00:00Z'),
    visibility,
  })

  test('is a Note at the canonical post id with name + note + link content', async () => {
    const ctx = await contextFor()
    const post = deliverableChallenge('public')
    const note = buildChallengeNote(ctx, 'fiddur', post)

    const noteId = `${ORIGIN}/users/fiddur/feed/${post.id}`
    expect(note).toBeInstanceOf(Note)
    expect(note.id?.href).toBe(noteId)
    expect(note.name).toBe('August 10k')
    expect(note.content?.toString()).toContain('<p><strong>August 10k</strong></p>')
    expect(note.content?.toString()).toContain('<strong>daily</strong>')
    expect(note.content?.toString()).toContain(`${ORIGIN}/u/fiddur/august-10k`)
    expect(hrefs([...note.toIds])).toContain(PUBLIC)
  })

  test('the Create wraps the Note with a distinct #create id, addressed by visibility', async () => {
    const ctx = await contextFor()
    const post = deliverableChallenge('followers', null)
    const create = buildChallengeNoteCreate(ctx, 'fiddur', post)
    expect(create.id?.href).toBe(`${ORIGIN}/users/fiddur/feed/${post.id}#create`)
    expect(hrefs([...create.toIds])).toEqual([`${ORIGIN}/users/fiddur/followers`])
    expect([...create.ccIds]).toEqual([])
    const object = await create.getObject()
    expect(object).toBeInstanceOf(Note)
  })
})
