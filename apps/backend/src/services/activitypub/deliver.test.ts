import type { ArticleContent } from '@aurboda/api-spec'

import {
  Create,
  Delete,
  Hashtag,
  Image,
  Mention,
  Note,
  Person,
  PUBLIC_COLLECTION,
  Tombstone,
  Update,
} from '@fedify/fedify/vocab'
import { describe, expect, test, vi } from 'vitest'

import { CHART_HEIGHT, CHART_WIDTH } from '../charts/chart-svg.ts'
import { FIGURE_BAND_HEIGHT } from '../charts/figure-svg.ts'
import {
  buildArticleNote,
  buildArticleNoteCreate,
  buildChallengeNote,
  buildChallengeNoteCreate,
  buildDashboardNote,
  buildDashboardNoteCreate,
  buildExerciseNote,
  buildExerciseNoteCreate,
  buildFeedDelete,
  buildReplyNote,
  buildReplyNoteCreate,
  challengeImageAttachments,
  challengeMentions,
  type DeliverableArticle,
  type DeliverableChallenge,
  type DeliverableDashboard,
  type DeliverableExercise,
  type DeliverablePost,
  type DeliverableReply,
  deliverFeedArticlePost,
  deliverFeedArticleUpdate,
  deliverFeedChallengePost,
  deliverFeedChallengeUpdate,
  deliverFeedDashboardPost,
  deliverFeedDashboardUpdate,
  deliverFeedDelete,
  deliverFeedExercisePost,
  deliverFeedExerciseUpdate,
  exerciseImageAttachments,
  hasDrawableStandings,
  hasDrawableTrend,
  deliverFeedReplyPost,
  type FeedDeliveryDeps,
  imageAttachments,
  imageAvailability,
  quoteInteractionPolicy,
  recipients,
  toDeliverableDashboard,
  toDeliverableExercise,
  toDeliverableReply,
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
    include_exercises: false,
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
  const UPDATED = new Date('2026-07-02T00:00:00Z')
  const v = `v=${UPDATED.getTime()}`
  const all = { chart: true, map: true }
  const post = (overrides: Partial<DeliverablePost>): DeliverablePost => ({
    created_at: new Date('2026-07-01T00:00:00Z'),
    id: POST_ID,
    image_token: 'secret-token',
    include_chart: false,
    include_map: false,
    include_exercises: false,
    included_metrics: [],
    series_metrics: [],
    updated_at: UPDATED,
    visibility: 'public',
    ...overrides,
  })

  test('attaches only the opted-in images, at the public endpoints (no token for public)', () => {
    const chartOnly = imageAttachments(apiBaseUrl, 'fiddur', post({ include_chart: true }), all)
    expect(chartOnly.map((a) => a.url?.href)).toEqual([`${base}/chart.png?${v}`])

    const both = imageAttachments(apiBaseUrl, 'fiddur', post({ include_chart: true, include_map: true }), all)
    expect(both.map((a) => a.url?.href)).toEqual([`${base}/chart.png?${v}`, `${base}/route.png?${v}`])
  })

  test('attaches unlisted images without a token', () => {
    const atts = imageAttachments(
      apiBaseUrl,
      'fiddur',
      post({ include_chart: true, visibility: 'unlisted' }),
      all,
    )
    expect(atts.map((a) => a.url?.href)).toEqual([`${base}/chart.png?${v}`])
  })

  test('attaches followers-only images carrying the capability token (#893)', () => {
    const atts = imageAttachments(
      apiBaseUrl,
      'fiddur',
      post({ include_chart: true, include_map: true, visibility: 'followers' }),
      all,
    )
    expect(atts.map((a) => a.url?.href)).toEqual([
      `${base}/chart.png?token=secret-token&${v}`,
      `${base}/route.png?token=secret-token&${v}`,
    ])
  })

  test('the URL changes with the post version, so an Update re-downloads it', () => {
    const later = new Date(UPDATED.getTime() + 60_000)
    const atts = imageAttachments(apiBaseUrl, 'fiddur', post({ include_map: true, updated_at: later }), all)
    expect(atts.map((a) => a.url?.href)).toEqual([`${base}/route.png?v=${later.getTime()}`])
  })

  test('an opted-in image without data behind it is not attached', () => {
    const both = post({ include_chart: true, include_map: true })
    expect(imageAttachments(apiBaseUrl, 'fiddur', both, { chart: false, map: false })).toEqual([])
    expect(
      imageAttachments(apiBaseUrl, 'fiddur', both, { chart: true, map: false }).map((a) => a.url?.href),
    ).toEqual([`${base}/chart.png?${v}`])
  })

  test('attaches nothing when neither flag is set', () => {
    expect(imageAttachments(apiBaseUrl, 'fiddur', post({}), all)).toEqual([])
  })
})

