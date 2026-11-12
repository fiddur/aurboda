import express, { type RequestHandler } from 'express'
import supertest from 'supertest'
import { describe, expect, test, vi } from 'vitest'

import type { AccountDeleter } from '../services/account-deletion.ts'
import type { AccountPlans } from '../services/account-plan.ts'
import type { AdminUsers } from '../services/admin-users.ts'
import type { CentralDb } from '../services/central-db.ts'
import type { InvitationAuth } from '../services/invitation.ts'
import type { RelayActions } from '../services/relays.ts'

import { gravlRedirectUri } from '../integrations/gravl/client.ts'
import { createAdminRouter } from './admin-router.ts'

const centralDb = {
  getAdminCount: vi.fn().mockResolvedValue(1),
  getAuditLogRetentionDays: vi.fn().mockResolvedValue(3),
  getLastFmApiKey: vi.fn().mockResolvedValue(null),
  getOuraWebhookEnabled: vi.fn().mockResolvedValue(false),
  getServerSetting: vi.fn().mockResolvedValue(null),
  getSignupMode: vi.fn().mockResolvedValue('closed'),
  listInstanceTagFollows: vi.fn().mockResolvedValue([]),
  setServerSetting: vi.fn().mockResolvedValue(undefined),
} as unknown as CentralDb

const pass: RequestHandler = (req, _res, next) => {
  req.user = 'root'
  next()
}
const forbid: RequestHandler = (_req, res) => {
  res.status(403).json({ error: 'Forbidden', success: false })
}

const noPlan = {
  ends_at: null,
  paid_until: null,
  plan: null,
  plan_note: null,
  read_only_at: null,
  state: 'active' as const,
  trial_ends_at: null,
}

const overview = {
  ...noPlan,
  created_at: null,
  email: 'alice@example.com',
  ingest: { items_30d: 0, last_at: null, per_day_30d: 0, per_day_7d: 0, sources: [] },
  is_admin: true,
  last_api_at: null,
  last_ui_at: '2026-11-06T10:00:00.000Z',
  pre_existing: true,
  storage_bytes: 1024,
  use: {
    android: { active_days_30d: 0, last_at: null, reads_30d: 0, writes_30d: 0 },
    api: { active_days_30d: 0, last_at: null, reads_30d: 0, writes_30d: 0 },
    mcp: { active_days_30d: 0, last_at: null, reads_30d: 0, writes_30d: 0 },
    web: { active_days_30d: 1, last_at: '2026-11-06T10:00:00.000Z', reads_30d: 3, writes_30d: 0 },
  },
  username: 'alice',
}

const adminUsers: AdminUsers = {
  getUserUsage: vi.fn(async (username: string) =>
    username === 'alice'
      ? {
          ...noPlan,
          created_at: null,
          daily: [],
          email: 'alice@example.com',
          is_admin: true,
          largest_tables: [{ bytes: 512, table: 'time_series' }],
          pre_existing: true,
          since: '2026-08-09',
          storage_bytes: 1024,
          username,
        }
      : null,
  ),
  listUsersOverview: vi.fn(async () => [overview]),
}

const deleteAccount = vi.fn<AccountDeleter>(async (username, { confirmUsername }) => {
  if (confirmUsername !== username) {
    return { error: 'confirmation_mismatch', message: 'mismatch', ok: false }
  }
  if (username === 'root') return { error: 'last_admin', message: 'last admin', ok: false }
  if (username !== 'alice') return { error: 'not_found', message: 'User not found', ok: false }
  return { ok: true }
})

const accountPlans: AccountPlans = {
  billingSettingsChanged: vi.fn(async () => {}),
  getMyPlan: vi.fn(),
  setUserPlan: vi.fn(async (username: string, body) =>
    username === 'alice'
      ? {
          ...noPlan,
          paid_until: body.paid_until ?? null,
          plan: 'paid' as const,
          plan_note: body.plan_note ?? null,
        }
      : null,
  ),
}

const relayRecord = {
  actor_uri: null,
  created_at: new Date('2026-11-10T00:00:00Z'),
  follow_activity_id: 'https://web.example.test/actor/follows/11111111-1111-4111-8111-111111111111',
  id: '11111111-1111-4111-8111-111111111111',
  inbox_uri: 'https://tags.pub/user/_____relay_____/inbox',
  last_error: null,
  state: 'pending' as const,
  style: 'mastodon' as const,
  updated_at: new Date('2026-11-10T00:00:00Z'),
  url: 'https://tags.pub/user/_____relay_____/inbox',
}

