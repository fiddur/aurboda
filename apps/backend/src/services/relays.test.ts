import { Application, Follow, Undo } from '@fedify/fedify/vocab'
import { describe, expect, test, vi } from 'vitest'

import type { ServerSettings } from './central-db.ts'
import type { RelayInput, RelayRecord } from './central-relays.ts'

import {
  addRelay,
  type AddRelayResult,
  createRelayInboxHooks,
  ensureDefaultRelays,
  isPublicHttpsOrigin,
  isRelaySender,
  parseRelayUrl,
  type RelayDeps,
  relayFollow,
  relayRecipient,
  relayRecipients,
  type RelayStore,
  removeRelay,
  serializeRelay,
  TAGS_PUB_RELAY,
} from './relays.ts'

const ORIGIN = 'https://aurboda.example'
const INSTANCE = new URL(`${ORIGIN}/actor`)
const PUBLIC = 'https://www.w3.org/ns/activitystreams#Public'
const TAGS_RELAY = 'https://tags.pub/user/_____relay_____/inbox'
const LITE_ACTOR = 'https://lite.example/relay'

const memoryStore = (): RelayStore & { rows: Map<string, RelayRecord> } => {
  const rows = new Map<string, RelayRecord>()
  const find = (pred: (r: RelayRecord) => boolean) => [...rows.values()].find(pred) ?? null
  return {
    deleteRelay: async (id) => rows.delete(id),
    getRelay: async (id) => rows.get(id) ?? null,
    getRelayByActorUri: async (uri) => find((r) => r.actor_uri === uri),
    getRelayByFollowActivityId: async (id) => find((r) => r.follow_activity_id === id),
    getRelayByUrl: async (url) => find((r) => r.url === url),
    insertRelay: async (input: RelayInput) => {
      const now = new Date('2026-11-10T00:00:00Z')
      const row: RelayRecord = {
        ...input,
        created_at: now,
        last_error: null,
        state: 'pending',
        updated_at: now,
      }
      rows.set(input.id, row)
      return row
    },
    listAcceptedRelays: async () => [...rows.values()].filter((r) => r.state === 'accepted'),
    listRelays: async () => [...rows.values()],
    rows,
    setRelayError: async (id, lastError) => {
      const row = rows.get(id)
      if (row == null) return null
      const next = { ...row, last_error: lastError }
      rows.set(id, next)
      return next
    },
    setRelayState: async (id, state, fields = {}) => {
      const row = rows.get(id)
      if (row == null) return null
      const next = { ...row, ...fields, state }
      rows.set(id, next)
      return next
    },
  }
}

const fakeDeps = (overrides: { sendActivity?: unknown; lookupObject?: unknown } = {}) => {
  const sendActivity = vi.fn().mockResolvedValue(undefined)
  const lookupObject = vi
    .fn()
    .mockResolvedValue(new Application({ id: new URL(LITE_ACTOR), inbox: new URL(`${LITE_ACTOR}/inbox`) }))
  const ctx = {
    getActorUri: () => INSTANCE,
    getDocumentLoader: async () => async () => ({}),
    lookupObject,
    sendActivity,
    ...overrides,
  }
  const store = memoryStore()
  const deps: RelayDeps = {
    assertPublic: async () => {},
    federation: { createContext: async () => ctx } as unknown as RelayDeps['federation'],
    origin: ORIGIN,
    store,
  }
  return { ctx, deps, lookupObject, sendActivity, store }
}

describe('parseRelayUrl', () => {
  test('accepts https and drops the fragment', () => {
    expect(parseRelayUrl(` ${TAGS_RELAY}#x `)).toEqual({ ok: true, url: TAGS_RELAY })
  })

  test.each(['http://relay.example/inbox', 'not a url', 'https://user:pw@relay.example/inbox'])(
    'refuses %s',
    (raw) => {
      expect(parseRelayUrl(raw).ok).toBe(false)
    },
  )
})