describe('imageAvailability', () => {
  const start = new Date('2026-07-01T08:00:00Z')
  const end = new Date('2026-07-01T09:00:00Z')
  const activity = { activity_type: 'running', end_time: end, start_time: start }

  const lookups = (series: boolean, route: boolean) => {
    const calls: string[] = []
    return {
      calls,
      lookups: {
        hasRoute: async (_user: string, s: Date, e: Date) => {
          calls.push(`route ${s.toISOString()} ${e.toISOString()}`)
          return route
        },
        hasSeries: async (_user: string, metric: string, s: Date, e: Date) => {
          calls.push(`${metric} ${s.toISOString()} ${e.toISOString()}`)
          return series
        },
      },
    }
  }

  test('looks up heart rate and the route over the activity window', async () => {
    const l = lookups(true, false)
    const flags = { include_chart: true, include_map: true }
    expect(await imageAvailability('fiddur', flags, activity, l.lookups)).toEqual({ chart: true, map: false })
    expect(l.calls).toEqual([
      `heart_rate ${start.toISOString()} ${end.toISOString()}`,
      `route ${start.toISOString()} ${end.toISOString()}`,
    ])
  })

  test('skips the lookup for an image that is not opted in', async () => {
    const l = lookups(true, true)
    const flags = { include_chart: false, include_map: true }
    expect(await imageAvailability('fiddur', flags, activity, l.lookups)).toEqual({ chart: false, map: true })
    expect(l.calls).toHaveLength(1)
  })

  test('an open-ended activity has nothing to draw', async () => {
    const l = lookups(true, true)
    const flags = { include_chart: true, include_map: true }
    const open = { activity_type: 'running', start_time: start }
    expect(await imageAvailability('fiddur', flags, open, l.lookups)).toEqual({ chart: false, map: false })
    expect(l.calls).toEqual([])
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
    // One attachment for the single chart block; its numbering is asserted in
    // article-object.test.ts.
    expect(await countAttachments(object)).toBe(1)
  })

  test('an article attachment is its numbered figure.png, sized with the title band', async () => {
    const ctx = await contextFor()
    const object = buildArticleNote(ctx, 'fiddur', deliverableArticle('followers'), `${ORIGIN}/api`)
    const images: Image[] = []
    for await (const attachment of object.getAttachments()) images.push(attachment as Image)
    expect(images).toHaveLength(1)
    expect(images[0].name?.toString()).toBe('Figure 1: HR')
    expect(images[0].url?.href).toBe(
      `${ORIGIN}/api/public/fiddur/feed/${POST_ID}/blocks/1/figure.png?v=${new Date('2026-07-04T09:00:00Z').getTime()}&token=secret-token`,
    )
    expect(images[0].mediaType).toBe('image/png')
    expect(images[0].width).toBe(CHART_WIDTH)
    expect(images[0].height).toBe(CHART_HEIGHT + FIGURE_BAND_HEIGHT)
    expect(object.content?.toString()).toContain('<p><em>Figure 1: HR</em></p>')
  })

  test('an article Note carries `updated`, so Mastodon applies an edit (#1226)', async () => {
    const ctx = await contextFor()
    const object = buildArticleNote(ctx, 'fiddur', deliverableArticle('public'), `${ORIGIN}/api`)
    expect(object.updated?.epochMilliseconds).toBe(new Date('2026-07-04T09:00:00Z').getTime())
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
    image_token: 'tok',
    include_chart: false,
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

  test('carries `updated`, so Mastodon applies an edit (#1226)', async () => {
    const ctx = await contextFor()
    const edited = { ...deliverableChallenge('public'), updated_at: new Date('2026-08-02T10:00:00Z') }
    expect(buildChallengeNote(ctx, 'fiddur', edited).updated?.epochMilliseconds).toBe(
      edited.updated_at.getTime(),
    )
  })

  test('an invitation carries no Mention tags', async () => {
    const ctx = await contextFor()
    const note = buildChallengeNote(ctx, 'fiddur', deliverableChallenge('public'))
    expect(note.tagIds).toEqual([])
    const tags = []
    for await (const tag of note.getTags()) tags.push(tag)
    expect(tags).toEqual([])
  })

  test('a completion post tags every winner with a Mention and addresses them in cc', async () => {
    const ctx = await contextFor()
    const post: DeliverableChallenge = {
      ...deliverableChallenge('public', null),
      challenge: {
        name: 'August 10k',
        result: {
          member_count: 3,
          podium: [
            {
              display_name: 'alice',
              identity_base_url: 'https://other.example/u/alice',
              rank: 1,
              total: 300,
            },
            { display_name: 'bob', identity_base_url: `${ORIGIN}/u/bob`, rank: 1, total: 300 },
            { display_name: 'carol', identity_base_url: `${ORIGIN}/u/carol`, rank: 3, total: 10 },
          ],
          unit: 'steps',
        },
        url: `${ORIGIN}/u/fiddur/august-10k`,
      },
    }
    expect(challengeMentions(post.challenge)).toEqual([
      { actorUri: new URL('https://other.example/users/alice'), handle: '@alice@other.example' },
      { actorUri: new URL(`${ORIGIN}/users/bob`), handle: '@bob@aurboda.example' },
    ])

    const note = buildChallengeNote(ctx, 'fiddur', post)
    const mentions: { href: string | undefined; name: string | undefined }[] = []
    for await (const tag of note.getTags()) {
      expect(tag).toBeInstanceOf(Mention)
      if (tag instanceof Mention) mentions.push({ href: tag.href?.href, name: tag.name?.toString() })
    }
    expect(mentions).toEqual([
      { href: 'https://other.example/users/alice', name: '@alice@other.example' },
      { href: `${ORIGIN}/users/bob`, name: '@bob@aurboda.example' },
    ])
    // Public: to Public, cc followers + both winners (the runner-up is not addressed).
    expect(hrefs([...note.toIds])).toEqual([PUBLIC])
    expect(hrefs([...note.ccIds])).toEqual([
      `${ORIGIN}/users/fiddur/followers`,
      'https://other.example/users/alice',
      `${ORIGIN}/users/bob`,
    ])
    expect(note.content?.toString()).toContain('has finished! 🏁')
    expect(note.content?.toString()).toContain('class="u-url mention"')

    const create = buildChallengeNoteCreate(ctx, 'fiddur', post)
    expect(hrefs([...create.ccIds])).toContain('https://other.example/users/alice')
  })
})

describe('completion-post fan-out to tagged winners (#1074, #1079)', () => {
  const ORIGIN = 'https://aurboda.example'
  const WINNER_ACTOR = 'https://peer.example/users/rival'
  const completion = (): DeliverableChallenge => ({
    challenge: {
      name: 'August 10k',
      result: {
        member_count: 2,
        podium: [
          { display_name: 'rival', identity_base_url: 'https://peer.example/u/rival', rank: 1, total: 42 },
          { display_name: 'fiddur', identity_base_url: `${ORIGIN}/u/fiddur`, rank: 2, total: 10 },
        ],
        unit: 'km',
      },
      url: `${ORIGIN}/u/fiddur/august-10k`,
    },
    created_at: new Date('2026-08-01T00:00:00Z'),
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    image_token: 'tok',
    include_chart: false,
    message: null,
    updated_at: new Date('2026-08-01T00:00:00Z'),
    visibility: 'public',
  })

  const fakeDeps = async (overrides: { lookupObject?: unknown; sendActivity?: unknown } = {}) => {
    const ctx = await createFeedFederation(ORIGIN, `${ORIGIN}/api`).createContext(new URL(ORIGIN))
    const sendActivity = vi.fn().mockResolvedValue(undefined)
    const lookupObject = vi.fn().mockResolvedValue(new Person({ id: new URL(WINNER_ACTOR) }))
    const getDocumentLoader = vi.fn().mockResolvedValue(signedLoader)
    Object.assign(ctx, { getDocumentLoader, lookupObject, sendActivity, ...overrides })
    const deps: FeedDeliveryDeps = {
      apiBaseUrl: `${ORIGIN}/api`,
      federation: { createContext: async () => ctx } as unknown as FeedDeliveryDeps['federation'],
      origin: ORIGIN,
    }
    return { deps, getDocumentLoader, lookupObject, sendActivity }
  }
  const signedLoader = async () => ({ contextUrl: null, document: {}, documentUrl: '' })

  const sentTo = (sendActivity: ReturnType<typeof vi.fn>) =>
    sendActivity.mock.calls.map(([, recipient]) =>
      typeof recipient === 'string' ? recipient : recipient.id?.href,
    )

  test('the Delete of a completion post reaches followers and each tagged winner', async () => {
    const { deps, sendActivity } = await fakeDeps()
    const post = completion()
    await deliverFeedDelete(deps, 'fiddur', {
      challenge: post.challenge,
      created_at: post.created_at,
      id: post.id,
      image_token: 'tok',
      include_chart: false,
      include_map: false,
      include_exercises: false,
      included_metrics: [],
      series_metrics: [],
      updated_at: post.updated_at,
      visibility: 'public',
    })
    expect(sentTo(sendActivity).sort()).toEqual(['followers', WINNER_ACTOR])
    for (const [, , activity] of sendActivity.mock.calls) expect(activity).toBeInstanceOf(Delete)
  })

  test('a plain post’s Delete goes to followers only', async () => {
    const { deps, sendActivity, lookupObject } = await fakeDeps()
    await deliverFeedDelete(deps, 'fiddur', {
      created_at: new Date(),
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      image_token: 'tok',
      include_chart: false,
      include_map: false,
      include_exercises: false,
      included_metrics: [],
      series_metrics: [],
      updated_at: new Date(),
      visibility: 'public',
    })
    expect(sentTo(sendActivity)).toEqual(['followers'])
    expect(lookupObject).not.toHaveBeenCalled()
  })

  test('a dead follower inbox no longer cancels the winner delivery, and still surfaces', async () => {
    const sendActivity = vi.fn(async (_sender: unknown, recipient: unknown) => {
      if (recipient === 'followers') throw new Error('connect ECONNREFUSED')
    })
    const { deps } = await fakeDeps({ sendActivity })
    await expect(deliverFeedChallengePost(deps, 'fiddur', completion())).rejects.toThrow('ECONNREFUSED')
    expect(sentTo(sendActivity).sort()).toEqual(['followers', WINNER_ACTOR])
  })

  test('the winner’s actor is fetched signed as the posting user (authorized fetch)', async () => {
    const { deps, getDocumentLoader, lookupObject } = await fakeDeps()
    await deliverFeedChallengePost(deps, 'fiddur', completion())
    expect(getDocumentLoader).toHaveBeenCalledWith({ identifier: 'fiddur' })
    expect(lookupObject).toHaveBeenCalledWith(new URL(WINNER_ACTOR), { documentLoader: signedLoader })
  })

  test('an unresolvable winner is skipped with a warning instead of silently', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { deps, sendActivity } = await fakeDeps({ lookupObject: vi.fn().mockResolvedValue(null) })
    await deliverFeedChallengePost(deps, 'fiddur', completion())
    expect(sentTo(sendActivity)).toEqual(['followers'])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('actor not resolvable'))
    warn.mockRestore()
  })

  const attachedUrls = async (activity: unknown): Promise<(string | undefined)[]> => {
    const note = await (activity as Create | Update).getObject()
    const urls: (string | undefined)[] = []
    if (note instanceof Note) {
      for await (const attachment of note.getAttachments()) {
        expect(attachment).toBeInstanceOf(Image)
        if (attachment instanceof Image) {
          expect(attachment.name?.toString()).toBe('Standings')
          urls.push(attachment.url instanceof URL ? attachment.url.href : undefined)
        }
      }
    }
    return urls
  }
  const base = `${ORIGIN}/api/public/fiddur/feed/dddddddd-dddd-4ddd-8ddd-dddddddddddd/standings.png`

  test('an opted-in post with drawable standings carries the Standings attachment', async () => {
    const { deps, sendActivity } = await fakeDeps()
    const post = { ...completion(), include_chart: true }
    const hasStandings = vi.fn(async () => true)
    await deliverFeedChallengePost(deps, 'fiddur', post, hasStandings)
    expect(hasStandings).toHaveBeenCalledWith('fiddur', post)
    const [, , create] = sendActivity.mock.calls[0]
    expect(create).toBeInstanceOf(Create)
    expect(await attachedUrls(create)).toEqual([`${base}?v=${post.updated_at.getTime()}`])
  })

  test('a followers-only post’s attachment carries the token; an Update re-sends it with the new v', async () => {
    const { deps, sendActivity } = await fakeDeps()
    const edited = new Date('2026-08-03T00:00:00Z')
    const post = {
      ...completion(),
      include_chart: true,
      updated_at: edited,
      visibility: 'followers' as const,
    }
    await deliverFeedChallengeUpdate(deps, 'fiddur', post, async () => true)
    const [, , update] = sendActivity.mock.calls[0]
    expect(update).toBeInstanceOf(Update)
    expect(await attachedUrls(update)).toEqual([`${base}?token=tok&v=${edited.getTime()}`])
  })

  test('no attachment without standings to draw, or without the opt-in', async () => {
    const unavailable = await fakeDeps()
    await deliverFeedChallengePost(
      unavailable.deps,
      'fiddur',
      { ...completion(), include_chart: true },
      async () => false,
    )
    expect(await attachedUrls(unavailable.sendActivity.mock.calls[0][2])).toEqual([])

    const optedOut = await fakeDeps()
    const hasStandings = vi.fn(async () => true)
    await deliverFeedChallengePost(optedOut.deps, 'fiddur', completion(), hasStandings)
    expect(hasStandings).not.toHaveBeenCalled()
    expect(await attachedUrls(optedOut.sendActivity.mock.calls[0][2])).toEqual([])
  })
})