const relayActions: RelayActions = {
  add: vi.fn(async ({ url }) =>
    url === relayRecord.url
      ? { ok: true as const, record: relayRecord }
      : { error: 'That relay is already added.', ok: false as const, status: 409 },
  ),
  list: vi.fn(async () => []),
  remove: vi.fn(async (id: string) => id === relayRecord.id),
}

const publicTagActions = { apply: vi.fn(async () => ({ followed: [], unresolved: [] })) }

const postUpdates = {
  start: vi.fn(
    async (): Promise<{ done: Promise<void>; posts: number } | null> => ({
      done: Promise.resolve(),
      posts: 7,
    }),
  ),
}

const buildApp = (adminMiddleware: RequestHandler = pass) => {
  const app = express()
  app.use(express.json())
  app.use(
    '/admin',
    createAdminRouter(
      pass,
      adminMiddleware,
      centralDb,
      adminUsers,
      {} as InvitationAuth,
      'https://web.example.test',
      gravlRedirectUri('https://api.example.test/api'),
      async (username) => username === 'fiddur' || username === 'alice',
      null,
      deleteAccount,
      accountPlans,
      relayActions,
      publicTagActions,
      postUpdates,
    ),
  )
  return app
}

describe('admin settings', () => {
  test('GET returns the absolute Gravl redirect URI the OAuth flow uses', async () => {
    const res = await supertest(buildApp()).get('/admin/settings')
    expect(res.status).toBe(200)
    expect(res.body.gravl_redirect_uri).toBe('https://api.example.test/api/auth/gravlcb')
  })

  test('PATCH returns it too, so the cached settings keep it', async () => {
    const res = await supertest(buildApp()).patch('/admin/settings').send({ gravl_client_id: 'abc' })
    expect(res.status).toBe(200)
    expect(res.body.gravl_redirect_uri).toBe('https://api.example.test/api/auth/gravlcb')
  })
})