describe('relay activities', () => {
  test('a mastodon relay is sent a Follow of the Public collection; a litepub one, of its actor', () => {
    const mastodon = relayFollow(INSTANCE, ORIGIN, { actor_uri: null, id: 'r1', style: 'mastodon' })
    expect(mastodon.objectId?.href).toBe(PUBLIC)
    expect(mastodon.id?.href).toBe(`${ORIGIN}/actor/follows/r1`)
    expect(mastodon.actorId?.href).toBe(INSTANCE.href)

    const litepub = relayFollow(INSTANCE, ORIGIN, { actor_uri: LITE_ACTOR, id: 'r2', style: 'litepub' })
    expect(litepub.objectId?.href).toBe(LITE_ACTOR)
  })

  test('the recipient stands in with the inbox until the actor is known', () => {
    expect(relayRecipient({ actor_uri: null, inbox_uri: TAGS_RELAY }).id.href).toBe(TAGS_RELAY)
    expect(relayRecipient({ actor_uri: LITE_ACTOR, inbox_uri: `${LITE_ACTOR}/inbox` })).toEqual({
      id: new URL(LITE_ACTOR),
      inboxId: new URL(`${LITE_ACTOR}/inbox`),
    })
  })

  test('relayRecipients lists the accepted relays only', async () => {
    const store = memoryStore()
    await store.insertRelay({
      actor_uri: null,
      follow_activity_id: 'f1',
      id: 'a',
      inbox_uri: TAGS_RELAY,
      style: 'mastodon',
      url: TAGS_RELAY,
    })
    expect(await relayRecipients(store)).toEqual([])
    await store.setRelayState('a', 'accepted', { actor_uri: 'https://tags.pub/user/_____relay_____' })
    expect((await relayRecipients(store)).map((r) => r.inboxId.href)).toEqual([TAGS_RELAY])
  })

  test('serializeRelay renders dates as ISO strings', () => {
    const now = new Date('2026-11-10T00:00:00Z')
    expect(
      serializeRelay({
        actor_uri: null,
        created_at: now,
        follow_activity_id: 'f',
        id: 'a',
        inbox_uri: TAGS_RELAY,
        last_error: null,
        state: 'pending',
        style: 'mastodon',
        updated_at: now,
        url: TAGS_RELAY,
      }),
    ).toEqual({
      actor_uri: null,
      created_at: '2026-11-10T00:00:00.000Z',
      id: 'a',
      inbox_uri: TAGS_RELAY,
      last_error: null,
      state: 'pending',
      style: 'mastodon',
      updated_at: '2026-11-10T00:00:00.000Z',
      url: TAGS_RELAY,
    })
  })
})

