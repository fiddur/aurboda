import { describe, expect, test, vi } from 'vitest'

import { createLiveHub, type LiveEventKind, type LiveHubDeps } from './live-hub.ts'

const fakeDeps = () => {
  const opened: {
    user: string
    onNotify: (kind: LiveEventKind) => void
    onClosed: () => void
    teardown: ReturnType<typeof vi.fn>
  }[] = []
  const emits: [string, LiveEventKind][] = []
  const deps: LiveHubDeps = {
    emit: async (user, kind) => {
      emits.push([user, kind])
    },
    openChannel: async (user, onNotify, onClosed) => {
      const teardown = vi.fn(async () => {})
      opened.push({ onClosed, onNotify, teardown, user })
      return teardown
    },
  }
  return { deps, emits, opened }
}

describe('createLiveHub', () => {
  test('opens one channel per user and fans a ping out to all its listeners', async () => {
    const { deps, opened } = fakeDeps()
    const hub = createLiveHub(deps)
    const a = vi.fn()
    const b = vi.fn()

    await hub.subscribe('alice', a)
    await hub.subscribe('alice', b)

    // One shared channel for the two listeners.
    expect(opened).toHaveLength(1)
    expect(opened[0].user).toBe('alice')

    opened[0].onNotify('timeline')
    expect(a).toHaveBeenCalledWith('timeline')
    expect(b).toHaveBeenCalledWith('timeline')
  })

  test('isolates users — a ping for one does not reach another', async () => {
    const { deps, opened } = fakeDeps()
    const hub = createLiveHub(deps)
    const alice = vi.fn()
    const bob = vi.fn()

    await hub.subscribe('alice', alice)
    await hub.subscribe('bob', bob)
    expect(opened).toHaveLength(2)
    expect(opened[0].user).toBe('alice')

    opened[0].onNotify('timeline')
    expect(alice).toHaveBeenCalledTimes(1)
    expect(bob).not.toHaveBeenCalled()
  })

  test('tears the channel down only when the last listener unsubscribes', async () => {
    const { deps, opened } = fakeDeps()
    const hub = createLiveHub(deps)
    const a = vi.fn()
    const b = vi.fn()

    const offA = await hub.subscribe('alice', a)
    const offB = await hub.subscribe('alice', b)
    const teardown = opened[0].teardown

    await offA()
    expect(teardown).not.toHaveBeenCalled()
    // A remaining listener still receives pings.
    opened[0].onNotify('timeline')
    expect(b).toHaveBeenCalledTimes(1)

    await offB()
    expect(teardown).toHaveBeenCalledTimes(1)
  })

  test('re-opens a fresh channel after all listeners have left', async () => {
    const { deps, opened } = fakeDeps()
    const hub = createLiveHub(deps)

    const off = await hub.subscribe('alice', vi.fn())
    await off()
    await hub.subscribe('alice', vi.fn())

    expect(opened).toHaveLength(2)
  })

  test('notify emits a ping of the given kind for the user', async () => {
    const { deps, emits } = fakeDeps()
    const hub = createLiveHub(deps)
    await hub.notify('alice', 'timeline')
    await hub.notify('alice', 'notification')
    expect(emits).toEqual([
      ['alice', 'timeline'],
      ['alice', 'notification'],
    ])
  })

  test('each listener gets the kind of every ping on the shared channel', async () => {
    const { deps, opened } = fakeDeps()
    const hub = createLiveHub(deps)
    const a = vi.fn()
    const b = vi.fn()
    await hub.subscribe('alice', a)
    await hub.subscribe('alice', b)

    opened[0].onNotify('timeline')
    opened[0].onNotify('notification')

    expect(opened).toHaveLength(1)
    expect(a.mock.calls).toEqual([['timeline'], ['notification']])
    expect(b.mock.calls).toEqual([['timeline'], ['notification']])
  })

  test('a failed channel open surfaces to the subscriber and frees the slot for retry', async () => {
    const opened: string[] = []
    let failNext = true
    const deps: LiveHubDeps = {
      emit: async () => {},
      openChannel: async (user) => {
        opened.push(user)
        if (failNext) {
          failNext = false
          throw new Error('LISTEN failed')
        }
        return async () => {}
      },
    }
    const hub = createLiveHub(deps)

    await expect(hub.subscribe('alice', vi.fn())).rejects.toThrow('LISTEN failed')
    // The slot was freed, so a retry opens a fresh channel instead of reusing the broken one.
    await expect(hub.subscribe('alice', vi.fn())).resolves.toBeTypeOf('function')
    expect(opened).toEqual(['alice', 'alice'])
  })

  test('a dropped channel tells each subscriber once and frees the slot', async () => {
    const { deps, opened } = fakeDeps()
    const hub = createLiveHub(deps)
    const closedA = vi.fn()
    const closedB = vi.fn()
    const onEvent = vi.fn()
    await hub.subscribe('alice', onEvent, closedA)
    await hub.subscribe('alice', vi.fn(), closedB)

    opened[0].onClosed()
    opened[0].onClosed()

    expect(closedA).toHaveBeenCalledTimes(1)
    expect(closedB).toHaveBeenCalledTimes(1)
    opened[0].onNotify('timeline')
    expect(onEvent).not.toHaveBeenCalled()

    await hub.subscribe('alice', vi.fn())
    expect(opened).toHaveLength(2)
  })

  test('unsubscribing after a drop is a no-op that leaves the fresh channel open', async () => {
    const { deps, opened } = fakeDeps()
    const hub = createLiveHub(deps)
    const offOld = await hub.subscribe('alice', vi.fn(), vi.fn())
    opened[0].onClosed()

    const onEvent = vi.fn()
    await hub.subscribe('alice', onEvent)
    await expect(offOld()).resolves.toBeUndefined()

    expect(opened[1].teardown).not.toHaveBeenCalled()
    opened[1].onNotify('notification')
    expect(onEvent).toHaveBeenCalledWith('notification')
    await hub.subscribe('alice', vi.fn())
    expect(opened).toHaveLength(2)
  })

  test('a subscriber without an onClosed is dropped quietly', async () => {
    const { deps, opened } = fakeDeps()
    const hub = createLiveHub(deps)
    const off = await hub.subscribe('alice', vi.fn())
    expect(() => opened[0].onClosed()).not.toThrow()
    await expect(off()).resolves.toBeUndefined()
  })
})