describe('official feed setting', () => {
  test('GET returns it off when nothing is set', async () => {
    const res = await supertest(buildApp()).get('/admin/settings')
    expect(res.body.official_feed).toEqual({ remote_authors: [], tags: [], users: [] })
    expect(res.body).not.toHaveProperty('blog_username')
  })

  test('GET reads a legacy blog user as a one-user feed', async () => {
    vi.mocked(centralDb.getServerSetting).mockImplementation(async (key) =>
      key === 'blog_username' ? 'fiddur' : null,
    )
    try {
      const res = await supertest(buildApp()).get('/admin/settings')
      expect(res.body.official_feed).toEqual({ remote_authors: [], tags: [], users: ['fiddur'] })
    } finally {
      vi.mocked(centralDb.getServerSetting).mockReset().mockResolvedValue(null)
    }
  })

  test('PATCH stores existing users and normalised tags, and retires blog_username', async () => {
    vi.mocked(centralDb.setServerSetting).mockClear()
    const res = await supertest(buildApp())
      .patch('/admin/settings')
      .send({ official_feed: { tags: ['#Aurboda', 'qs', 'aurboda'], users: ['fiddur', 'alice', 'fiddur'] } })
    expect(res.status).toBe(200)
    expect(centralDb.setServerSetting).toHaveBeenCalledWith('official_feed', {
      remote_authors: [],
      tags: ['aurboda', 'qs'],
      users: ['fiddur', 'alice'],
    })
    expect(centralDb.setServerSetting).toHaveBeenCalledWith('blog_username', '')
  })

  test('PATCH stores remote authors as user@host, moving one on this server to users, and applies the tags', async () => {
    vi.mocked(centralDb.setServerSetting).mockClear()
    publicTagActions.apply.mockClear()
    const stored = {
      remote_authors: ['bob@peer.example'],
      tags: ['aurbodablog'],
      users: ['fiddur'],
    }
    vi.mocked(centralDb.getServerSetting).mockImplementation(async (key) =>
      key === 'official_feed' ? stored : key === 'public_tag_pages' ? ['running'] : null,
    )
    try {
      const res = await supertest(buildApp())
        .patch('/admin/settings')
        .send({
          official_feed: {
            remote_authors: ['@bob@Peer.Example', 'bob@peer.example', '@fiddur@web.example.test'],
            tags: ['aurbodablog'],
            users: [],
          },
        })
      expect(res.status).toBe(200)
      expect(centralDb.setServerSetting).toHaveBeenCalledWith('official_feed', stored)
      expect(publicTagActions.apply).toHaveBeenCalledWith(['running', 'aurbodablog'])
    } finally {
      vi.mocked(centralDb.getServerSetting).mockReset().mockResolvedValue(null)
    }
  })

  test('PATCH rejects remote authors without a tag, and an invalid handle, storing nothing', async () => {
    vi.mocked(centralDb.setServerSetting).mockClear()
    const noTag = await supertest(buildApp())
      .patch('/admin/settings')
      .send({ official_feed: { remote_authors: ['bob@peer.example'], tags: [], users: [] } })
    expect(noTag.status).toBe(400)
    expect(noTag.body.error).toContain('at least one tag')
    const badHandle = await supertest(buildApp())
      .patch('/admin/settings')
      .send({ official_feed: { remote_authors: ['https://peer.example/@bob'], tags: ['qs'], users: [] } })
    expect(badHandle.status).toBe(400)
    expect(centralDb.setServerSetting).not.toHaveBeenCalled()
  })

  test('PATCH rejects unknown users with 400, naming each, and stores nothing', async () => {
    vi.mocked(centralDb.setServerSetting).mockClear()
    const res = await supertest(buildApp())
      .patch('/admin/settings')
      .send({ official_feed: { tags: [], users: ['fiddur', 'ghost', 'nobody'] } })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('"ghost"')
    expect(res.body.error).toContain('"nobody"')
    expect(centralDb.setServerSetting).not.toHaveBeenCalled()
  })

  test('PATCH rejects an invalid tag or more than 20 users', async () => {
    const badTag = await supertest(buildApp())
      .patch('/admin/settings')
      .send({ official_feed: { tags: ['not a tag'], users: ['fiddur'] } })
    expect(badTag.status).toBe(400)
    const tooMany = await supertest(buildApp())
      .patch('/admin/settings')
      .send({ official_feed: { tags: [], users: Array.from({ length: 21 }, () => 'fiddur') } })
    expect(tooMany.status).toBe(400)
  })

  test('PATCH with the deprecated blog_username sets a one-user feed, null turns it off', async () => {
    vi.mocked(centralDb.setServerSetting).mockClear()
    const res = await supertest(buildApp()).patch('/admin/settings').send({ blog_username: 'fiddur' })
    expect(res.status).toBe(200)
    expect(centralDb.setServerSetting).toHaveBeenCalledWith('official_feed', {
      remote_authors: [],
      tags: [],
      users: ['fiddur'],
    })
    vi.mocked(centralDb.setServerSetting).mockClear()
    await supertest(buildApp()).patch('/admin/settings').send({ blog_username: null })
    expect(centralDb.setServerSetting).toHaveBeenCalledWith('official_feed', {
      remote_authors: [],
      tags: [],
      users: [],
    })
  })

  test('PATCH with the deprecated blog_username rejects an unknown user', async () => {
    vi.mocked(centralDb.setServerSetting).mockClear()
    const res = await supertest(buildApp()).patch('/admin/settings').send({ blog_username: 'ghost' })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('ghost')
    expect(centralDb.setServerSetting).not.toHaveBeenCalled()
  })
})