describe('addRelay', () => {
  test('a mastodon relay is stored pending and sent a Follow signed by the instance actor', async () => {
    const { deps, sendActivity, store } = fakeDeps()
    const result = await addRelay(deps, { style: 'mastodon', url: TAGS_RELAY })
    if (!result.ok) throw new Error(result.error)
    expect(result.record).toMatchObject({ actor_uri: null, inbox_uri: TAGS_RELAY, state: 'pending' })
    expect(result.record.follow_activity_id).toBe(`${ORIGIN}/actor/follows/${result.record.id}`)
    expect(store.rows.size).toBe(1)
    const [sender, recipient, follow] = sendActivity.mock.calls[0]
    expect(sender).toEqual({ identifier: '~actor' })
    expect(recipient.inboxId.href).toBe(TAGS_RELAY)
    expect(follow).toBeInstanceOf(Follow)
    expect(follow.id.href).toBe(result.record.follow_activity_id)
  })

  test('a litepub relay is resolved for its actor and inbox', async () => {
    const { deps, lookupObject, sendActivity } = fakeDeps()
    const result = await addRelay(deps, { style: 'litepub', url: LITE_ACTOR })
    if (!result.ok) throw new Error(result.error)
    expect(lookupObject).toHaveBeenCalledWith(LITE_ACTOR, expect.anything())
    expect(result.record).toMatchObject({ actor_uri: LITE_ACTOR, inbox_uri: `${LITE_ACTOR}/inbox` })
    expect(sendActivity.mock.calls[0][2].objectId.href).toBe(LITE_ACTOR)
  })

  test('an unresolvable litepub relay is a 422 and stores nothing', async () => {
    const { deps, store } = fakeDeps({ lookupObject: vi.fn().mockResolvedValue(null) })
    expect(await addRelay(deps, { style: 'litepub', url: LITE_ACTOR })).toMatchObject({
      ok: false,
      status: 422,
    })
    expect(store.rows.size).toBe(0)
  })

  test('a bad or private URL is a 400; a duplicate a 409', async () => {
    const { deps } = fakeDeps()
    expect(await addRelay(deps, { style: 'mastodon', url: 'http://relay.example/inbox' })).toMatchObject({
      status: 400,
    })
    const guarded = {
      ...deps,
      assertPublic: async () => {
        throw new Error('private address')
      },
    }
    expect(await addRelay(guarded, { style: 'mastodon', url: 'https://10.0.0.1/inbox' })).toMatchObject({
      status: 400,
    })
    expect((await addRelay(deps, { style: 'mastodon', url: TAGS_RELAY })).ok).toBe(true)
    expect(await addRelay(deps, { style: 'mastodon', url: TAGS_RELAY })).toMatchObject({ status: 409 })
  })

  test('a failed Follow delivery records the error without rewriting the state', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { deps, store } = fakeDeps({
      sendActivity: vi.fn().mockRejectedValue(new Error('connection refused')),
    })
    const setRelayState = vi.spyOn(store, 'setRelayState')
    const result = await addRelay(deps, { style: 'mastodon', url: TAGS_RELAY })
    expect(result).toMatchObject({ ok: true, record: { last_error: 'connection refused', state: 'pending' } })
    expect(setRelayState).not.toHaveBeenCalled()
    error.mockRestore()
  })

  test.each(['http://127.0.0.1/inbox', 'https://user:pw@lite.example/inbox'])(
    'a litepub actor whose inbox is %s is a 422 and stores nothing',
    async (inbox) => {
      const { deps, store } = fakeDeps({
        lookupObject: vi
          .fn()
          .mockResolvedValue(new Application({ id: new URL(LITE_ACTOR), inbox: new URL(inbox) })),
      })
      expect(await addRelay(deps, { style: 'litepub', url: LITE_ACTOR })).toEqual({
        error: "The relay actor's inbox is not a public https URL.",
        ok: false,
        status: 422,
      })
      expect(store.rows.size).toBe(0)
    },
  )

  test('a litepub actor whose https inbox resolves privately is a 422', async () => {
    const { deps, store } = fakeDeps()
    const guarded: RelayDeps = {
      ...deps,
      assertPublic: async (url) => {
        if (url.startsWith(`${LITE_ACTOR}/inbox`)) throw new Error('private address')
      },
    }
    expect(await addRelay(guarded, { style: 'litepub', url: LITE_ACTOR })).toMatchObject({ status: 422 })
    expect(store.rows.size).toBe(0)
  })
})

describe('removeRelay', () => {
  test('sends Undo of the same Follow and deletes the row, even when the Undo fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { deps, sendActivity, store } = fakeDeps()
    const added = await addRelay(deps, { style: 'mastodon', url: TAGS_RELAY })
    if (!added.ok) throw new Error(added.error)
    sendActivity.mockRejectedValueOnce(new Error('gone'))
    expect(await removeRelay(deps, added.record.id)).toBe(true)
    const undo = sendActivity.mock.calls[1][2]
    expect(undo).toBeInstanceOf(Undo)
    expect(undo.objectId.href).toBe(added.record.follow_activity_id)
    expect(store.rows.size).toBe(0)
    expect(await removeRelay(deps, added.record.id)).toBe(false)
    expect(await removeRelay(deps, 'not-a-uuid')).toBe(false)
    error.mockRestore()
  })
})