describe('challengeImageAttachments', () => {
  const post = {
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    image_token: 'tok',
    include_chart: true,
    updated_at: new Date('2026-08-01T00:00:00Z'),
    visibility: 'unlisted' as const,
  }

  test('a 1000x420 PNG at the standings endpoint, without a token for an unlisted post', () => {
    const [image] = challengeImageAttachments('https://aurboda.example/api/', 'fiddur', post, true)
    expect(image.url).toEqual(
      new URL(
        `https://aurboda.example/api/public/fiddur/feed/${post.id}/standings.png?v=${post.updated_at.getTime()}`,
      ),
    )
    expect([image.width, image.height, image.mediaType]).toEqual([1000, 420, 'image/png'])
  })

  test('nothing when unavailable or not opted in', () => {
    expect(challengeImageAttachments('https://a.example/api', 'fiddur', post, false)).toEqual([])
    expect(
      challengeImageAttachments('https://a.example/api', 'fiddur', { ...post, include_chart: false }, true),
    ).toEqual([])
  })

  test('hasDrawableStandings is false without the opt-in or an unconfigured resolver', async () => {
    const challenge = {
      challenge: { name: 'x', url: 'https://aurboda.example/u/fiddur/x' },
      created_at: new Date(),
      id: post.id,
      image_token: 'tok',
      message: null,
      updated_at: new Date(),
      visibility: 'public' as const,
    }
    expect(await hasDrawableStandings('fiddur', { ...challenge, include_chart: false })).toBe(false)
    expect(await hasDrawableStandings('fiddur', { ...challenge, include_chart: true })).toBe(false)
  })
})

describe('buildReplyNote / buildReplyNoteCreate', () => {
  const ORIGIN = 'https://aurboda.example'
  const TARGET = 'https://mastodon.example/users/alice/statuses/9'
  const TARGET_ACTOR = 'https://mastodon.example/users/alice'
  const contextFor = () => createFeedFederation(ORIGIN, `${ORIGIN}/api`).createContext(new URL(ORIGIN))

  const deliverableReply = (
    visibility: DeliverableReply['visibility'] = 'unlisted',
    over: Partial<DeliverableReply> = {},
  ): DeliverableReply => ({
    created_at: new Date('2026-09-01T00:00:00Z'),
    id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    in_reply_to_actor_uri: TARGET_ACTOR,
    in_reply_to_handle: '@alice@mastodon.example',
    in_reply_to_uri: TARGET,
    message: 'Nice **run**!',
    updated_at: new Date('2026-09-01T00:00:00Z'),
    visibility,
    ...over,
  })

  test('is a Note at the canonical post id, inReplyTo the target, mention + prose content', async () => {
    const ctx = await contextFor()
    const post = deliverableReply()
    const note = buildReplyNote(ctx, 'fiddur', post)

    const noteId = `${ORIGIN}/users/fiddur/feed/${post.id}`
    expect(note).toBeInstanceOf(Note)
    expect(note.id?.href).toBe(noteId)
    expect(note.url?.href).toBe(noteId)
    expect(hrefs([...note.replyTargetIds])).toEqual([TARGET])
    const content = note.content?.toString() ?? ''
    expect(content).toContain(`<a href="${TARGET_ACTOR}" class="u-url mention">@alice@mastodon.example</a>`)
    expect(content).toContain('<strong>run</strong>')
    // Unlisted: followers in `to`, Public in `cc` — plus the mentioned author.
    expect(hrefs([...note.toIds])).toEqual([`${ORIGIN}/users/fiddur/followers`])
    expect(hrefs([...note.ccIds])).toContain(TARGET_ACTOR)
  })

  test('carries `updated`, so Mastodon applies an edit (#1226)', async () => {
    const ctx = await contextFor()
    const edited = deliverableReply('unlisted', { updated_at: new Date('2026-09-02T10:00:00Z') })
    expect(buildReplyNote(ctx, 'fiddur', edited).updated?.epochMilliseconds).toBe(edited.updated_at.getTime())
  })

  test('tags the replied-to author with a Mention naming their handle', async () => {
    const ctx = await contextFor()
    const note = buildReplyNote(ctx, 'fiddur', deliverableReply())
    const tags = []
    for await (const tag of note.getTags()) tags.push(tag)
    expect(tags).toHaveLength(1)
    const mention = tags[0]
    expect(mention).toBeInstanceOf(Mention)
    expect(mention instanceof Mention ? mention.href?.href : null).toBe(TARGET_ACTOR)
    expect(mention instanceof Mention ? mention.name?.toString() : null).toBe('@alice@mastodon.example')
  })

  test('falls back to a handle derived from the actor URI when none was snapshotted', async () => {
    const ctx = await contextFor()
    const note = buildReplyNote(ctx, 'fiddur', deliverableReply('unlisted', { in_reply_to_handle: null }))
    expect(note.content?.toString()).toContain('@alice@mastodon.example')
  })

  test('the Create wraps the Note with a distinct #create id and cc’s the author', async () => {
    const ctx = await contextFor()
    const post = deliverableReply('public')
    const create = buildReplyNoteCreate(ctx, 'fiddur', post)
    expect(create.id?.href).toBe(`${ORIGIN}/users/fiddur/feed/${post.id}#create`)
    expect(hrefs([...create.toIds])).toContain(PUBLIC)
    expect(hrefs([...create.ccIds])).toContain(TARGET_ACTOR)
    const object = await create.getObject()
    expect(object).toBeInstanceOf(Note)
  })

  test('a followers-only reply never addresses Public, but still reaches the author', async () => {
    const ctx = await contextFor()
    const note = buildReplyNote(ctx, 'fiddur', deliverableReply('followers'))
    expect(hrefs([...note.toIds])).not.toContain(PUBLIC)
    expect(hrefs([...note.ccIds])).toEqual([TARGET_ACTOR])
  })

  test('toDeliverableReply narrows only a reply post with a resolved target', () => {
    const base = {
      activity_id: null,
      article: null,
      autoshare_rule_id: null,
      challenge: null,
      dashboard: null,
      exercise: null,
      created_at: new Date(),
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      image_token: 'tok',
      include_chart: false,
      include_map: false,
      include_exercises: false,
      included_metrics: [],
      in_reply_to_actor_uri: TARGET_ACTOR,
      in_reply_to_handle: '@alice@mastodon.example',
      in_reply_to_uri: TARGET,
      message: 'hi',
      series_metrics: [],
      tags: [],
      updated_at: new Date(),
      visibility: 'unlisted' as const,
    }
    expect(toDeliverableReply({ ...base, kind: 'reply' })?.in_reply_to_uri).toBe(TARGET)
    expect(toDeliverableReply({ ...base, kind: 'activity' })).toBeNull()
    expect(toDeliverableReply({ ...base, in_reply_to_uri: null, kind: 'reply' })).toBeNull()
  })
})