describe('tag actor host setting', () => {
  test('GET defaults to tags.pub', async () => {
    const res = await supertest(buildApp()).get('/admin/settings')
    expect(res.body.tag_actor_host).toBe('tags.pub')
  })

  test('PATCH stores a trimmed lowercase hostname; empty resets to the default', async () => {
    vi.mocked(centralDb.setServerSetting).mockClear()
    const res = await supertest(buildApp())
      .patch('/admin/settings')
      .send({ tag_actor_host: ' Tags.Example ' })
    expect(res.status).toBe(200)
    expect(centralDb.setServerSetting).toHaveBeenCalledWith('tag_actor_host', 'tags.example')
    vi.mocked(centralDb.setServerSetting).mockClear()
    await supertest(buildApp()).patch('/admin/settings').send({ tag_actor_host: '' })
    expect(centralDb.setServerSetting).toHaveBeenCalledWith('tag_actor_host', '')
  })

  test.each([
    'https://tags.pub',
    'tags.pub/user',
    'tags.pub:443',
    'a b',
    'running@tags.pub',
    'tags.pub?x',
    'a#b',
    'tags.pub.',
  ])('PATCH rejects %j', async (tag_actor_host) => {
    vi.mocked(centralDb.setServerSetting).mockClear()
    const res = await supertest(buildApp()).patch('/admin/settings').send({ tag_actor_host })
    expect(res.status).toBe(400)
    expect(centralDb.setServerSetting).not.toHaveBeenCalled()
  })
})

describe('support contact settings', () => {
  test('GET reports both empty when unset', async () => {
    const res = await supertest(buildApp()).get('/admin/settings')
    expect(res.body).toMatchObject({ contact_fediverse: '', contact_reddit: '' })
  })

  test('GET reads the stored contacts', async () => {
    vi.mocked(centralDb.getServerSetting).mockImplementation(async (key) =>
      key === 'contact_fediverse' ? 'fiddur@aurboda.net' : key === 'contact_reddit' ? 'fiddur' : null,
    )
    try {
      const res = await supertest(buildApp()).get('/admin/settings')
      expect(res.body).toMatchObject({ contact_fediverse: 'fiddur@aurboda.net', contact_reddit: 'fiddur' })
    } finally {
      vi.mocked(centralDb.getServerSetting).mockReset().mockResolvedValue(null)
    }
  })

  test('PATCH stores the normalised handle and username', async () => {
    vi.mocked(centralDb.setServerSetting).mockClear()
    const res = await supertest(buildApp()).patch('/admin/settings').send({
      contact_fediverse: '@fiddur@Aurboda.net',
      contact_reddit: 'https://www.reddit.com/user/fiddur/',
    })
    expect(res.status).toBe(200)
    expect(vi.mocked(centralDb.setServerSetting).mock.calls).toEqual([
      ['contact_fediverse', 'fiddur@aurboda.net'],
      ['contact_reddit', 'fiddur'],
    ])
  })

  test('PATCH with empty strings clears them', async () => {
    vi.mocked(centralDb.setServerSetting).mockClear()
    const res = await supertest(buildApp())
      .patch('/admin/settings')
      .send({ contact_fediverse: '', contact_reddit: '' })
    expect(res.status).toBe(200)
    expect(vi.mocked(centralDb.setServerSetting).mock.calls).toEqual([
      ['contact_fediverse', ''],
      ['contact_reddit', ''],
    ])
  })

  test.each([
    [{ contact_fediverse: 'fiddur' }],
    [{ contact_fediverse: '@fiddur' }],
    [{ contact_fediverse: 'https://aurboda.net/@fiddur' }],
    [{ contact_reddit: 'ab' }],
    [{ contact_reddit: 'u/has space' }],
    [{ contact_reddit: 'https://example.com/user/fiddur' }],
  ])('PATCH rejects %j', async (body) => {
    vi.mocked(centralDb.setServerSetting).mockClear()
    const res = await supertest(buildApp()).patch('/admin/settings').send(body)
    expect(res.status).toBe(400)
    expect(centralDb.setServerSetting).not.toHaveBeenCalled()
  })
})

