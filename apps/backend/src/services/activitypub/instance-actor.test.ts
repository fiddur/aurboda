import { Accept, Application, Follow, Reject } from '@fedify/fedify/vocab'
import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, test, vi } from 'vitest'

import { actorDocument, inboxContext } from '../../test/inbox-context.ts'
import { createFeedFederation, handleInboundFollow } from './federation.ts'
import {
  handleRelayResponse,
  handleTagFollowResponse,
  INSTANCE_ACTOR_ID,
  instanceActorFollowId,
  instanceTagFollowId,
  type RelayInboxHooks,
  type TagFollowInboxHooks,
} from './instance-actor.ts'

const ORIGIN = 'https://aurboda.example'
const RELAY_ACTOR = 'https://relay.example/actor'

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
  publicKeyEncoding: { format: 'pem', type: 'spki' },
})

const hooks = (overrides: Partial<RelayInboxHooks> = {}): RelayInboxHooks => ({
  isRelayActor: vi.fn(async (uri: string) => uri === RELAY_ACTOR),
  onAccept: vi.fn(async () => false),
  onReject: vi.fn(async () => false),
  ...overrides,
})

const federationWith = (relays: RelayInboxHooks = hooks()) =>
  createFeedFederation(
    ORIGIN,
    `${ORIGIN}/api`,
    undefined,
    undefined,
    'dev',
    undefined,
    undefined,
    undefined,
    {
      instanceKeys: async () => ({ private_key_pem: privateKey, public_key_pem: publicKey }),
      relays,
    },
  )

const fetchActor = (federation: ReturnType<typeof createFeedFederation>) =>
  federation.fetch(new Request(`${ORIGIN}/actor`, { headers: { accept: 'application/activity+json' } }), {
    contextData: undefined,
  })

describe('instance actor document', () => {
  test('is an Application at /actor named after the host', async () => {
    const federation = federationWith()
    expect(federation.createContext(new URL(ORIGIN)).getActorUri(INSTANCE_ACTOR_ID).href).toBe(
      `${ORIGIN}/actor`,
    )
    const res = await fetchActor(federation)
    expect(res.status).toBe(200)
    const actor = await Application.fromJsonLd(await res.json())
    expect(actor.id?.href).toBe(`${ORIGIN}/actor`)
    expect(actor.preferredUsername?.toString()).toBe('aurboda.example')
    expect(actor.name?.toString()).toBe('Aurboda at aurboda.example')
    expect(actor.inboxId?.href).toBe(`${ORIGIN}/users/~actor/inbox`)
    expect(actor.endpoints?.sharedInbox?.href).toBe(`${ORIGIN}/inbox`)
    expect(actor.url?.toString()).toBe(new URL(ORIGIN).href)
    expect(actor.manuallyApprovesFollowers).toBeNull()
    expect(actor.publicKeyId?.href).toContain(`${ORIGIN}/actor`)
  })

  test('is served at /actor and found by WebFinger as host@host', async () => {
    const federation = federationWith()
    const res = await fetchActor(federation)
    expect(res.status).toBe(200)
    const doc = (await res.json()) as Record<string, unknown>
    expect(doc.type).toBe('Application')

    const finger = await federation.fetch(
      new Request(`${ORIGIN}/.well-known/webfinger?resource=acct:aurboda.example@aurboda.example`),
      { contextData: undefined },
    )
    expect(finger.status).toBe(200)
    const jrd = (await finger.json()) as { links: { rel: string; href?: string }[] }
    expect(jrd.links.find((l) => l.rel === 'self')?.href).toBe(`${ORIGIN}/actor`)
  })

  test('reads the stored key pair once, and again after a failed read', async () => {
    const instanceKeys = vi
      .fn()
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValue({ private_key_pem: privateKey, public_key_pem: publicKey })
    const federation = createFeedFederation(
      ORIGIN,
      `${ORIGIN}/api`,
      undefined,
      undefined,
      'dev',
      undefined,
      undefined,
      undefined,
      { instanceKeys, relays: hooks() },
    )
    const ctx = federation.createContext(new URL(ORIGIN))
    expect(await ctx.getActorKeyPairs(INSTANCE_ACTOR_ID).catch(() => [])).toEqual([])
    expect(await ctx.getActorKeyPairs(INSTANCE_ACTOR_ID)).toHaveLength(1)
    expect(await ctx.getActorKeyPairs(INSTANCE_ACTOR_ID)).toHaveLength(1)
    expect(instanceKeys).toHaveBeenCalledTimes(2)
  })

  test('does not exist without the instance dependencies', async () => {
    const res = await fetchActor(createFeedFederation(ORIGIN, `${ORIGIN}/api`))
    expect(res.status).toBe(404)
  })

  test('the follow id hangs off the actor path', () => {
    expect(instanceActorFollowId(`${ORIGIN}/`, 'abc').href).toBe(`${ORIGIN}/actor/follows/abc`)
  })
})