describe('reply fan-out to the answered author (#1079 shape)', () => {
  const ORIGIN = 'https://aurboda.example'
  const TARGET_ACTOR = 'https://mastodon.example/users/alice'
  const reply = (): DeliverableReply => ({
    created_at: new Date('2026-09-01T00:00:00Z'),
    id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    in_reply_to_actor_uri: TARGET_ACTOR,
    in_reply_to_handle: '@alice@mastodon.example',
    in_reply_to_uri: 'https://mastodon.example/users/alice/statuses/9',
    message: 'hi',
    updated_at: new Date('2026-09-01T00:00:00Z'),
    visibility: 'unlisted',
  })

  const fakeDeps = async (overrides: { lookupObject?: unknown; sendActivity?: unknown } = {}) => {
    const ctx = await createFeedFederation(ORIGIN, `${ORIGIN}/api`).createContext(new URL(ORIGIN))
    const sendActivity = vi.fn().mockResolvedValue(undefined)
    const lookupObject = vi.fn().mockResolvedValue(new Person({ id: new URL(TARGET_ACTOR) }))
    Object.assign(ctx, { lookupObject, sendActivity, ...overrides })
    const deps: FeedDeliveryDeps = {
      apiBaseUrl: `${ORIGIN}/api`,
      federation: { createContext: async () => ctx } as unknown as FeedDeliveryDeps['federation'],
      origin: ORIGIN,
    }
    return { deps, lookupObject, sendActivity }
  }

  const sentTo = (sendActivity: ReturnType<typeof vi.fn>) =>
    sendActivity.mock.calls.map(([, recipient]) =>
      typeof recipient === 'string' ? recipient : recipient.id?.href,
    )

  test('the Create reaches followers AND the author’s own inbox', async () => {
    const { deps, sendActivity } = await fakeDeps()
    await deliverFeedReplyPost(deps, 'fiddur', reply())
    expect(sentTo(sendActivity).sort()).toEqual(['followers', TARGET_ACTOR])
  })

  test('a dead follower inbox no longer cancels the author delivery, and still surfaces', async () => {
    const sendActivity = vi.fn(async (_sender: unknown, recipient: unknown) => {
      if (recipient === 'followers') throw new Error('connect ECONNREFUSED')
    })
    const { deps } = await fakeDeps({ sendActivity })
    await expect(deliverFeedReplyPost(deps, 'fiddur', reply())).rejects.toThrow('ECONNREFUSED')
    expect(sentTo(sendActivity).sort()).toEqual(['followers', TARGET_ACTOR])
  })

  test('the Delete of a reply is retracted from the author too', async () => {
    const { deps, sendActivity } = await fakeDeps()
    const post = reply()
    await deliverFeedDelete(deps, 'fiddur', {
      created_at: post.created_at,
      id: post.id,
      image_token: 'tok',
      in_reply_to_actor_uri: post.in_reply_to_actor_uri,
      in_reply_to_handle: post.in_reply_to_handle,
      include_chart: false,
      include_map: false,
      include_exercises: false,
      included_metrics: [],
      series_metrics: [],
      updated_at: post.updated_at,
      visibility: 'unlisted',
    })
    expect(sentTo(sendActivity).sort()).toEqual(['followers', TARGET_ACTOR])
    for (const [, , activity] of sendActivity.mock.calls) expect(activity).toBeInstanceOf(Delete)
  })
})

