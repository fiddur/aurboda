import express from 'express'
import supertest from 'supertest'
import { describe, expect, test } from 'vitest'

import type { ChallengeMemberRecord, ChallengeRecord, ChallengeThreadEntryRecord } from '../db/index.ts'
import type { ThreadDocumentDeps } from '../services/challenge-thread-remote.ts'

import { createChallengeThreadFederationRouter } from './challenge-thread-federation-router.ts'

const HOST_WEB = 'https://host.example'
const OLA = 'https://home.example/users/ola'

const challenge: ChallengeRecord = {
  announce_winner: false,
  banner_updated_at: null,
  created_at: new Date('2026-10-01T00:00:00Z'),
  end_ts: new Date('2026-12-01T00:00:00Z'),
  id: 'c1',
  is_public: true,
  join_token: 'jt',
  name: 'November',
  result_published_at: null,
  slug: 'nov',
  spec: {
    activity_type_id: null,
    aggregation: 'sum',
    bucket_size: 'auto',
    filter_field: null,
    filter_value: null,
    measure: null,
    pattern: 'steps',
    source_type: 'metric',
    unit: 'steps',
  },
  start_ts: new Date('2026-11-01T00:00:00Z'),
  timezone: 'UTC',
  updated_at: new Date('2026-10-01T00:00:00Z'),
}

const ola: ChallengeMemberRecord = {
  actor: OLA,
  actor_verified_at: null,
  cached_buckets: null,
  cached_total: null,
  challenge_id: 'c1',
  data_endpoint_url: null,
  data_last_updated: null,
  display_name: 'Ola',
  id: 'm-ola',
  identity_base_url: 'https://home.example/u/ola',
  joined_at: new Date('2026-10-02T00:00:00Z'),
  kind: 'remote',
  last_error: null,
  last_fetched_at: null,
  local_user: null,
  status: 'active',
}

const entry = (audience: 'participants' | 'public', id: string): ChallengeThreadEntryRecord => ({
  actor_uri: `${HOST_WEB}/users/bob`,
  audience,
  avatar_url: null,
  challenge_id: 'c1',
  content: `<p>${id}</p>`,
  created_at: new Date('2026-11-05T00:00:00Z'),
  display_name: 'Bob',
  edited_at: null,
  handle: '@bob@host.example',
  hidden_at: null,
  id,
  images: [],
  in_reply_to_uri: `${HOST_WEB}/users/freja/challenges/nov`,
  kind: 'comment',
  object_uri: `${HOST_WEB}/users/bob/feed/${id}`,
  published_at: new Date('2026-11-05T00:00:00Z'),
  root_entry_id: null,
  url: null,
})

const setup = (signer: string | null) => {
  const verified: string[] = []
  const document: ThreadDocumentDeps = {
    listDocumentEntries: async (_host, _id, audiences) =>
      [entry('participants', 'e2'), entry('public', 'e1')].filter((e) => audiences.includes(e.audience)),
    listMembers: async () => [ola],
    markVerified: async (_host, memberId) => {
      verified.push(memberId)
    },
    webHost: HOST_WEB,
  }
  const app = express()
  app.use(
    createChallengeThreadFederationRouter({
      document,
      loadChallenge: async (username, slug) => (username === 'freja' && slug === 'nov' ? challenge : null),
      signedActorOf: async () => signer,
      webHost: HOST_WEB,
    }),
  )
  return { app, verified }
}

describe('GET /users/:username/challenges/:slug/thread', () => {
  test('a signed member gets the participants entries and the attendees, and is verified', async () => {
    const { app, verified } = setup(OLA)
    const res = await supertest(app).get('/users/freja/challenges/nov/thread')
    expect(res.status).toBe(200)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.body.audiences).toEqual(['public', 'participants'])
    expect(res.body.attendees).toContain(OLA)
    expect(res.body.items.map((item: { content: string }) => item.content)).toEqual([
      '<p>e2</p>',
      '<p>e1</p>',
    ])
    expect(verified).toEqual(['m-ola'])
  })

  test('a stranger gets the public entries only, no attendees, and verifies nobody', async () => {
    const { app, verified } = setup('https://far.example/users/zed')
    const res = await supertest(app).get('/users/freja/challenges/nov/thread')
    expect(res.status).toBe(200)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.body.audiences).toEqual(['public'])
    expect(res.body.attendees).toBeUndefined()
    expect(res.body.items).toHaveLength(1)
    expect(verified).toEqual([])
  })

  test('an unsigned request is treated as a stranger', async () => {
    const { app } = setup(null)
    const res = await supertest(app).get('/users/freja/challenges/nov/thread')
    expect(res.status).toBe(200)
    expect(res.body.audiences).toEqual(['public'])
    expect(res.body.items).toHaveLength(1)
  })

  test('an unknown challenge is a 404, not cached', async () => {
    const { app } = setup(OLA)
    const res = await supertest(app).get('/users/freja/challenges/dec/thread')
    expect(res.status).toBe(404)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.body).toEqual({ error: 'Challenge not found' })
  })
})
