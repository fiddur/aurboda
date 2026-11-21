import type { ChallengeThreadEntry } from '@aurboda/api-spec'
import type { RequestHandler } from 'express'
import type { AddressInfo } from 'node:net'

import express from 'express'
import supertest from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { createChallenge, upsertChallengeMember } from '../db/challenges.ts'
import { query } from '../db/connection.ts'
import { _setDbForUser } from '../db/index.ts'
import { createRolePool, type UserDb } from '../db/pool.ts'
import {
  cleanTestDb,
  createTestDatabase,
  getTestUser,
  startTestDb,
  stopTestDb,
  type TestDatabase,
} from '../test/db-test-helper.ts'
import { createChallengeQuantpubRouter } from './challenge-quantpub-router.ts'
import { createChallengesRouter } from './challenges-router.ts'
import { createFeedPublicRouter } from './feed-public-router.ts'
import { createFeedRouter } from './feed-router.ts'

const CONTAINER_TIMEOUT = 120_000
const WEB_HOST = 'https://qs.example'
const API_BASE = 'https://qs.example/api'
const MEMBER = 'threadmember'
const VISITOR = 'threadvisitor'

const auth: RequestHandler = (req, _res, next) => {
  req.user = req.header('x-test-user') ?? getTestUser()
  next()
}

const startApp = () => {
  const app = express()
  app.use(express.json())
  app.use(
    '/challenges',
    createChallengesRouter(auth, WEB_HOST, API_BASE, async () => ({ challenges: [], peers_unreachable: 0 })),
  )
  app.use('/feed', createFeedRouter(auth, undefined, API_BASE, undefined, WEB_HOST))
  app.use(createFeedPublicRouter({ apiBaseUrl: API_BASE, webHost: WEB_HOST }))
  app.use(createChallengeQuantpubRouter({ apiBaseUrl: API_BASE, webHost: WEB_HOST }))
  const server = app.listen(0)
  const port = (server.address() as AddressInfo).port
  const close = () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections()
      server.close(() => resolve())
    })
  return { close, request: supertest(`http://127.0.0.1:${port}`) }
}

const newChallenge = (host: string, isPublic: boolean) =>
  createChallenge(host, {
    announce_winner: false,
    end_ts: new Date('2026-12-01T00:00:00Z'),
    is_public: isPublic,
    name: 'Steps',
    spec: {
      activity_type_id: null,
      aggregation: 'sum',
      bucket_size: '1d',
      filter_field: null,
      filter_value: null,
      measure: null,
      pattern: 'steps',
      source_type: 'metric',
      unit: 'steps',
    },
    start_ts: new Date('2026-11-01T00:00:00Z'),
    timezone: 'UTC',
  })

const contents = (entries: ChallengeThreadEntry[]) =>
  entries.map((entry) => ({
    content: entry.content.trim(),
    replies: entry.replies.map((reply) => reply.content.trim()),
  }))

const notificationTypes = async (user: string) =>
  (await query<{ type: string }>(user, 'SELECT type FROM notifications ORDER BY created_at')).rows.map(
    (row) => row.type,
  )

