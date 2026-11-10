import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { getTestDbClient, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { createRelaysApi, CREATE_INSTANCE_ACTOR_TABLE, CREATE_RELAYS_TABLE } from './central-relays.ts'

const CONTAINER_TIMEOUT = 120_000

const relayInput = (
  url: string,
  overrides: Partial<{ style: 'mastodon' | 'litepub'; actor_uri: string }> = {},
) => {
  const id = randomUUID()
  return {
    actor_uri: overrides.actor_uri ?? null,
    follow_activity_id: `https://aurboda.test/actor/follows/${id}`,
    id,
    inbox_uri: url,
    style: overrides.style ?? 'mastodon',
    url,
  }
}

describe('central relays', () => {
  beforeAll(async () => {
    await startTestDb()
    const client = getTestDbClient()
    await client.query(CREATE_INSTANCE_ACTOR_TABLE)
    await client.query(CREATE_RELAYS_TABLE)
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await getTestDbClient().query('TRUNCATE TABLE relays, instance_actor')
  })

  const api = () => createRelaysApi(async () => getTestDbClient())

  test('the instance key pair is created once and then reused', async () => {
    const a = api()
    const [first, concurrent] = await Promise.all([
      a.getOrCreateInstanceActorKeyPair(),
      a.getOrCreateInstanceActorKeyPair(),
    ])
    expect(first.private_key_pem).toContain('BEGIN PRIVATE KEY')
    expect(first.public_key_pem).toContain('BEGIN PUBLIC KEY')
    expect(concurrent.public_key_pem).toBe(first.public_key_pem)
    expect((await a.getOrCreateInstanceActorKeyPair()).public_key_pem).toBe(first.public_key_pem)
  })

  test('insert, look up by every key, and list', async () => {
    const a = api()
    const mastodon = await a.insertRelay(relayInput('https://relay.example/inbox'))
    expect(mastodon.state).toBe('pending')
    expect(mastodon.actor_uri).toBeNull()
    expect(mastodon.last_error).toBeNull()
    const litepub = await a.insertRelay(
      relayInput('https://lite.example/relay', { actor_uri: 'https://lite.example/relay', style: 'litepub' }),
    )

    expect((await a.getRelay(mastodon.id))?.url).toBe('https://relay.example/inbox')
    expect(await a.getRelay(randomUUID())).toBeNull()
    expect((await a.getRelayByUrl('https://lite.example/relay'))?.id).toBe(litepub.id)
    expect(await a.getRelayByUrl('https://nope.example/inbox')).toBeNull()
    expect((await a.getRelayByFollowActivityId(mastodon.follow_activity_id))?.id).toBe(mastodon.id)
    expect((await a.getRelayByActorUri('https://lite.example/relay'))?.id).toBe(litepub.id)
    expect(await a.getRelayByActorUri('https://relay.example/actor')).toBeNull()
    expect((await a.listRelays()).map((r) => r.id)).toEqual([mastodon.id, litepub.id])
    expect(await a.listAcceptedRelays()).toEqual([])
  })

  test('a url is added once', async () => {
    const a = api()
    await a.insertRelay(relayInput('https://relay.example/inbox'))
    await expect(a.insertRelay(relayInput('https://relay.example/inbox'))).rejects.toThrow()
  })

  test('setRelayState moves the state and only touches the fields it is given', async () => {
    const a = api()
    const relay = await a.insertRelay(relayInput('https://relay.example/inbox'))

    const failed = await a.setRelayState(relay.id, 'pending', { last_error: 'connection refused' })
    expect(failed?.last_error).toBe('connection refused')

    const accepted = await a.setRelayState(relay.id, 'accepted', { actor_uri: 'https://relay.example/actor' })
    expect(accepted?.state).toBe('accepted')
    expect(accepted?.actor_uri).toBe('https://relay.example/actor')
    expect(accepted?.last_error).toBe('connection refused')
    expect((await a.listAcceptedRelays()).map((r) => r.id)).toEqual([relay.id])

    const rejected = await a.setRelayState(relay.id, 'rejected', { last_error: null })
    expect(rejected?.state).toBe('rejected')
    expect(rejected?.actor_uri).toBe('https://relay.example/actor')
    expect(rejected?.last_error).toBeNull()
    expect(await a.listAcceptedRelays()).toEqual([])

    expect(await a.setRelayState(randomUUID(), 'accepted')).toBeNull()
  })

  test('setRelayError records the error and leaves an Accept that landed meanwhile alone', async () => {
    const a = api()
    const relay = await a.insertRelay(relayInput('https://relay.example/inbox'))
    await a.setRelayState(relay.id, 'accepted', { actor_uri: 'https://relay.example/actor' })

    const errored = await a.setRelayError(relay.id, 'connection reset')
    expect(errored?.last_error).toBe('connection reset')
    expect(errored?.state).toBe('accepted')
    expect(errored?.actor_uri).toBe('https://relay.example/actor')
    expect(errored?.updated_at.getTime() ?? 0).toBeGreaterThanOrEqual(relay.updated_at.getTime())
    expect(await a.setRelayError(randomUUID(), 'nope')).toBeNull()
  })

  test('deleteRelay removes the row once', async () => {
    const a = api()
    const relay = await a.insertRelay(relayInput('https://relay.example/inbox'))
    expect(await a.deleteRelay(relay.id)).toBe(true)
    expect(await a.deleteRelay(relay.id)).toBe(false)
    expect(await a.listRelays()).toEqual([])
  })
})