describe('exercise shares (#1398)', () => {
  const ORIGIN = 'https://aurboda.example'
  const contextFor = () => createFeedFederation(ORIGIN, `${ORIGIN}/api`).createContext(new URL(ORIGIN))
  const CONTENT = '<p><strong>Bench Press</strong> · Strength training</p>'

  const deliverableExercise = (over: Partial<DeliverableExercise> = {}): DeliverableExercise => ({
    created_at: new Date('2026-11-01T00:00:00Z'),
    exercise: {
      activity_type: 'strength_training',
      field: 'sets.exercise',
      include_records: true,
      include_sessions: false,
      name: 'Bench Press',
      value: 'Bench Press',
    },
    id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    image_token: 'tok',
    include_chart: true,
    message: null,
    updated_at: new Date('2026-11-01T00:00:00Z'),
    visibility: 'public',
    ...over,
  })

  test('toDeliverableExercise narrows only an exercise post with its pointer', () => {
    const record = {
      activity_id: null,
      article: null,
      autoshare_rule_id: null,
      challenge: null,
      created_at: new Date(),
      dashboard: null,
      exercise: deliverableExercise().exercise,
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      image_token: 'tok',
      in_reply_to_actor_uri: null,
      in_reply_to_handle: null,
      in_reply_to_uri: null,
      include_chart: false,
      include_exercises: false,
      include_map: false,
      included_metrics: [],
      kind: 'exercise' as const,
      message: 'PR!',
      series_metrics: [],
      tags: [],
      updated_at: new Date(),
      visibility: 'public' as const,
    }
    expect(toDeliverableExercise(record)).toMatchObject({ exercise: record.exercise, message: 'PR!' })
    expect(toDeliverableExercise({ ...record, exercise: null })).toBeNull()
    expect(toDeliverableExercise({ ...record, kind: 'challenge' })).toBeNull()
  })

  test('the Note is at the canonical post id with the given content, addressed by visibility', async () => {
    const ctx = await contextFor()
    const post = deliverableExercise()
    const note = buildExerciseNote(ctx, 'fiddur', post, CONTENT)
    const noteId = `${ORIGIN}/users/fiddur/feed/${post.id}`
    expect(note).toBeInstanceOf(Note)
    expect(note.id?.href).toBe(noteId)
    expect(note.name?.toString()).toBe('Bench Press')
    expect(note.content?.toString()).toBe(CONTENT)
    expect(hrefs([...note.toIds])).toEqual([PUBLIC])
    expect(note.tagIds).toEqual([])
  })

  test('the Create wraps the Note with a #create id; followers-only never addresses Public', async () => {
    const ctx = await contextFor()
    const post = deliverableExercise({ visibility: 'followers' })
    const create = buildExerciseNoteCreate(ctx, 'fiddur', post, CONTENT)
    expect(create.id?.href).toBe(`${ORIGIN}/users/fiddur/feed/${post.id}#create`)
    expect(hrefs([...create.toIds])).toEqual([`${ORIGIN}/users/fiddur/followers`])
    expect([...create.ccIds]).toEqual([])
    expect(await create.getObject()).toBeInstanceOf(Note)
  })

  test('exerciseImageAttachments: a Trend PNG, token only for followers-only, nothing unavailable', () => {
    const post = deliverableExercise({ visibility: 'unlisted' })
    const base = `${ORIGIN}/api/public/fiddur/feed/${post.id}/trend.png`
    const [image] = exerciseImageAttachments(`${ORIGIN}/api/`, 'fiddur', post, true)
    expect(image.url).toEqual(new URL(`${base}?v=${post.updated_at.getTime()}`))
    expect(image.name?.toString()).toBe('Trend')
    expect([image.width, image.height, image.mediaType]).toEqual([1000, 420, 'image/png'])

    const [followersImage] = exerciseImageAttachments(
      `${ORIGIN}/api`,
      'fiddur',
      { ...post, visibility: 'followers' },
      true,
    )
    expect(followersImage.url).toEqual(new URL(`${base}?token=tok&v=${post.updated_at.getTime()}`))
    expect(exerciseImageAttachments(`${ORIGIN}/api`, 'fiddur', post, false)).toEqual([])
    expect(
      exerciseImageAttachments(`${ORIGIN}/api`, 'fiddur', { ...post, include_chart: false }, true),
    ).toEqual([])
  })

  test('hasDrawableTrend is false without the opt-in', async () => {
    expect(await hasDrawableTrend('fiddur', deliverableExercise({ include_chart: false }))).toBe(false)
  })

  const fakeDeps = async () => {
    const ctx = await contextFor()
    const sendActivity = vi.fn().mockResolvedValue(undefined)
    Object.assign(ctx, { sendActivity })
    const deps: FeedDeliveryDeps = {
      apiBaseUrl: `${ORIGIN}/api`,
      federation: { createContext: async () => ctx } as unknown as FeedDeliveryDeps['federation'],
      origin: ORIGIN,
    }
    return { deps, sendActivity }
  }

  const attachedNames = async (activity: Create | Update): Promise<(string | undefined)[]> => {
    const note = await activity.getObject()
    const names: (string | undefined)[] = []
    if (note instanceof Note) {
      for await (const attachment of note.getAttachments()) {
        if (attachment instanceof Image) names.push(attachment.name?.toString())
      }
    }
    return names
  }

  test('a Create goes to followers only, with the resolved content and the Trend attachment', async () => {
    const { deps, sendActivity } = await fakeDeps()
    const post = deliverableExercise()
    const content = vi.fn(async () => CONTENT)
    const hasTrend = vi.fn(async () => true)
    await deliverFeedExercisePost(deps, 'fiddur', post, { content, hasTrend })
    expect(content).toHaveBeenCalledWith('fiddur', post)
    expect(sendActivity).toHaveBeenCalledTimes(1)
    const [, recipient, create] = sendActivity.mock.calls[0]
    expect(recipient).toBe('followers')
    expect(create).toBeInstanceOf(Create)
    const note = await create.getObject()
    expect(note.content?.toString()).toBe(CONTENT)
    expect(await attachedNames(create)).toEqual(['Trend'])
  })

  test('an Update without a drawable trend or the opt-in carries no attachment', async () => {
    const unavailable = await fakeDeps()
    await deliverFeedExerciseUpdate(unavailable.deps, 'fiddur', deliverableExercise(), {
      content: async () => CONTENT,
      hasTrend: async () => false,
    })
    const [, , update] = unavailable.sendActivity.mock.calls[0]
    expect(update).toBeInstanceOf(Update)
    expect(await attachedNames(update)).toEqual([])

    const optedOut = await fakeDeps()
    const hasTrend = vi.fn(async () => true)
    await deliverFeedExerciseUpdate(optedOut.deps, 'fiddur', deliverableExercise({ include_chart: false }), {
      content: async () => CONTENT,
      hasTrend,
    })
    expect(hasTrend).not.toHaveBeenCalled()
    expect(await attachedNames(optedOut.sendActivity.mock.calls[0][2])).toEqual([])
  })
})

describe('dashboard-period shares (#1505)', () => {
  const ORIGIN = 'https://aurboda.example'
  const contextFor = () => createFeedFederation(ORIGIN, `${ORIGIN}/api`).createContext(new URL(ORIGIN))
  const CONTENT = '<p><strong>Month in data</strong> · October 2026</p>'

  const deliverableDashboard = (over: Partial<DeliverableDashboard> = {}): DeliverableDashboard => ({
    created_at: new Date('2026-11-01T00:00:00Z'),
    dashboard: {
      config: { period: { granularity: 'month' }, sections: [], version: 1 },
      include_link: false,
      name: 'Month in data',
      period: '2026-10',
    },
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    message: null,
    updated_at: new Date('2026-11-01T00:00:00Z'),
    visibility: 'public',
    ...over,
  })

  test('toDeliverableDashboard narrows only a dashboard post with its payload', () => {
    const record = {
      activity_id: null,
      article: null,
      autoshare_rule_id: null,
      challenge: null,
      created_at: new Date(),
      dashboard: deliverableDashboard().dashboard,
      exercise: null,
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      image_token: 'tok',
      in_reply_to_actor_uri: null,
      in_reply_to_handle: null,
      in_reply_to_uri: null,
      include_chart: false,
      include_exercises: false,
      include_map: false,
      included_metrics: [],
      kind: 'dashboard' as const,
      message: 'October',
      series_metrics: [],
      tags: ['monthindata'],
      updated_at: new Date(),
      visibility: 'public' as const,
    }
    expect(toDeliverableDashboard(record)).toMatchObject({
      dashboard: record.dashboard,
      message: 'October',
      tags: ['monthindata'],
    })
    expect(toDeliverableDashboard({ ...record, dashboard: null })).toBeNull()
    expect(toDeliverableDashboard({ ...record, kind: 'exercise' })).toBeNull()
    expect(toDeliverableExercise(record)).toBeNull()
  })

  test('the Note is at the canonical post id, named by the dashboard, addressed by visibility', async () => {
    const ctx = await contextFor()
    const post = deliverableDashboard()
    const note = buildDashboardNote(ctx, 'fiddur', post, CONTENT)
    expect(note).toBeInstanceOf(Note)
    expect(note.id?.href).toBe(`${ORIGIN}/users/fiddur/feed/${post.id}`)
    expect(note.name?.toString()).toBe('Month in data')
    expect(note.content?.toString()).toBe(CONTENT)
    expect(hrefs([...note.toIds])).toEqual([PUBLIC])
    expect(note.attachmentIds).toEqual([])
  })

  test('the Create wraps the Note with a #create id; followers-only never addresses Public', async () => {
    const ctx = await contextFor()
    const post = deliverableDashboard({ visibility: 'followers' })
    const create = buildDashboardNoteCreate(ctx, 'fiddur', post, CONTENT)
    expect(create.id?.href).toBe(`${ORIGIN}/users/fiddur/feed/${post.id}#create`)
    expect(hrefs([...create.toIds])).toEqual([`${ORIGIN}/users/fiddur/followers`])
    expect([...create.ccIds]).toEqual([])
    expect(await create.getObject()).toBeInstanceOf(Note)
  })

  test('the Note links its hashtags', async () => {
    const ctx = await contextFor()
    const note = buildDashboardNote(ctx, 'fiddur', deliverableDashboard({ tags: ['monthindata'] }), CONTENT)
    const tags: string[] = []
    for await (const tag of note.getTags()) if (tag instanceof Hashtag) tags.push(tag.name?.toString() ?? '')
    expect(tags).toEqual(['#monthindata'])
    expect(note.content?.toString()).toContain('monthindata')
  })

  const fakeDeps = async () => {
    const ctx = await contextFor()
    const sendActivity = vi.fn().mockResolvedValue(undefined)
    Object.assign(ctx, { sendActivity })
    const deps: FeedDeliveryDeps = {
      apiBaseUrl: `${ORIGIN}/api`,
      federation: { createContext: async () => ctx } as unknown as FeedDeliveryDeps['federation'],
      origin: ORIGIN,
    }
    return { deps, sendActivity }
  }

  test('a Create and an Update go to followers only, with the resolved content', async () => {
    const { deps, sendActivity } = await fakeDeps()
    const post = deliverableDashboard()
    const content = vi.fn(async () => CONTENT)
    await deliverFeedDashboardPost(deps, 'fiddur', post, content)
    await deliverFeedDashboardUpdate(deps, 'fiddur', post, content)
    expect(content).toHaveBeenCalledWith('fiddur', post)
    const [[, toCreate, create], [, toUpdate, update]] = sendActivity.mock.calls
    expect([toCreate, toUpdate]).toEqual(['followers', 'followers'])
    expect(create).toBeInstanceOf(Create)
    expect(update).toBeInstanceOf(Update)
    expect((await create.getObject()).content?.toString()).toBe(CONTENT)
  })
})

