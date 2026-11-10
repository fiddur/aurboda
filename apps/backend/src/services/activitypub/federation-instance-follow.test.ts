import { Accept, Follow } from '@fedify/fedify/vocab'
import { describe, expect, test, vi } from 'vitest'

import { actorDocument, inboxContext } from '../../test/inbox-context.ts'
import { createFeedFederation, handleInboundFollow } from './federation.ts'
import { INSTANCE_ACTOR_ID, type RelayInboxHooks } from './instance-actor.ts'

vi.mock('../../db/index.ts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getFeedFollowerByActor: vi.fn(),
  getUserSettings: vi.fn(),
  upsertFeedFollower: vi.fn(),
}))

const db = await import('../../db/index.ts')

const ORIGIN = 'https://aurboda.example'
const RELAY_ACTOR = 'https://relay.example/actor'
const STRANGER = 'https://stranger.example/users/eve'

const hooks = (): RelayInboxHooks => ({
  isRelayActor: vi.fn(async (uri: string) => uri === RELAY_ACTOR),
  onAccept: vi.fn(async () => false),
  onReject: vi.fn(async () => false),
})

const followOf = (actor: string, object: string) =>
  new Follow({ actor: new URL(actor), id: new URL(`${actor}#follow/1`), object: new URL(object) })

describe('handleInboundFollow of the instance actor', () => {
  test.each([`${ORIGIN}/users/~actor`, `${ORIGIN}/actor`])(
    'a Follow of %s goes to the relay hooks and never records a follower',
    async (object) => {
      const relays = hooks()
      const ctx = inboxContext(createFeedFederation(ORIGIN, `${ORIGIN}/api`), ORIGIN, INSTANCE_ACTOR_ID, {
        [RELAY_ACTOR]: actorDocument(RELAY_ACTOR, 'relay', 'Relay'),
        [STRANGER]: actorDocument(STRANGER, 'eve', 'Eve'),
      })
      const sendActivity = vi.fn().mockResolvedValue(undefined)
      Object.assign(ctx, { sendActivity })

      await handleInboundFollow(ctx, followOf(RELAY_ACTOR, object), relays)
      await handleInboundFollow(ctx, followOf(STRANGER, object), relays)

      expect(relays.isRelayActor).toHaveBeenCalledWith(RELAY_ACTOR)
      expect(relays.isRelayActor).toHaveBeenCalledWith(STRANGER)
      expect(sendActivity).toHaveBeenCalledTimes(1)
      expect(sendActivity.mock.calls[0][0]).toEqual({ identifier: INSTANCE_ACTOR_ID })
      expect(sendActivity.mock.calls[0][2]).toBeInstanceOf(Accept)
      expect(db.getUserSettings).not.toHaveBeenCalled()
      expect(db.getFeedFollowerByActor).not.toHaveBeenCalled()
      expect(db.upsertFeedFollower).not.toHaveBeenCalled()
    },
  )
})
