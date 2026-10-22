import { describe, expect, test, vi } from 'vitest'

import { createTimelineHub, type TimelineHubDeps } from './timeline-hub.ts'

/**
 * A fake PG-notify layer: records opens/emits and lets the test fire a ping by
 * invoking the stored `onNotify`, so the hub's fan-out + per-user refcounting can
 * be exercised without a database.
 */
const fakeDeps = () => {
  const opened: { user: string; onNotify: () => void; teardown: ReturnType<typeof vi.fn> }[] = []
  const emits: string[] = []
  const deps: TimelineHubDeps = {
    emit: async (user) => {
      emits.push(user)
    },
    openChannel: async (user, onNotify) => {
      const teardown = vi.fn(async () => {})
      opened.push({ onNotify, teardown, user })
      return teardown
    },
  }
  return { deps, emits, opened }
}

describe('createTimelineHub', () => {
  test('opens one channel per user and fans a ping out to all its listeners', async () => {
    const { deps, opened } = fakeDeps()
    const hub = createTimelineHub(deps)
    const a = vi.fn()
    const b = vi.fn()

    await hub.subscribe('alice', a)
    await hub.subscribe('alice', b)

    // One shared channel for the two listeners.
    expect(opened).toHaveLength(1)
    expect(opened[0].user).toBe('alice')

    opened[0].onNotify()
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })

  test('isolates users — a ping for one does not reach another', async () => {
    const { deps, opened } = fakeDeps()
    const hub = createTimelineHub(deps)
    const alice = vi.fn()
    const bob = vi.fn()

    await hub.subscribe('alice', alice)
    await hub.subscribe('bob', bob)
    expect(opened).toHaveLength(2)
    expect(opened[0].user).toBe('alice')

    opened[0].onNotify()
    expect(alice).toHaveBeenCalledTimes(1)
    expect(bob).not.toHaveBeenCalled()
  })

  test('tears the channel down only when the last listener unsubscribes', async () => {
    const { deps, opened } = fakeDeps()
    const hub = createTimelineHub(deps)
    const a = vi.fn()
    const b = vi.fn()

    const offA = await hub.subscribe('alice', a)
    const offB = await hub.subscribe('alice', b)
    const teardown = opened[0].teardown

    await offA()
    expect(teardown).not.toHaveBeenCalled()
    // A remaining listener still receives pings.
    opened[0].onNotify()
    expect(b).toHaveBeenCalledTimes(1)

    await offB()
    expect(teardown).toHaveBeenCalledTimes(1)
  })

  test('re-opens a fresh channel after all listeners have left', async () => {
    const { deps, opened } = fakeDeps()
    const hub = createTimelineHub(deps)

    const off = await hub.subscribe('alice', vi.fn())
    await off()
    await hub.subscribe('alice', vi.fn())

    expect(opened).toHaveLength(2)
  })

  test('notify emits a ping for the user', async () => {
    const { deps, emits } = fakeDeps()
    const hub = createTimelineHub(deps)
    await hub.notify('alice')
    expect(emits).toEqual(['alice'])
  })

  test('a failed channel open surfaces to the subscriber and frees the slot for retry', async () => {
    const opened: string[] = []
    let failNext = true
    const deps: TimelineHubDeps = {
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
    const hub = createTimelineHub(deps)

    await expect(hub.subscribe('alice', vi.fn())).rejects.toThrow('LISTEN failed')
    // The slot was freed, so a retry opens a fresh channel instead of reusing the broken one.
    await expect(hub.subscribe('alice', vi.fn())).resolves.toBeTypeOf('function')
    expect(opened).toEqual(['alice', 'alice'])
  })
})