describe('hashtags on every Note kind', () => {
  const ORIGIN = 'https://aurboda.example'
  const contextFor = () => createFeedFederation(ORIGIN, `${ORIGIN}/api`).createContext(new URL(ORIGIN))
  const base = {
    created_at: new Date('2026-11-01T00:00:00Z'),
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    image_token: 'tok',
    tags: ['aurboda', 'running'],
    updated_at: new Date('2026-11-01T00:00:00Z'),
    visibility: 'public' as const,
  }
  const tagsOf = async (note: Note) => {
    const out: { kind: string; href: string | undefined; name: string | undefined }[] = []
    for await (const tag of note.getTags()) {
      if (tag instanceof Hashtag) {
        out.push({ href: tag.href?.href, kind: 'hashtag', name: tag.name?.toString() })
      }
      if (tag instanceof Mention) {
        out.push({ href: tag.href?.href, kind: 'mention', name: tag.name?.toString() })
      }
    }
    return out
  }
  const hashtags = [
    { href: `${ORIGIN}/u/fiddur?tag=aurboda`, kind: 'hashtag', name: '#aurboda' },
    { href: `${ORIGIN}/u/fiddur?tag=running`, kind: 'hashtag', name: '#running' },
  ]
  const tagLink = (tag: string, text = tag) =>
    `<a href="${ORIGIN}/u/fiddur?tag=${tag}" class="mention hashtag" rel="tag">#<span>${text}</span></a>`

  test('an article Note links typed tags in its prose and lists the rest', async () => {
    const ctx = await contextFor()
    const note = buildArticleNote(
      ctx,
      'fiddur',
      { ...base, article: { blocks: [{ markdown: 'A #Running log', type: 'prose' }], title: 'Log' } },
      `${ORIGIN}/api`,
    )
    expect(await tagsOf(note)).toEqual(hashtags)
    const content = note.content?.toString() ?? ''
    expect(content).toContain(`A ${tagLink('running', 'Running')} log`)
    expect(content).toContain(`<p>${tagLink('aurboda')}</p>`)
  })

  test('a challenge Note keeps its winner Mentions beside the Hashtags', async () => {
    const ctx = await contextFor()
    const note = buildChallengeNote(ctx, 'fiddur', {
      ...base,
      challenge: {
        name: 'August 10k',
        result: {
          member_count: 1,
          podium: [{ display_name: 'bob', identity_base_url: `${ORIGIN}/u/bob`, rank: 1, total: 3 }],
          unit: 'steps',
        },
        url: `${ORIGIN}/u/fiddur/august-10k`,
      },
      include_chart: false,
      message: null,
    })
    expect(await tagsOf(note)).toEqual([
      { href: `${ORIGIN}/users/bob`, kind: 'mention', name: '@bob@aurboda.example' },
      ...hashtags,
    ])
    expect(note.content?.toString()).toContain(`<p>${tagLink('aurboda')} ${tagLink('running')}</p>`)
  })

  test('an exercise Note links the tags in its pre-rendered content', async () => {
    const ctx = await contextFor()
    const note = buildExerciseNote(
      ctx,
      'fiddur',
      {
        ...base,
        exercise: {
          activity_type: 'strength_training',
          field: 'sets.exercise',
          include_records: true,
          include_sessions: false,
          name: 'Bench Press',
          value: 'Bench Press',
        },
        include_chart: false,
        message: null,
      },
      '<p>Bench #running</p>',
    )
    expect(await tagsOf(note)).toEqual(hashtags)
    expect(note.content?.toString()).toBe(`<p>Bench ${tagLink('running')}</p><p>${tagLink('aurboda')}</p>`)
  })

  test('a reply Note keeps its Mention and adds only its own (typed) tags', async () => {
    const ctx = await contextFor()
    const note = buildReplyNote(ctx, 'fiddur', {
      ...base,
      in_reply_to_actor_uri: 'https://mastodon.example/users/alice',
      in_reply_to_handle: '@alice@mastodon.example',
      in_reply_to_uri: 'https://mastodon.example/users/alice/statuses/9',
      message: 'Nice #running',
      tags: ['running'],
    })
    expect(await tagsOf(note)).toEqual([
      { href: 'https://mastodon.example/users/alice', kind: 'mention', name: '@alice@mastodon.example' },
      hashtags[1],
    ])
    expect(note.content?.toString()).toContain(`Nice ${tagLink('running')}`)
    expect(note.content?.toString()).not.toContain('tag=aurboda')
  })

  test('a post without tags carries no Hashtag and no trailing line', async () => {
    const ctx = await contextFor()
    const note = buildExerciseNote(
      ctx,
      'fiddur',
      {
        ...base,
        exercise: {
          activity_type: 'strength_training',
          field: 'sets.exercise',
          include_records: true,
          include_sessions: false,
          name: 'Bench Press',
          value: 'Bench Press',
        },
        include_chart: false,
        message: null,
        tags: [],
      },
      '<p>Bench</p>',
    )
    expect(await tagsOf(note)).toEqual([])
    expect(note.content?.toString()).toBe('<p>Bench</p>')
  })
})