describe('challenge thread routes (integration)', () => {
  const extraDbs: TestDatabase[] = []
  const extraPools: UserDb[] = []
  let app: ReturnType<typeof startApp>

  beforeAll(async () => {
    await startTestDb()
    for (const user of [MEMBER, VISITOR]) {
      const db = await createTestDatabase()
      const pool = createRolePool({ connectionString: db.uri, max: 2 })
      _setDbForUser(user, pool)
      extraDbs.push(db)
      extraPools.push(pool)
    }
    app = startApp()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await app.close()
    for (const pool of extraPools) await pool.end()
    for (const db of extraDbs) await db.drop()
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
    for (const pool of extraPools) await pool.query('TRUNCATE feed_posts, notifications CASCADE')
  })

  test('members talk among themselves, visitors see the public part, the host moderates', async () => {
    const host = getTestUser()
    const challenge = await newChallenge(host, true)
    const challengeUrl = `${WEB_HOST}/u/${host}/${challenge.slug}`
    await upsertChallengeMember(host, challenge.id, {
      display_name: MEMBER,
      identity_base_url: `${API_BASE}/public/${MEMBER}`,
      kind: 'local',
      local_user: MEMBER,
    })
    const { request } = app
    const thread = (user: string) =>
      request.get('/challenges/thread').set('x-test-user', user).query({ challenge_url: challengeUrl })
    const comment = (user: string, body: Record<string, unknown>) =>
      request
        .post('/challenges/thread/comments')
        .set('x-test-user', user)
        .send({ challenge_url: challengeUrl, ...body })

    const memberComment = await comment(MEMBER, { audience: 'participants', message: 'Members only' })
    expect(memberComment.status).toBe(201)
    const entry = memberComment.body.entry as ChallengeThreadEntry
    expect(entry).toMatchObject({ audience: 'participants', kind: 'comment' })
    expect(entry.own_post_id).toBeDefined()
    const postId = entry.own_post_id!

    const wider = await comment(host, { audience: 'public', in_reply_to_id: entry.id, message: 'Too wide' })
    expect(wider.status).toBe(400)
    const reply = await comment(host, {
      audience: 'participants',
      in_reply_to_id: entry.id,
      message: 'Hi all',
    })
    expect(reply.status).toBe(201)

    expect((await comment(VISITOR, { audience: 'participants', message: 'Let me in' })).status).toBe(403)
    expect((await comment(VISITOR, { audience: 'public', message: 'Go team' })).status).toBe(201)

    const memberView = await thread(MEMBER)
    expect(memberView.status).toBe(200)
    expect(contents(memberView.body.entries)).toEqual([
      { content: '<p>Go team</p>', replies: [] },
      { content: '<p>Members only</p>', replies: ['<p>Hi all</p>'] },
    ])
    expect(memberView.body.viewer).toEqual({
      audiences: ['public', 'participants'],
      can_comment: true,
      role: 'member',
    })
    const visitorView = await thread(VISITOR)
    expect(contents(visitorView.body.entries)).toEqual([{ content: '<p>Go team</p>', replies: [] }])
    expect(visitorView.body).toMatchObject({ total: 1, viewer: { audiences: ['public'], role: 'visitor' } })
    const anonymous = await request.get(`/public/${host}/challenges/${challenge.slug}/thread`)
    expect(contents(anonymous.body.entries)).toEqual([{ content: '<p>Go team</p>', replies: [] }])

    expect(await notificationTypes(host)).toEqual(['challenge_comment', 'challenge_comment'])
    expect(await notificationTypes(MEMBER)).toEqual(['challenge_comment', 'challenge_comment'])
    expect(await notificationTypes(VISITOR)).toEqual([])

    const listing = await request.get(`/public/${MEMBER}/posts`)
    expect(listing.status).toBe(200)
    expect(listing.body.posts.map((post: { id: string }) => post.id)).not.toContain(postId)
    expect((await request.get(`/public/${MEMBER}/posts/${postId}`)).status).toBe(404)
    expect((await request.get(`/public/${MEMBER}/feed/${postId}`)).status).toBe(404)

    const own = await request.get(`/feed/${postId}`).set('x-test-user', MEMBER)
    expect(own.body.post).toMatchObject({
      in_challenge: { name: 'Steps', url: challengeUrl },
      visibility: 'participants',
    })

    const hide = await request
      .post(`/challenges/thread/entries/${entry.id}/hidden`)
      .set('x-test-user', host)
      .send({ challenge_url: challengeUrl })
    expect(hide.status).toBe(200)
    expect(
      (
        await request
          .post(`/challenges/thread/entries/${entry.id}/hidden`)
          .set('x-test-user', MEMBER)
          .send({ challenge_url: challengeUrl })
      ).status,
    ).toBe(403)
    expect(contents((await thread(MEMBER)).body.entries)).toEqual([
      { content: '<p>Go team</p>', replies: [] },
    ])
    const hostView = (await thread(host)).body.entries as ChallengeThreadEntry[]
    expect(hostView.find((e) => e.id === entry.id)?.hidden).toBe(true)
    const unhide = await request
      .delete(`/challenges/thread/entries/${entry.id}/hidden`)
      .set('x-test-user', host)
      .query({ challenge_url: challengeUrl })
    expect(unhide.status).toBe(200)
    expect((await thread(MEMBER)).body.entries).toHaveLength(2)

    const widen = await request
      .patch(`/feed/${postId}`)
      .set('x-test-user', MEMBER)
      .send({ visibility: 'public' })
    expect(widen.status).toBe(400)
    const edit = await request.patch(`/feed/${postId}`).set('x-test-user', MEMBER).send({ message: 'Edited' })
    expect(edit.status).toBe(200)
    const edited = (await thread(MEMBER)).body.entries as ChallengeThreadEntry[]
    expect(edited.find((e) => e.id === entry.id)).toMatchObject({ message: 'Edited' })
    expect(edited.find((e) => e.id === entry.id)?.content.trim()).toBe('<p>Edited</p>')
    expect(edited.find((e) => e.id === entry.id)?.edited_at).not.toBeNull()

    expect((await request.delete(`/feed/${postId}`).set('x-test-user', MEMBER)).status).toBe(200)
    expect(contents((await thread(host)).body.entries)).toEqual([{ content: '<p>Go team</p>', replies: [] }])

    const share = await request
      .post('/feed/challenges')
      .set('x-test-user', host)
      .send({ challenge_id: challenge.id, include_chart: false, message: 'Join us', visibility: 'public' })
    expect(share.status).toBe(200)
    const afterShare = (await thread(VISITOR)).body.entries as ChallengeThreadEntry[]
    expect(afterShare[0]).toMatchObject({ audience: 'public', kind: 'share' })
    expect(afterShare[0]?.content.trim()).toBe('<p>Join us</p>')
  })

  test('an unlisted challenge keeps every entry among the participants', async () => {
    const host = getTestUser()
    const challenge = await newChallenge(host, false)
    const challengeUrl = `${WEB_HOST}/u/${host}/${challenge.slug}`
    const { request } = app
    const hostComment = await request
      .post('/challenges/thread/comments')
      .send({ audience: 'public', challenge_url: challengeUrl, message: 'Hello' })
    expect(hostComment.status).toBe(403)
    const participants = await request
      .post('/challenges/thread/comments')
      .send({ audience: 'participants', challenge_url: challengeUrl, message: 'Hello' })
    expect(participants.status).toBe(201)
    const visitor = await request
      .get('/challenges/thread')
      .set('x-test-user', VISITOR)
      .query({ challenge_url: challengeUrl })
    expect(visitor.body).toMatchObject({
      entries: [],
      total: 0,
      viewer: { audiences: [], can_comment: false },
    })
    const anonymous = await request.get(`/public/${host}/challenges/${challenge.slug}/thread`)
    expect(anonymous.body.entries).toEqual([])
  })
})