describe('relay responses', () => {
  const followId = instanceActorFollowId(ORIGIN, '11111111-1111-4111-8111-111111111111')

  test('an Accept of a relay follow is handed to the relay hooks by the Follow id', async () => {
    const relays = hooks({ onAccept: vi.fn(async () => true) })
    const embedded = new Accept({
      actor: new URL(RELAY_ACTOR),
      object: new Follow({ actor: new URL(`${ORIGIN}/actor`), id: followId }),
    })
    expect(await handleRelayResponse(embedded, relays)).toBe(true)
    expect(relays.onAccept).toHaveBeenCalledWith(followId.href, RELAY_ACTOR)

    const byId = new Accept({ actor: new URL(RELAY_ACTOR), object: followId })
    expect(await handleRelayResponse(byId, relays)).toBe(true)
  })

  test('a Reject goes to onReject; an unknown follow falls through', async () => {
    const relays = hooks({ onReject: vi.fn(async () => true) })
    expect(
      await handleRelayResponse(new Reject({ actor: new URL(RELAY_ACTOR), object: followId }), relays),
    ).toBe(true)
    expect(relays.onReject).toHaveBeenCalledWith(followId.href, RELAY_ACTOR)

    const other = new Accept({
      actor: new URL(RELAY_ACTOR),
      object: new URL(`${ORIGIN}/users/alice/follows/x`),
    })
    expect(await handleRelayResponse(other, hooks())).toBe(false)
    expect(await handleRelayResponse(other, undefined)).toBe(false)
  })
})

describe('a Follow of the instance actor', () => {
  const docs = { [RELAY_ACTOR]: actorDocument(RELAY_ACTOR, 'relay', 'Relay') }

  const followOf = (actor: string) =>
    new Follow({
      actor: new URL(actor),
      id: new URL(`${actor}#follow/1`),
      object: new URL(`${ORIGIN}/actor`),
    })

  test('from an added relay is accepted, signed as the instance actor', async () => {
    const relays = hooks()
    const ctx = inboxContext(federationWith(relays), ORIGIN, INSTANCE_ACTOR_ID, docs)
    const sendActivity = vi.fn().mockResolvedValue(undefined)
    Object.assign(ctx, { sendActivity })
    await handleInboundFollow(ctx, followOf(RELAY_ACTOR), relays)
    expect(sendActivity).toHaveBeenCalledTimes(1)
    const [sender, recipient, accept] = sendActivity.mock.calls[0]
    expect(sender).toEqual({ identifier: INSTANCE_ACTOR_ID })
    expect(recipient.id.href).toBe(RELAY_ACTOR)
    expect(accept).toBeInstanceOf(Accept)
    expect(accept.actorId.href).toBe(`${ORIGIN}/actor`)
  })

  test('from anyone else is ignored', async () => {
    const stranger = 'https://stranger.example/users/eve'
    const relays = hooks()
    const ctx = inboxContext(federationWith(relays), ORIGIN, INSTANCE_ACTOR_ID, {
      [stranger]: actorDocument(stranger, 'eve', 'Eve'),
    })
    const sendActivity = vi.fn().mockResolvedValue(undefined)
    Object.assign(ctx, { sendActivity })
    await handleInboundFollow(ctx, followOf(stranger), relays)
    await handleInboundFollow(ctx, followOf(RELAY_ACTOR), undefined)
    expect(sendActivity).not.toHaveBeenCalled()
  })
})

describe('tag follow responses', () => {
  const followId = instanceTagFollowId(ORIGIN, 'aurboda', '22222222-2222-4222-8222-222222222222')
  const TAG_ACTOR = 'https://tags.example/user/aurboda'
  const tagHooks = (): TagFollowInboxHooks => ({
    onAccept: vi.fn(async () => true),
    onReject: vi.fn(async () => true),
  })

  test('the tag follow id never collides with a relay follow id', () => {
    expect(followId.href).toBe(`${ORIGIN}/actor/follows/tags/aurboda/22222222-2222-4222-8222-222222222222`)
  })

  test('an Accept or Reject is handed to the tag follow hooks by the Follow id', async () => {
    const tagFollows = tagHooks()
    expect(
      await handleTagFollowResponse(new Accept({ actor: new URL(TAG_ACTOR), object: followId }), tagFollows),
    ).toBe(true)
    expect(tagFollows.onAccept).toHaveBeenCalledWith(followId.href, TAG_ACTOR)
    expect(
      await handleTagFollowResponse(new Reject({ actor: new URL(TAG_ACTOR), object: followId }), tagFollows),
    ).toBe(true)
    expect(tagFollows.onReject).toHaveBeenCalledWith(followId.href, TAG_ACTOR)
    expect(
      await handleTagFollowResponse(new Accept({ actor: new URL(TAG_ACTOR), object: followId }), undefined),
    ).toBe(false)
  })
})