describe('quote policy on every Note kind (FEP-044f)', () => {
  const ORIGIN = 'https://aurboda.example'
  const ACTOR = `${ORIGIN}/users/fiddur`
  const contextFor = () => createFeedFederation(ORIGIN, `${ORIGIN}/api`).createContext(new URL(ORIGIN))
  const base = {
    created_at: new Date('2026-11-01T00:00:00Z'),
    id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    image_token: 'tok',
    updated_at: new Date('2026-11-01T00:00:00Z'),
  }
  type Visibility = DeliverablePost['visibility']
  const exercise = {
    activity_type: 'strength_training',
    field: 'sets.exercise',
    include_records: true,
    include_sessions: false,
    name: 'Bench Press',
    value: 'Bench Press',
  }
  const builders: Record<
    string,
    (ctx: Awaited<ReturnType<typeof contextFor>>, visibility: Visibility) => Note
  > = {
    article: (ctx, visibility) =>
      buildArticleNote(
        ctx,
        'fiddur',
        { ...base, article: { blocks: [{ markdown: 'Hi', type: 'prose' }], title: 'Log' }, visibility },
        `${ORIGIN}/api`,
      ),
    challenge: (ctx, visibility) =>
      buildChallengeNote(ctx, 'fiddur', {
        ...base,
        challenge: { name: 'August 10k', url: `${ORIGIN}/u/fiddur/august-10k` },
        include_chart: false,
        message: null,
        visibility,
      }),
    dashboard: (ctx, visibility) =>
      buildDashboardNote(
        ctx,
        'fiddur',
        {
          ...base,
          dashboard: {
            config: { period: { granularity: 'month' }, sections: [], version: 1 },
            include_link: false,
            name: 'Month in data',
            period: '2026-10',
          },
          message: null,
          visibility,
        },
        '<p>Month</p>',
      ),
    exercise: (ctx, visibility) =>
      buildExerciseNote(
        ctx,
        'fiddur',
        { ...base, exercise, include_chart: false, message: null, visibility },
        '<p>Bench</p>',
      ),
    reply: (ctx, visibility) =>
      buildReplyNote(ctx, 'fiddur', {
        ...base,
        in_reply_to_actor_uri: 'https://mastodon.example/users/alice',
        in_reply_to_handle: '@alice@mastodon.example',
        in_reply_to_uri: 'https://mastodon.example/users/alice/statuses/9',
        message: 'Nice',
        visibility,
      }),
  }
  const approvals = (note: Note) => hrefs(note.interactionPolicy?.canQuote?.automaticApprovals ?? [])

  test.each(Object.keys(builders))('a %s Note lets anyone quote a public or unlisted post', async (kind) => {
    const ctx = await contextFor()
    expect(approvals(builders[kind](ctx, 'public'))).toEqual([PUBLIC_COLLECTION.href])
    expect(approvals(builders[kind](ctx, 'unlisted'))).toEqual([PUBLIC_COLLECTION.href])
  })

  test.each(Object.keys(builders))(
    'a %s Note lets only its author quote a followers-only post',
    async (kind) => {
      const ctx = await contextFor()
      expect(approvals(builders[kind](ctx, 'followers'))).toEqual([ACTOR])
    },
  )

  test('serializes as the compact canQuote.automaticApproval Mastodon reads', async () => {
    const ctx = await contextFor()
    const json = (await builders.exercise(ctx, 'public').toJsonLd({ format: 'compact' })) as {
      interactionPolicy?: { canQuote?: { automaticApproval?: unknown } }
    }
    expect(json.interactionPolicy?.canQuote?.automaticApproval).toBe('as:Public')
  })

  test('the policy builder maps visibility to Public or the author', () => {
    const actor = new URL(ACTOR)
    const of = (v: Visibility) => hrefs(quoteInteractionPolicy(v, actor).canQuote?.automaticApprovals ?? [])
    expect(of('public')).toEqual([PUBLIC_COLLECTION.href])
    expect(of('unlisted')).toEqual([PUBLIC_COLLECTION.href])
    expect(of('followers')).toEqual([ACTOR])
  })
})

