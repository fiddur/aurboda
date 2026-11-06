import { Announce, Create, Note, Update } from '@fedify/fedify/vocab'
import { describe, expect, test, vi } from 'vitest'

import { inboxContext } from '../../test/inbox-context.ts'
import { createFeedFederation, dropsForReadOnly } from './federation.ts'

const ORIGIN = 'https://aurboda.example'
const fed = createFeedFederation(ORIGIN, `${ORIGIN}/api`)
const ctx = inboxContext(fed, ORIGIN, 'alice')
const remoteActor = new URL('https://remote.example/users/bob')
const remoteNote = new URL('https://remote.example/users/bob/statuses/1')
const ownPost = new URL(`${ORIGIN}/users/alice/feed/11111111-1111-4111-8111-111111111111`)

const readOnly = vi.fn(async (user: string) => user === 'alice')
const writable = vi.fn(async () => false)

describe('dropsForReadOnly', () => {
  test('drops a new or edited Note for a read-only recipient, and only then', async () => {
    const create = new Create({ actor: remoteActor, object: new Note({ id: remoteNote }) })
    const update = new Update({ actor: remoteActor, object: remoteNote })

    expect(await dropsForReadOnly(ctx, create, readOnly)).toBe(true)
    expect(await dropsForReadOnly(ctx, update, readOnly)).toBe(true)
    expect(await dropsForReadOnly(ctx, create, writable)).toBe(false)
    expect(await dropsForReadOnly(ctx, update, writable)).toBe(false)
  })

  test('drops a boost of a third-party post but not a boost of the recipient’s own post', async () => {
    const thirdParty = new Announce({ actor: remoteActor, object: remoteNote })
    const ofOwnPost = new Announce({ actor: remoteActor, object: ownPost })

    expect(await dropsForReadOnly(ctx, thirdParty, readOnly)).toBe(true)
    expect(await dropsForReadOnly(ctx, ofOwnPost, readOnly)).toBe(false)
  })

  test('lets a remote actor’s edit of their own profile through', async () => {
    const isReadOnly = vi.fn(async () => true)
    const selfUpdate = new Update({ actor: remoteActor, object: remoteActor })

    expect(await dropsForReadOnly(ctx, selfUpdate, isReadOnly)).toBe(false)
    expect(isReadOnly).not.toHaveBeenCalled()
  })
})