describe('admin billing settings', () => {
  test('GET reports billing off with the default trial and grace days', async () => {
    const res = await supertest(buildApp()).get('/admin/settings')
    expect(res.body).toMatchObject({
      billing_enabled: false,
      grace_days: 14,
      payment_url: '',
      price_text: '',
      trial_days: 90,
    })
  })

  test('PATCH stores the billing fields and tells the plans service what billing was before', async () => {
    vi.mocked(centralDb.setServerSetting).mockClear()
    const res = await supertest(buildApp()).patch('/admin/settings').send({
      billing_enabled: true,
      grace_days: 7,
      payment_url: 'https://patreon.example/aurboda',
      price_text: '3 € / month',
      trial_days: 30,
    })

    expect(res.status).toBe(200)
    expect(vi.mocked(centralDb.setServerSetting).mock.calls).toEqual([
      ['trial_days', 30],
      ['grace_days', 7],
      ['price_text', '3 € / month'],
      ['payment_url', 'https://patreon.example/aurboda'],
      ['billing_enabled', true],
    ])
    expect(accountPlans.billingSettingsChanged).toHaveBeenCalledWith(false)
  })

  test('PATCH without billing fields leaves billing alone', async () => {
    vi.mocked(accountPlans.billingSettingsChanged).mockClear()
    await supertest(buildApp()).patch('/admin/settings').send({ gravl_client_id: 'abc' })
    expect(accountPlans.billingSettingsChanged).not.toHaveBeenCalled()
  })

  test.each([
    [{ trial_days: -1 }],
    [{ trial_days: 3651 }],
    [{ grace_days: 366 }],
    [{ payment_url: 'http://patreon.example/aurboda' }],
    [{ payment_url: 'not a url' }],
    [{ price_text: 'x'.repeat(201) }],
  ])('PATCH rejects %j', async (body) => {
    const res = await supertest(buildApp()).patch('/admin/settings').send(body)
    expect(res.status).toBe(400)
  })

  test('PATCH accepts an empty payment link to clear it', async () => {
    const res = await supertest(buildApp()).patch('/admin/settings').send({ payment_url: '' })
    expect(res.status).toBe(200)
  })
})

describe('PATCH /admin/users/:username/plan', () => {
  test("updates the user's plan and returns it", async () => {
    const res = await supertest(buildApp())
      .patch('/admin/users/alice/plan')
      .send({ paid_until: '2027-06-01T00:00:00.000Z', plan_note: 'Patreon' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      status: { ...noPlan, paid_until: '2027-06-01T00:00:00.000Z', plan: 'paid', plan_note: 'Patreon' },
      success: true,
    })
    expect(accountPlans.setUserPlan).toHaveBeenLastCalledWith('alice', {
      paid_until: '2027-06-01T00:00:00.000Z',
      plan_note: 'Patreon',
    })
  })

  test('404 for an unknown user', async () => {
    const res = await supertest(buildApp()).patch('/admin/users/mallory/plan').send({ plan: 'exempt' })
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'User not found', success: false })
  })

  test.each([[{ plan: 'gold' }], [{ paid_until: 'tomorrow' }], [{ plan_note: 'x'.repeat(1001) }]])(
    '400 for %j',
    async (body) => {
      const res = await supertest(buildApp()).patch('/admin/users/alice/plan').send(body)
      expect(res.status).toBe(400)
    },
  )

  test('non-admins are refused', async () => {
    vi.mocked(accountPlans.setUserPlan).mockClear()
    const res = await supertest(buildApp(forbid)).patch('/admin/users/alice/plan').send({ plan: 'exempt' })
    expect(res.status).toBe(403)
    expect(accountPlans.setUserPlan).not.toHaveBeenCalled()
  })
})

describe('admin users', () => {
  test('GET /users lists every user', async () => {
    const res = await supertest(buildApp()).get('/admin/users')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true, users: [overview] })
  })

  test('GET /users/:username returns the usage, 90 days by default', async () => {
    const res = await supertest(buildApp()).get('/admin/users/alice')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.user).toMatchObject({ largest_tables: [{ bytes: 512, table: 'time_series' }] })
    expect(adminUsers.getUserUsage).toHaveBeenLastCalledWith('alice', 90)
  })

  test('GET /users/:username passes days through and rejects out-of-range values', async () => {
    await supertest(buildApp()).get('/admin/users/alice?days=14')
    expect(adminUsers.getUserUsage).toHaveBeenLastCalledWith('alice', 14)

    const res = await supertest(buildApp()).get('/admin/users/alice?days=401')
    expect(res.status).toBe(400)
  })

  test('GET /users/:username answers 404 for an unknown user', async () => {
    const res = await supertest(buildApp()).get('/admin/users/mallory')
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'User not found', success: false })
  })

  test('non-admins are refused', async () => {
    vi.mocked(adminUsers.listUsersOverview).mockClear()
    vi.mocked(adminUsers.getUserUsage).mockClear()
    const app = buildApp(forbid)
    expect((await supertest(app).get('/admin/users')).status).toBe(403)
    expect((await supertest(app).get('/admin/users/alice')).status).toBe(403)
    expect(adminUsers.listUsersOverview).not.toHaveBeenCalled()
    expect(adminUsers.getUserUsage).not.toHaveBeenCalled()
  })
})

