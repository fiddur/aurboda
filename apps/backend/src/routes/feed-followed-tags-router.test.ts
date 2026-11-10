import type { Federation } from '@fedify/fedify'
import type { RequestHandler } from 'express'

import express from 'express'
import supertest from 'supertest'
import { describe, expect, test } from 'vitest'

import type { FeedFollowingRecord } from '../db/index.ts'

import { type FollowActions, type FollowDeps, followTag, unfollowTag } from '../services/following.ts'
import { createFeedFollowedTagsRouter } from './feed-followed-tags-router.ts'

const auth: RequestHandler = (req, _res, next) => {
  req.user = 'tester'
  next()
}

const record: FeedFollowingRecord = {
  accepted: false,
  actor_uri: 'https://tags.pub/user/running',
  avatar_url: null,
  created_at: new Date('2026-11-01T10:00:00Z'),
  display_name: '#running',
  handle: '@running@tags.pub',
  id: '33333333-3333-3333-3333-333333333333',
  inbox_uri: 'https://tags.pub/user/running/inbox',
  notify_on_post: true,
  shared_inbox_uri: null,
  tag: 'running',
}

const deps: FollowDeps = {
  federation: {} as Federation<void>,
  origin: 'https://aurboda.example',
  tagActorHost: async () => 'tags.pub',
}

const app = (overrides: Partial<FollowActions> = {}) => {
  const actions: FollowActions = {
    follow: async () => ({ error: 'unused', ok: false, status: 500 }),
    followTag: (user, tag) => followTag(deps, user, tag),
    unfollow: async () => false,
    unfollowTag: (user, tag) => unfollowTag(deps, user, tag),
    ...overrides,
  }
  const server = express()
  server.use(express.json())
  server.use('/feed/followed-tags', createFeedFollowedTagsRouter(auth, actions))
  return server
}

describe('POST /feed/followed-tags', () => {
  test('follows the tag and returns the followed tag', async () => {
    const calls: string[] = []
    const res = await supertest(
      app({
        followTag: async (_user, tag) => {
          calls.push(tag)
          return { ok: true, record }
        },
      }),
    )
      .post('/feed/followed-tags')
      .send({ tag: '#Running' })
    expect(res.status).toBe(200)
    expect(calls).toEqual(['#Running'])
    expect(res.body).toEqual({
      followed_tag: {
        accepted: false,
        actor_uri: 'https://tags.pub/user/running',
        avatar_url: null,
        created_at: '2026-11-01T10:00:00.000Z',
        display_name: '#running',
        handle: '@running@tags.pub',
        id: record.id,
        notify_on_post: true,
        tag: 'running',
      },
      success: true,
    })
  })

  test('400 on an invalid hashtag', async () => {
    const res = await supertest(app()).post('/feed/followed-tags').send({ tag: '#not valid' })
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'Not a valid hashtag.', success: false })
  })

  test('400 when the tag is missing', async () => {
    const res = await supertest(app()).post('/feed/followed-tags').send({})
    expect(res.status).toBe(400)
  })
})

describe('DELETE /feed/followed-tags/:tag', () => {
  test('404 when the tag is not followed', async () => {
    const res = await supertest(app({ unfollowTag: async () => false })).delete('/feed/followed-tags/running')
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Not following that tag', success: false })
  })

  test('unfollows a followed tag', async () => {
    const calls: string[] = []
    const res = await supertest(
      app({
        unfollowTag: async (_user, tag) => {
          calls.push(tag)
          return true
        },
      }),
    ).delete('/feed/followed-tags/running')
    expect(res.status).toBe(200)
    expect(calls).toEqual(['running'])
  })
})
