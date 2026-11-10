/**
 * The instance actor: the server itself as an ActivityPub `Application`, the
 * sender of relay subscriptions. Its identifier is a sentinel that can never be
 * a username (`isValidUsername` requires a leading letter), served at the
 * fixed `/actor` alias.
 */
import type { ActorKeyPair, Context, InboxContext } from '@fedify/fedify'

import { Accept, Application, Endpoints, type Follow, type Reject } from '@fedify/fedify/vocab'

export const INSTANCE_ACTOR_ID = '~actor'
export const INSTANCE_ACTOR_PATH = '/actor'

export const isInstanceActor = (identifier: string): boolean => identifier === INSTANCE_ACTOR_ID

/** The WebFinger username of the instance actor (Mastodon convention): the host itself. */
export const instanceActorUsername = (origin: string): string => new URL(origin).host

export interface InstanceActorKeys {
  private_key_pem: string
  public_key_pem: string
}

/** What the inbox needs to know about relay subscriptions; implemented over the central DB. */
export interface RelayInboxHooks {
  /** True when `followActivityId` is one of our relay follows (whatever the outcome). */
  onAccept: (followActivityId: string, relayActorUri: string | null) => Promise<boolean>
  onReject: (followActivityId: string, relayActorUri: string | null) => Promise<boolean>
  /** Whether `actorUri` is an added relay's actor, so its follow of the instance actor is accepted. */
  isRelayActor: (actorUri: string) => Promise<boolean>
}

export interface InstanceActorDeps {
  instanceKeys: () => Promise<InstanceActorKeys>
  relays: RelayInboxHooks
}

export const buildInstanceActor = (
  ctx: Context<void>,
  origin: string,
  keys: readonly ActorKeyPair[],
): Application | null => {
  if (keys.length === 0) return null
  const host = instanceActorUsername(origin)
  return new Application({
    endpoints: new Endpoints({ sharedInbox: ctx.getInboxUri() }),
    id: ctx.getActorUri(INSTANCE_ACTOR_ID),
    inbox: ctx.getInboxUri(INSTANCE_ACTOR_ID),
    name: `Aurboda at ${host}`,
    outbox: ctx.getOutboxUri(INSTANCE_ACTOR_ID),
    preferredUsername: host,
    publicKey: keys[0].cryptographicKey,
    url: new URL(origin),
  })
}

/** The id of the Follow the instance actor sends a relay (stable per relay row). */
export const instanceActorFollowId = (origin: string, relayId: string): URL =>
  new URL(`${origin.replace(/\/+$/, '')}${INSTANCE_ACTOR_PATH}/follows/${relayId}`)

/**
 * An `Accept`/`Reject` answering one of our relay follows, matched on the Follow's
 * id (`objectId` is that id whether the Follow is embedded or referenced).
 * Returns whether it was one, so the caller skips the per-user follow handling.
 */
export const handleRelayResponse = async (
  response: Accept | Reject,
  relays: RelayInboxHooks | undefined,
): Promise<boolean> => {
  const followId = response.objectId?.href
  if (relays == null || followId == null) return false
  const actor = response.actorId?.href ?? null
  return response instanceof Accept ? relays.onAccept(followId, actor) : relays.onReject(followId, actor)
}

/**
 * A `Follow` of the instance actor: a LitePub relay following back after we
 * subscribed. Accepted only when the sender is an added relay's actor; any other
 * follow is ignored, and nothing is stored either way.
 */
export const handleInstanceActorFollow = async (
  ctx: InboxContext<void>,
  follow: Follow,
  relays: RelayInboxHooks | undefined,
): Promise<void> => {
  if (relays == null || follow.actorId == null) return
  if (!(await relays.isRelayActor(follow.actorId.href))) return
  const sender = await follow.getActor(ctx)
  if (sender?.id == null || sender.inboxId == null || sender.id.href !== follow.actorId.href) return
  await ctx.sendActivity(
    { identifier: INSTANCE_ACTOR_ID },
    sender,
    new Accept({ actor: ctx.getActorUri(INSTANCE_ACTOR_ID), object: follow }),
  )
}