describe('relay push of public posts (#1541)', () => {
  const ORIGIN = 'https://aurboda.example'
  const RELAY = {
    id: new URL('https://relay.example/actor'),
    inboxId: new URL('https://relay.example/inbox'),
  }
  const OTHER_RELAY = {
    id: new URL('https://tags.example/user/_____relay_____/inbox'),
    inboxId: new URL('https://tags.example/user/_____relay_____/inbox'),
  }

  const fakeDeps = async (
    overrides: {
      sendActivity?: unknown
      listRelayRecipients?: FeedDeliveryDeps['listRelayRecipients'] | null
    } = {},
  ) => {
    const ctx = await createFeedFederation(ORIGIN, `${ORIGIN}/api`).createContext(new URL(ORIGIN))
    const sendActivity =
      (overrides.sendActivity as ReturnType<typeof vi.fn>) ?? vi.fn().mockResolvedValue(undefined)
    Object.assign(ctx, { sendActivity })
    const deps: FeedDeliveryDeps = {
      apiBaseUrl: `${ORIGIN}/api`,
      federation: { createContext: async () => ctx } as unknown as FeedDeliveryDeps['federation'],
      origin: ORIGIN,
      ...(overrides.listRelayRecipients === null
        ? {}
        : { listRelayRecipients: overrides.listRelayRecipients ?? (async () => [RELAY, OTHER_RELAY]) }),
    }
    return { deps, sendActivity }
  }

  const sentTo = (sendActivity: ReturnType<typeof vi.fn>) =>
    sendActivity.mock.calls.map(([, recipient]) =>
      typeof recipient === 'string' ? recipient : recipient.inboxId?.href,
    )

  const article = (visibility: DeliverableArticle['visibility']): DeliverableArticle => ({
    article: { blocks: [{ markdown: 'Hello', type: 'prose' }], title: 'Hi' },
    created_at: new Date('2026-07-03T00:00:00Z'),
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    image_token: 'tok',
    updated_at: new Date('2026-07-04T00:00:00Z'),
    visibility,
  })

  const plainPost = (
    visibility: DeliverablePost['visibility'],
    extra: { in_reply_to_actor_uri?: string; kind?: 'activity' | 'reply' } = {},
  ): Parameters<typeof deliverFeedDelete>[2] => ({
    created_at: new Date(),
    id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    image_token: 'tok',
    include_chart: false,
    include_exercises: false,
    include_map: false,
    included_metrics: [],
    series_metrics: [],
    updated_at: new Date(),
    visibility,
    ...extra,
  })

  test('a public post goes to followers and to every accepted relay, signed by its author', async () => {
    const { deps, sendActivity } = await fakeDeps()
    await deliverFeedArticlePost(deps, 'fiddur', article('public'))
    expect(sentTo(sendActivity).sort()).toEqual(
      ['followers', RELAY.inboxId.href, OTHER_RELAY.inboxId.href].sort(),
    )
    for (const [sender, , activity] of sendActivity.mock.calls) {
      expect(sender).toEqual({ identifier: 'fiddur' })
      expect(activity).toBeInstanceOf(Create)
    }
  })

  test('the Delete of a public post reaches the relays too', async () => {
    const { deps, sendActivity } = await fakeDeps()
    await deliverFeedDelete(deps, 'fiddur', plainPost('public'))
    expect(sentTo(sendActivity)).toHaveLength(3)
  })

  test.each(['unlisted', 'followers'] as const)('a %s post is not pushed to relays', async (visibility) => {
    const listRelayRecipients = vi.fn(async () => [RELAY])
    const { deps, sendActivity } = await fakeDeps({ listRelayRecipients })
    await deliverFeedArticlePost(deps, 'fiddur', article(visibility))
    expect(sentTo(sendActivity)).toEqual(['followers'])
    expect(listRelayRecipients).not.toHaveBeenCalled()
  })

  test.each(['unlisted', 'followers'] as const)(
    'the Delete of a %s post still reaches the relays (it may have been public once)',
    async (visibility) => {
      const { deps, sendActivity } = await fakeDeps()
      await deliverFeedDelete(deps, 'fiddur', plainPost(visibility, { kind: 'activity' }))
      expect(sentTo(sendActivity).sort()).toEqual(
        ['followers', RELAY.inboxId.href, OTHER_RELAY.inboxId.href].sort(),
      )
      for (const [, , activity] of sendActivity.mock.calls) expect(activity).toBeInstanceOf(Delete)
    },
  )

  const relayCalls = (sendActivity: ReturnType<typeof vi.fn>) =>
    sendActivity.mock.calls.filter(([, recipient]) => recipient === RELAY)

  const expectRelayRetraction = async (sendActivity: ReturnType<typeof vi.fn>, postId: string) => {
    const followersActivity = sendActivity.mock.calls.find(([, recipient]) => recipient === 'followers')?.[2]
    expect(followersActivity).toBeInstanceOf(Update)
    const [[, , relayActivity]] = relayCalls(sendActivity)
    expect(relayActivity).toBeInstanceOf(Delete)
    const del = relayActivity as Delete
    expect(del.objectId?.href).toBe(`${ORIGIN}/users/fiddur/feed/${postId}`)
    expect(del.toIds.map((u) => u.href)).toEqual([PUBLIC])
  }

  const narrowedEdits: [
    string,
    (deps: FeedDeliveryDeps, visibility: 'public' | 'unlisted' | 'followers') => Promise<string>,
  ][] = [
    [
      'article',
      async (deps, visibility) => {
        await deliverFeedArticleUpdate(deps, 'fiddur', article(visibility))
        return article(visibility).id
      },
    ],
    [
      'challenge',
      async (deps, visibility) => {
        const post: DeliverableChallenge = {
          challenge: { name: 'August 10k', url: `${ORIGIN}/u/fiddur/august-10k` },
          created_at: new Date('2026-08-01T00:00:00Z'),
          id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          image_token: 'tok',
          include_chart: false,
          message: null,
          updated_at: new Date('2026-08-02T00:00:00Z'),
          visibility,
        }
        await deliverFeedChallengeUpdate(deps, 'fiddur', post, async () => false)
        return post.id
      },
    ],
    [
      'exercise',
      async (deps, visibility) => {
        const post: DeliverableExercise = {
          created_at: new Date('2026-11-01T00:00:00Z'),
          exercise: {
            activity_type: 'strength_training',
            field: 'sets.exercise',
            include_records: true,
            include_sessions: false,
            name: 'Bench Press',
            value: 'Bench Press',
          },
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          image_token: 'tok',
          include_chart: false,
          message: null,
          updated_at: new Date('2026-11-02T00:00:00Z'),
          visibility,
        }
        await deliverFeedExerciseUpdate(deps, 'fiddur', post, {
          content: async () => '<p>Bench</p>',
          hasTrend: async () => false,
        })
        return post.id
      },
    ],
    [
      'dashboard',
      async (deps, visibility) => {
        const post: DeliverableDashboard = {
          created_at: new Date('2026-11-01T00:00:00Z'),
          dashboard: {
            config: { period: { granularity: 'month' }, sections: [], version: 1 },
            include_link: false,
            name: 'Month in data',
            period: '2026-10',
          },
          id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          message: null,
          updated_at: new Date('2026-11-02T00:00:00Z'),
          visibility,
        }
        await deliverFeedDashboardUpdate(deps, 'fiddur', post, async () => '<p>Month</p>')
        return post.id
      },
    ],
  ]

  test.each(narrowedEdits)(
    'an edit narrowing a %s post retracts it from relays with a public Delete',
    async (_kind, edit) => {
      for (const visibility of ['unlisted', 'followers'] as const) {
        const { deps, sendActivity } = await fakeDeps()
        const postId = await edit(deps, visibility)
        await expectRelayRetraction(sendActivity, postId)
      }
    },
  )

  test.each(narrowedEdits)('an edit of a public %s post sends relays the Update', async (_kind, edit) => {
    const { deps, sendActivity } = await fakeDeps()
    await edit(deps, 'public')
    const [[, , relayActivity]] = relayCalls(sendActivity)
    expect(relayActivity).toBeInstanceOf(Update)
  })

  test('a reply and its Delete are not pushed to relays', async () => {
    const { deps, sendActivity } = await fakeDeps()
    const target = 'https://peer.example/users/bob'
    await deliverFeedReplyPost(
      deps,
      'fiddur',
      {
        created_at: new Date(),
        id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        in_reply_to_actor_uri: target,
        in_reply_to_handle: '@bob@peer.example',
        in_reply_to_uri: 'https://peer.example/users/bob/statuses/1',
        message: 'Nice',
        updated_at: new Date(),
        visibility: 'public',
      },
      { inbox_uri: `${target}/inbox`, shared_inbox_uri: null },
    )
    await deliverFeedDelete(
      deps,
      'fiddur',
      plainPost('public', { in_reply_to_actor_uri: target, kind: 'reply' }),
    )
    expect(sentTo(sendActivity).filter((to) => to?.startsWith('https://relay.example'))).toEqual([])
    expect(sentTo(sendActivity).filter((to) => to?.startsWith('https://tags.example'))).toEqual([])
  })

  test('a failing relay costs neither the followers nor the other relay their copy', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const sendActivity = vi.fn(async (_sender: unknown, recipient: unknown) => {
      if (recipient === RELAY) throw new Error('relay down')
    })
    const { deps } = await fakeDeps({ sendActivity })
    await expect(deliverFeedArticlePost(deps, 'fiddur', article('public'))).resolves.toBeUndefined()
    expect(sentTo(sendActivity).sort()).toEqual(
      ['followers', RELAY.inboxId.href, OTHER_RELAY.inboxId.href].sort(),
    )
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('relay.example'), expect.any(Error))
    warn.mockRestore()
  })

  test('an unreadable relay list does not fail the followers delivery', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { deps, sendActivity } = await fakeDeps({
      listRelayRecipients: async () => {
        throw new Error('db down')
      },
    })
    await deliverFeedArticlePost(deps, 'fiddur', article('public'))
    expect(sentTo(sendActivity)).toEqual(['followers'])
    warn.mockRestore()
  })

  test('a followers failure still surfaces after the relays got their copy', async () => {
    const sendActivity = vi.fn(async (_sender: unknown, recipient: unknown) => {
      if (recipient === 'followers') throw new Error('connect ECONNREFUSED')
    })
    const { deps } = await fakeDeps({ sendActivity })
    await expect(deliverFeedArticlePost(deps, 'fiddur', article('public'))).rejects.toThrow('ECONNREFUSED')
    expect(sentTo(sendActivity)).toHaveLength(3)
  })

  const tagPostsFake = () => ({
    record: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
  })

  test('a public post is recorded for the public tag pages, its Delete removes it', async () => {
    const publicTagPosts = tagPostsFake()
    const { deps } = await fakeDeps()
    const withTags = { ...deps, publicTagPosts }
    await deliverFeedArticlePost(withTags, 'fiddur', article('public'))
    expect(publicTagPosts.record).toHaveBeenCalledTimes(1)
    const [user, note] = publicTagPosts.record.mock.calls[0] as unknown as [string, Note]
    expect(user).toBe('fiddur')
    expect(note.id?.href).toBe(`${ORIGIN}/users/fiddur/feed/${article('public').id}`)
    await deliverFeedDelete(withTags, 'fiddur', plainPost('public'))
    expect(publicTagPosts.remove).toHaveBeenCalledWith(
      'fiddur',
      `${ORIGIN}/users/fiddur/feed/${plainPost('public').id}`,
    )
  })

  test.each(['unlisted', 'followers'] as const)(
    'a %s post is not recorded for the tag pages',
    async (visibility) => {
      const publicTagPosts = tagPostsFake()
      const { deps } = await fakeDeps()
      await deliverFeedArticlePost({ ...deps, publicTagPosts }, 'fiddur', article(visibility))
      expect(publicTagPosts.record).not.toHaveBeenCalled()
    },
  )

  test('an edit narrowing a post off public removes it from the tag pages', async () => {
    const publicTagPosts = tagPostsFake()
    const { deps } = await fakeDeps()
    await deliverFeedArticleUpdate({ ...deps, publicTagPosts }, 'fiddur', article('followers'))
    expect(publicTagPosts.record).not.toHaveBeenCalled()
    expect(publicTagPosts.remove).toHaveBeenCalledWith(
      'fiddur',
      `${ORIGIN}/users/fiddur/feed/${article('followers').id}`,
    )
  })

  test('a failing tag page record does not fail the delivery', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const publicTagPosts = {
      record: vi.fn(async () => {
        throw new Error('db down')
      }),
      remove: vi.fn(async () => {}),
    }
    const { deps, sendActivity } = await fakeDeps()
    await expect(
      deliverFeedArticlePost({ ...deps, publicTagPosts }, 'fiddur', article('public')),
    ).resolves.toBeUndefined()
    expect(sentTo(sendActivity)).toHaveLength(3)
    warn.mockRestore()
  })

  test('without the relay dependency, delivery is followers only', async () => {
    const { deps, sendActivity } = await fakeDeps({ listRelayRecipients: null })
    await deliverFeedArticlePost(deps, 'fiddur', article('public'))
    expect(sentTo(sendActivity)).toEqual(['followers'])
  })
})