describe('relay inbox hooks', () => {
  const pendingMastodon = async (store: RelayStore) =>
    store.insertRelay({
      actor_uri: null,
      follow_activity_id: `${ORIGIN}/actor/follows/a`,
      id: 'a',
      inbox_uri: TAGS_RELAY,
      style: 'mastodon',
      url: TAGS_RELAY,
    })

  test('an Accept from the relay host marks it accepted and records the actor', async () => {
    const store = memoryStore()
    const relay = await pendingMastodon(store)
    const hooks = createRelayInboxHooks(store)
    expect(await hooks.onAccept(relay.follow_activity_id, 'https://tags.pub/user/_____relay_____')).toBe(true)
    expect(store.rows.get('a')).toMatchObject({
      actor_uri: 'https://tags.pub/user/_____relay_____',
      state: 'accepted',
    })
    expect(await hooks.isRelayActor('https://tags.pub/user/_____relay_____')).toBe(true)
    expect(await hooks.isRelayActor('https://other.example/actor')).toBe(false)
    await store.setRelayState('a', 'rejected')
    expect(await hooks.isRelayActor('https://tags.pub/user/_____relay_____')).toBe(false)
  })

  test('an Accept from another host is consumed but changes nothing', async () => {
    const store = memoryStore()
    const relay = await pendingMastodon(store)
    const hooks = createRelayInboxHooks(store)
    expect(await hooks.onAccept(relay.follow_activity_id, 'https://evil.example/actor')).toBe(true)
    expect(store.rows.get('a')?.state).toBe('pending')
  })

  test('a Reject marks it rejected; an unknown follow id is not ours', async () => {
    const store = memoryStore()
    const relay = await pendingMastodon(store)
    const hooks = createRelayInboxHooks(store)
    expect(await hooks.onReject(relay.follow_activity_id, 'https://tags.pub/actor')).toBe(true)
    expect(store.rows.get('a')?.state).toBe('rejected')
    expect(await hooks.onAccept(`${ORIGIN}/users/alice/follows/x`, 'https://tags.pub/actor')).toBe(false)
  })

  test('isRelaySender pins a known actor', () => {
    expect(isRelaySender({ actor_uri: LITE_ACTOR, inbox_uri: `${LITE_ACTOR}/inbox` }, LITE_ACTOR)).toBe(true)
    expect(
      isRelaySender({ actor_uri: LITE_ACTOR, inbox_uri: `${LITE_ACTOR}/inbox` }, 'https://lite.example/x'),
    ).toBe(false)
    expect(isRelaySender({ actor_uri: null, inbox_uri: TAGS_RELAY }, null)).toBe(false)
  })
})

describe('isPublicHttpsOrigin', () => {
  test.each([
    ['https://aurboda.net', true],
    ['https://aurboda.example:8443', true],
    ['http://aurboda.net', false],
    ['https://localhost', false],
    ['https://localhost:5173', false],
    ['https://foo.localhost', false],
    ['https://127.0.0.1', false],
    ['http://127.0.0.1:8080', false],
    ['https://[::1]', false],
    ['not a url', false],
  ])('%s → %s', (origin, expected) => {
    expect(isPublicHttpsOrigin(origin)).toBe(expected)
  })
})