describe('DELETE /admin/users/:username', () => {
  test('deletes the user, with the admin as actor', async () => {
    const res = await supertest(buildApp()).delete('/admin/users/alice').send({ confirm_username: 'alice' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true })
    expect(deleteAccount).toHaveBeenCalledWith('alice', { actor: 'root', confirmUsername: 'alice' })
  })

  test('400 on a confirmation mismatch, 404 for an unknown user, 409 for the last admin', async () => {
    const app = buildApp()
    expect((await supertest(app).delete('/admin/users/alice').send({ confirm_username: 'bob' })).status).toBe(
      400,
    )
    expect(
      (await supertest(app).delete('/admin/users/mallory').send({ confirm_username: 'mallory' })).status,
    ).toBe(404)
    expect((await supertest(app).delete('/admin/users/root').send({ confirm_username: 'root' })).status).toBe(
      409,
    )
  })

  test('non-admins are refused', async () => {
    deleteAccount.mockClear()
    const res = await supertest(buildApp(forbid))
      .delete('/admin/users/alice')
      .send({ confirm_username: 'alice' })
    expect(res.status).toBe(403)
    expect(deleteAccount).not.toHaveBeenCalled()
  })
})

describe('admin relays', () => {
  test('GET /relays lists them', async () => {
    const res = await supertest(buildApp()).get('/admin/relays')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ relays: [], success: true })
  })

  test('POST /relays adds one, mastodon by default, and serialises it', async () => {
    const res = await supertest(buildApp()).post('/admin/relays').send({ url: relayRecord.url })
    expect(res.status).toBe(201)
    expect(relayActions.add).toHaveBeenLastCalledWith({ style: 'mastodon', url: relayRecord.url })
    expect(res.body.relay).toMatchObject({ created_at: '2026-11-10T00:00:00.000Z', state: 'pending' })
    expect(res.body.relay.follow_activity_id).toBeUndefined()
  })

  test('POST /relays passes the service status through and validates the body', async () => {
    const conflict = await supertest(buildApp())
      .post('/admin/relays')
      .send({ url: 'https://other.example/inbox' })
    expect(conflict.status).toBe(409)
    expect(conflict.body).toEqual({ error: 'That relay is already added.', success: false })

    const invalid = await supertest(buildApp())
      .post('/admin/relays')
      .send({ style: 'diaspora', url: relayRecord.url })
    expect(invalid.status).toBe(400)
  })

  test('DELETE /relays/:id removes it, 404 when unknown', async () => {
    expect((await supertest(buildApp()).delete(`/admin/relays/${relayRecord.id}`)).status).toBe(200)
    expect((await supertest(buildApp()).delete('/admin/relays/nope')).status).toBe(404)
  })

  test('non-admins are refused', async () => {
    vi.mocked(relayActions.add).mockClear()
    const app = buildApp(forbid)
    expect((await supertest(app).get('/admin/relays')).status).toBe(403)
    expect((await supertest(app).post('/admin/relays').send({ url: relayRecord.url })).status).toBe(403)
    expect((await supertest(app).delete(`/admin/relays/${relayRecord.id}`)).status).toBe(403)
    expect(relayActions.add).not.toHaveBeenCalled()
  })
})

describe('re-sending post Updates', () => {
  test('POST /federation/resend-post-updates starts a re-send and answers how many posts', async () => {
    const res = await supertest(buildApp()).post('/admin/federation/resend-post-updates')
    expect(res.status).toBe(202)
    expect(res.body).toEqual({ posts: 7, success: true })
  })

  test('409 while a re-send is still running', async () => {
    postUpdates.start.mockResolvedValueOnce(null)
    const res = await supertest(buildApp()).post('/admin/federation/resend-post-updates')
    expect(res.status).toBe(409)
    expect(res.body.success).toBe(false)
  })

  test('non-admins are refused', async () => {
    postUpdates.start.mockClear()
    expect((await supertest(buildApp(forbid)).post('/admin/federation/resend-post-updates')).status).toBe(403)
    expect(postUpdates.start).not.toHaveBeenCalled()
  })
})

