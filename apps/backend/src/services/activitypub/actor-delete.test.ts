import { Delete, Tombstone } from '@fedify/fedify/vocab'
import { describe, expect, test, vi } from 'vitest'

import { createFeedFederation, deliverActorDelete } from './federation.ts'

const ORIGIN = 'https://aurboda.example'

describe('deliverActorDelete', () => {
  test('sends a Delete of the actor, with a Tombstone, to the followers', async () => {
    const federation = createFeedFederation(ORIGIN, `${ORIGIN}/api`)
    const ctx = await federation.createContext(new URL(ORIGIN))
    const sendActivity = vi.fn().mockResolvedValue(undefined)
    Object.assign(ctx, { sendActivity })

    await deliverActorDelete(
      { federation: { createContext: async () => ctx } as unknown as typeof federation, origin: ORIGIN },
      'gone',
    )

    expect(sendActivity).toHaveBeenCalledTimes(1)
    const [sender, recipients, activity] = sendActivity.mock.calls[0]
    expect(sender).toEqual({ identifier: 'gone' })
    expect(recipients).toBe('followers')
    expect(activity).toBeInstanceOf(Delete)
    const del = activity as Delete
    expect(del.actorId?.href).toBe(`${ORIGIN}/users/gone`)
    const object = await del.getObject()
    expect(object).toBeInstanceOf(Tombstone)
    expect(object?.id?.href).toBe(`${ORIGIN}/users/gone`)
  })
})

describe('a deleted account', () => {
  const fed = createFeedFederation(
    ORIGIN,
    `${ORIGIN}/api`,
    undefined,
    undefined,
    'test',
    async () => false,
    (user) => user === 'gone',
  )
  const notFound = () => new Response('nope', { status: 404 })
  const options = { contextData: undefined, onNotAcceptable: notFound, onNotFound: notFound }

  test('answers its actor URL with 410 Gone and a Tombstone', async () => {
    const res = await fed.fetch(
      new Request(`${ORIGIN}/users/gone`, { headers: { Accept: 'application/activity+json' } }),
      options,
    )
    expect(res.status).toBe(410)
    const doc = (await res.json()) as Record<string, unknown>
    expect(doc.type).toBe('Tombstone')
    expect(doc.id).toBe(`${ORIGIN}/users/gone`)
  })

  test('answers WebFinger with 410 Gone', async () => {
    const res = await fed.fetch(
      new Request(`${ORIGIN}/.well-known/webfinger?resource=acct:gone@aurboda.example`),
      options,
    )
    expect(res.status).toBe(410)
  })
})
