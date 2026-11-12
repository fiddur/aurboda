import type { Relay, RelayStyle } from '@aurboda/api-spec'
/**
 * Relay subscriptions: the instance actor follows a fediverse relay, and once the
 * relay accepts, every local user's public posts are also delivered to it (see
 * `deliver.ts`). Shared by the admin REST routes and the admin MCP tools.
 *
 * Mastodon style: the URL is the relay's inbox, and the Follow's object is the
 * Public collection. LitePub style: the URL is the relay's actor, which is
 * resolved for its inbox and followed directly; it follows back.
 */
import type { Federation } from '@fedify/fedify'

import { Follow, isActor, Undo } from '@fedify/fedify/vocab'
import { randomUUID } from 'node:crypto'

import type { CentralDb } from './central-db.ts'
import type { RelayRecord, RelaysApi } from './central-relays.ts'

import { UUID_RE } from '../utils.ts'
import {
  INSTANCE_ACTOR_ID,
  instanceActorFollowId,
  type RelayInboxHooks,
} from './activitypub/instance-actor.ts'
import { AS_PUBLIC } from './activitypub/object.ts'
import { signedFetchOptions } from './activitypub/signed-lookup.ts'
import { assertPublicUrl } from './safe-fetch.ts'
import { withTimeout } from './with-timeout.ts'

export type RelayStore = Pick<
  RelaysApi,
  | 'deleteRelay'
  | 'getRelay'
  | 'getRelayByActorUri'
  | 'getRelayByFollowActivityId'
  | 'getRelayByUrl'
  | 'insertRelay'
  | 'listAcceptedRelays'
  | 'listRelays'
  | 'setRelayError'
  | 'setRelayState'
>

export interface RelayDeps {
  federation: Federation<void>
  origin: string
  store: RelayStore
  assertPublic?: (url: string) => Promise<void>
}

export type AddRelayResult = { ok: true; record: RelayRecord } | { ok: false; status: number; error: string }

export interface RelayActions {
  list: () => Promise<Relay[]>
  add: (input: { url: string; style: RelayStyle }) => Promise<AddRelayResult>
  remove: (id: string) => Promise<boolean>
}

export interface RelayRecipient {
  id: URL
  inboxId: URL
}

const LOOKUP_TIMEOUT_MS = 10_000
const DEFAULT_RELAYS_TIMEOUT_MS = 30_000

export const TAGS_PUB_RELAY = {
  style: 'mastodon',
  url: 'https://tags.pub/user/_____relay_____/inbox',
} as const

export const DEFAULT_RELAYS: ReadonlyArray<{ url: string; style: RelayStyle }> = [TAGS_PUB_RELAY]

export const serializeRelay = (record: RelayRecord): Relay => ({
  actor_uri: record.actor_uri,
  created_at: record.created_at.toISOString(),
  id: record.id,
  inbox_uri: record.inbox_uri,
  last_error: record.last_error,
  state: record.state,
  style: record.style,
  updated_at: record.updated_at.toISOString(),
  url: record.url,
})

/** The URL as stored, or why it cannot be added: https only. */
export const parseRelayUrl = (raw: string): { ok: true; url: string } | { ok: false; error: string } => {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return { error: 'Not a valid URL.', ok: false }
  }
  if (url.protocol !== 'https:') return { error: 'A relay URL must be https.', ok: false }
  if (url.username !== '' || url.password !== '') {
    return { error: 'A relay URL must not carry credentials.', ok: false }
  }
  url.hash = ''
  return { ok: true, url: url.href }
}

/** The Follow the instance actor sends: of the Public collection (mastodon) or of the relay actor (litepub). */
export const relayFollow = (
  actorUri: URL,
  origin: string,
  relay: Pick<RelayRecord, 'actor_uri' | 'id' | 'style'>,
) =>
  new Follow({
    actor: actorUri,
    id: instanceActorFollowId(origin, relay.id),
    object:
      relay.style === 'litepub' && relay.actor_uri != null ? new URL(relay.actor_uri) : new URL(AS_PUBLIC),
  })

export const relayUndo = (
  actorUri: URL,
  origin: string,
  relay: Pick<RelayRecord, 'actor_uri' | 'id' | 'style'>,
) => {
  const follow = relayFollow(actorUri, origin, relay)
  return new Undo({ actor: actorUri, id: new URL(`${follow.id!.href}#undo`), object: follow })
}