describe('public tag pages setting', () => {
  test('GET returns none and the default retention when nothing is set', async () => {
    const res = await supertest(buildApp()).get('/admin/settings')
    expect(res.body.public_tag_pages).toEqual([])
    expect(res.body.public_tag_retention_days).toBe(30)
    expect(res.body.public_tag_follows).toEqual([])
  })

  test('GET reports each configured tag’s follow state', async () => {
    vi.mocked(centralDb.getServerSetting).mockImplementation(async (key) =>
      key === 'public_tag_pages' ? ['aurboda', 'running', 'cycling'] : null,
    )
    vi.mocked(centralDb.listInstanceTagFollows).mockResolvedValueOnce([
      { accepted: true, tag: 'aurboda' },
      { accepted: false, tag: 'running' },
    ] as Awaited<ReturnType<CentralDb['listInstanceTagFollows']>>)
    try {
      const res = await supertest(buildApp()).get('/admin/settings')
      expect(res.body.public_tag_follows).toEqual([
        { state: 'accepted', tag: 'aurboda' },
        { state: 'pending', tag: 'running' },
        { state: 'unresolved', tag: 'cycling' },
      ])
    } finally {
      vi.mocked(centralDb.getServerSetting).mockReset().mockResolvedValue(null)
    }
  })

  test('PATCH stores normalised tags, then applies the stored tags', async () => {
    vi.mocked(centralDb.setServerSetting).mockClear()
    publicTagActions.apply.mockClear()
    vi.mocked(centralDb.getServerSetting).mockImplementation(async (key) =>
      key === 'public_tag_pages' ? ['aurboda', 'running'] : null,
    )
    try {
      const res = await supertest(buildApp())
        .patch('/admin/settings')
        .send({ public_tag_pages: ['#Aurboda', 'aurboda', 'Running'], public_tag_retention_days: 14 })
      expect(res.status).toBe(200)
      expect(centralDb.setServerSetting).toHaveBeenCalledWith('public_tag_pages', ['aurboda', 'running'])
      expect(centralDb.setServerSetting).toHaveBeenCalledWith('public_tag_retention_days', 14)
      expect(publicTagActions.apply).toHaveBeenCalledWith(['aurboda', 'running'])
    } finally {
      vi.mocked(centralDb.getServerSetting).mockReset().mockResolvedValue(null)
    }
  })

  test('PATCH of the tag actor host alone re-applies the stored tags; retention alone does not', async () => {
    publicTagActions.apply.mockClear()
    vi.mocked(centralDb.getServerSetting).mockImplementation(async (key) =>
      key === 'public_tag_pages' ? ['aurboda'] : null,
    )
    try {
      await supertest(buildApp()).patch('/admin/settings').send({ public_tag_retention_days: 10 })
      expect(publicTagActions.apply).not.toHaveBeenCalled()
      await supertest(buildApp()).patch('/admin/settings').send({ tag_actor_host: 'tags.other' })
      expect(publicTagActions.apply).toHaveBeenCalledWith(['aurboda'])
    } finally {
      vi.mocked(centralDb.getServerSetting).mockReset().mockResolvedValue(null)
    }
  })

  test('a failure to follow the tag actors does not fail the save', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    publicTagActions.apply.mockRejectedValueOnce(new Error('federation down'))
    const res = await supertest(buildApp())
      .patch('/admin/settings')
      .send({ public_tag_pages: ['aurboda'] })
    expect(res.status).toBe(200)
    error.mockRestore()
  })

  test('PATCH rejects an invalid tag, more than 20 tags and an out-of-range retention', async () => {
    const app = buildApp()
    expect(
      (
        await supertest(app)
          .patch('/admin/settings')
          .send({ public_tag_pages: ['not a tag'] })
      ).status,
    ).toBe(400)
    const many = Array.from({ length: 21 }, (_, i) => `t${i}`)
    expect((await supertest(app).patch('/admin/settings').send({ public_tag_pages: many })).status).toBe(400)
    expect(
      (await supertest(app).patch('/admin/settings').send({ public_tag_retention_days: 0 })).status,
    ).toBe(400)
    expect(
      (await supertest(app).patch('/admin/settings').send({ public_tag_retention_days: 366 })).status,
    ).toBe(400)
  })
})