describe('ensureDefaultRelays', () => {
  const fakeCentralDb = (initial: Partial<ServerSettings> = {}, failRead = false) => {
    const values: Partial<ServerSettings> = { ...initial }
    return {
      getServerSetting: async <K extends keyof ServerSettings>(key: K) => {
        if (failRead) throw new Error('no db')
        return values[key] ?? null
      },
      setServerSetting: async <K extends keyof ServerSettings>(key: K, value: ServerSettings[K]) => {
        values[key] = value
      },
      values,
    }
  }
  const okResult = (url: string): AddRelayResult => ({
    ok: true,
    record: {
      actor_uri: null,
      created_at: new Date(),
      follow_activity_id: `${ORIGIN}/actor/follows/a`,
      id: 'a',
      inbox_uri: url,
      last_error: null,
      state: 'pending',
      style: 'mastodon',
      updated_at: new Date(),
      url,
    },
  })
  const run = (
    centralDb: ReturnType<typeof fakeCentralDb>,
    add: (input: { url: string; style: 'litepub' | 'mastodon' }) => Promise<AddRelayResult>,
    origin = ORIGIN,
  ) => {
    const log = vi.fn()
    return { log, outcome: ensureDefaultRelays({ add, centralDb, log, origin }) }
  }

  test('seeds the tags.pub relay, Mastodon style, on an https origin and marks the server', async () => {
    const centralDb = fakeCentralDb()
    const add = vi.fn(async (input: { url: string }) => okResult(input.url))
    expect(await run(centralDb, add).outcome).toBe('seeded')
    expect(add).toHaveBeenCalledWith({ style: 'mastodon', url: TAGS_RELAY })
    expect(TAGS_PUB_RELAY.url).toBe(TAGS_RELAY)
    expect(centralDb.values.default_relays_seeded).toBe(true)
  })

  test('an already added relay (409) counts as done', async () => {
    const centralDb = fakeCentralDb()
    const add = vi.fn(
      async (): Promise<AddRelayResult> => ({
        error: 'That relay is already added.',
        ok: false,
        status: 409,
      }),
    )
    expect(await run(centralDb, add).outcome).toBe('seeded')
    expect(centralDb.values.default_relays_seeded).toBe(true)
  })

  test.each([400, 422])('a %i leaves the server unmarked for the next startup', async (status) => {
    const centralDb = fakeCentralDb()
    const add = vi.fn(async (): Promise<AddRelayResult> => ({ error: 'nope', ok: false, status }))
    const { log, outcome } = run(centralDb, add)
    expect(await outcome).toBe('failed')
    expect(centralDb.values.default_relays_seeded).toBeUndefined()
    expect(log).toHaveBeenCalledOnce()
  })

  test('a thrown add leaves the server unmarked and does not throw', async () => {
    const centralDb = fakeCentralDb()
    const add = vi.fn(async (): Promise<AddRelayResult> => {
      throw new Error('database down')
    })
    const { log, outcome } = run(centralDb, add)
    expect(await outcome).toBe('failed')
    expect(centralDb.values.default_relays_seeded).toBeUndefined()
    expect(log).toHaveBeenCalledWith(expect.stringContaining('database down'))
  })

  test('a failing setting read does not throw', async () => {
    const centralDb = fakeCentralDb({}, true)
    const add = vi.fn(async (input: { url: string }) => okResult(input.url))
    expect(await run(centralDb, add).outcome).toBe('failed')
    expect(add).not.toHaveBeenCalled()
  })

  test('a hung add times out and leaves the server unmarked', async () => {
    const centralDb = fakeCentralDb()
    const add = vi.fn(() => new Promise<AddRelayResult>(() => {}))
    const log = vi.fn()
    const outcome = await ensureDefaultRelays({ add, centralDb, log, origin: ORIGIN, timeoutMs: 5 })
    expect(outcome).toBe('failed')
    expect(centralDb.values.default_relays_seeded).toBeUndefined()
  })

  test('an already seeded server never adds', async () => {
    const centralDb = fakeCentralDb({ default_relays_seeded: true })
    const add = vi.fn(async (input: { url: string }) => okResult(input.url))
    expect(await run(centralDb, add).outcome).toBe('already')
    expect(add).not.toHaveBeenCalled()
  })

  test.each([
    'http://aurboda.example',
    'https://localhost',
    'https://foo.localhost',
    'http://127.0.0.1:8080',
  ])('skips %s without marking it', async (origin) => {
    const centralDb = fakeCentralDb()
    const add = vi.fn(async (input: { url: string }) => okResult(input.url))
    expect(await run(centralDb, add, origin).outcome).toBe('skipped')
    expect(add).not.toHaveBeenCalled()
    expect(centralDb.values.default_relays_seeded).toBeUndefined()
  })
})