/**
 * A Fedify recipient for the relay. Fedify skips a recipient without an id, so a
 * mastodon relay whose actor is not known yet stands in with its inbox URL.
 */
export const relayRecipient = (relay: Pick<RelayRecord, 'actor_uri' | 'inbox_uri'>): RelayRecipient => ({
  id: new URL(relay.actor_uri ?? relay.inbox_uri),
  inboxId: new URL(relay.inbox_uri),
})

export const relayRecipients = async (
  store: Pick<RelayStore, 'listAcceptedRelays'>,
): Promise<RelayRecipient[]> => (await store.listAcceptedRelays()).map(relayRecipient)

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const resolveLitepubRelay = async (
  deps: RelayDeps,
  url: string,
): Promise<{ actor_uri: string; inbox_uri: string } | null> => {
  const ctx = await deps.federation.createContext(new URL(deps.origin))
  const object = await withTimeout(
    signedFetchOptions(ctx, INSTANCE_ACTOR_ID).then((options) => ctx.lookupObject(url, options)),
    LOOKUP_TIMEOUT_MS,
  ).catch(() => null)
  if (!isActor(object) || object.id == null || object.inboxId == null) return null
  return { actor_uri: object.id.href, inbox_uri: object.inboxId.href }
}

const sendFollow = async (deps: RelayDeps, record: RelayRecord): Promise<RelayRecord> => {
  const ctx = await deps.federation.createContext(new URL(deps.origin))
  try {
    await ctx.sendActivity(
      { identifier: INSTANCE_ACTOR_ID },
      relayRecipient(record),
      relayFollow(ctx.getActorUri(INSTANCE_ACTOR_ID), deps.origin, record),
    )
    return record
  } catch (error) {
    console.error(`⚠️ Relay Follow delivery failed → ${record.inbox_uri}:`, error)
    return (await deps.store.setRelayError(record.id, errorMessage(error))) ?? record
  }
}

/**
 * Validate, store as pending, and send the Follow. A delivery failure keeps the
 * row pending with `last_error`; removing and adding it again retries.
 */
export const addRelay = async (
  deps: RelayDeps,
  input: { url: string; style: RelayStyle },
): Promise<AddRelayResult> => {
  const parsed = parseRelayUrl(input.url)
  if (!parsed.ok) return { error: parsed.error, ok: false, status: 400 }
  const { url } = parsed
  try {
    await (deps.assertPublic ?? assertPublicUrl)(url)
  } catch (error) {
    return { error: `Refusing the relay URL: ${errorMessage(error)}`, ok: false, status: 400 }
  }
  if ((await deps.store.getRelayByUrl(url)) != null) {
    return { error: 'That relay is already added.', ok: false, status: 409 }
  }

  let addressing = { actor_uri: null as string | null, inbox_uri: url }
  if (input.style === 'litepub') {
    const resolved = await resolveLitepubRelay(deps, url)
    if (resolved == null) {
      return { error: `Could not resolve a relay actor at ${url}.`, ok: false, status: 422 }
    }
    const inbox = parseRelayUrl(resolved.inbox_uri)
    const inboxPublic =
      inbox.ok &&
      (await (deps.assertPublic ?? assertPublicUrl)(inbox.url).then(
        () => true,
        () => false,
      ))
    if (!inbox.ok || !inboxPublic) {
      return { error: "The relay actor's inbox is not a public https URL.", ok: false, status: 422 }
    }
    if (resolved.actor_uri !== url && (await deps.store.getRelayByActorUri(resolved.actor_uri)) != null) {
      return { error: 'That relay is already added.', ok: false, status: 409 }
    }
    addressing = resolved
  }

  const id = randomUUID()
  const record = await deps.store.insertRelay({
    ...addressing,
    follow_activity_id: instanceActorFollowId(deps.origin, id).href,
    id,
    style: input.style,
    url,
  })
  return { ok: true, record: await sendFollow(deps, record) }
}

/** Send `Undo{Follow}` (best-effort) and drop the relay. False when there is no such relay. */
export const removeRelay = async (deps: RelayDeps, id: string): Promise<boolean> => {
  if (!UUID_RE.test(id)) return false
  const record = await deps.store.getRelay(id)
  if (record == null) return false
  const ctx = await deps.federation.createContext(new URL(deps.origin))
  try {
    await ctx.sendActivity(
      { identifier: INSTANCE_ACTOR_ID },
      relayRecipient(record),
      relayUndo(ctx.getActorUri(INSTANCE_ACTOR_ID), deps.origin, record),
    )
  } catch (error) {
    console.error(`⚠️ Relay Undo{Follow} delivery failed → ${record.inbox_uri}:`, error)
  }
  return await deps.store.deleteRelay(id)
}

/**
 * Whether `actorUri` may answer for `relay`: its stored actor once known, else
 * (a mastodon relay before its first Accept) any actor on the inbox's host.
 * Without this, anyone who learned a Follow id could flip a relay's state.
 */
export const isRelaySender = (
  relay: Pick<RelayRecord, 'actor_uri' | 'inbox_uri'>,
  actorUri: string | null,
): boolean => {
  if (actorUri == null) return false
  if (relay.actor_uri != null) return relay.actor_uri === actorUri
  try {
    return new URL(actorUri).host === new URL(relay.inbox_uri).host
  } catch {
    return false
  }
}

export const createRelayInboxHooks = (store: RelayStore): RelayInboxHooks => {
  const answer = async (followActivityId: string, actorUri: string | null, accepted: boolean) => {
    const relay = await store.getRelayByFollowActivityId(followActivityId)
    if (relay == null) return false
    if (!isRelaySender(relay, actorUri)) return true
    await store.setRelayState(
      relay.id,
      accepted ? 'accepted' : 'rejected',
      accepted ? { actor_uri: actorUri, last_error: null } : {},
    )
    return true
  }
  return {
    isRelayActor: async (actorUri) => {
      const relay = await store.getRelayByActorUri(actorUri)
      return relay != null && relay.state !== 'rejected'
    },
    onAccept: (followActivityId, actorUri) => answer(followActivityId, actorUri, true),
    onReject: (followActivityId, actorUri) => answer(followActivityId, actorUri, false),
  }
}

export const createRelayActions = (deps: RelayDeps): RelayActions => ({
  add: (input) => addRelay(deps, input),
  list: async () => (await deps.store.listRelays()).map(serializeRelay),
  remove: (id) => removeRelay(deps, id),
})

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

/** Whether a relay could reach this origin to fetch the instance actor's key. */
export const isPublicHttpsOrigin = (origin: string): boolean => {
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  const host = url.hostname.toLowerCase()
  return !LOOPBACK_HOSTS.has(host) && !host.endsWith('.localhost')
}

export type DefaultRelaysOutcome = 'already' | 'failed' | 'seeded' | 'skipped'

/**
 * Subscribe to the default relays once per server, recorded in
 * `default_relays_seeded`, so a relay the admin removes afterwards stays removed.
 * An already added relay counts as done; any other failure leaves the server
 * unmarked for the next startup. Never throws.
 */
export const ensureDefaultRelays = async (deps: {
  add: (input: { url: string; style: RelayStyle }) => Promise<AddRelayResult>
  centralDb: Pick<CentralDb, 'getServerSetting' | 'setServerSetting'>
  origin: string
  relays?: ReadonlyArray<{ url: string; style: RelayStyle }>
  timeoutMs?: number
  log?: (message: string) => void
}): Promise<DefaultRelaysOutcome> => {
  const log = deps.log ?? ((message: string) => console.warn(message))
  try {
    if ((await deps.centralDb.getServerSetting('default_relays_seeded')) === true) return 'already'
    if (!isPublicHttpsOrigin(deps.origin)) return 'skipped'
    const seed = async (): Promise<boolean> => {
      let allDone = true
      for (const relay of deps.relays ?? DEFAULT_RELAYS) {
        const result = await deps.add(relay)
        if (!result.ok && result.status !== 409) {
          log(`⚠️ Default relay ${relay.url} not added: ${result.error}`)
          allDone = false
        }
      }
      return allDone
    }
    if (!(await withTimeout(seed(), deps.timeoutMs ?? DEFAULT_RELAYS_TIMEOUT_MS))) return 'failed'
    await deps.centralDb.setServerSetting('default_relays_seeded', true)
    return 'seeded'
  } catch (error) {
    log(`⚠️ Default relays not added: ${errorMessage(error)}`)
    return 'failed'
  }
}
