import { describe, expect, test } from 'vitest'

import { createDeletedUsers } from './deleted-users.ts'

describe('createDeletedUsers', () => {
  test('knows nobody until loaded, then the stored names', async () => {
    const deleted = createDeletedUsers({ list: async () => ['gone'] })
    expect(deleted.has('gone')).toBe(false)
    await deleted.refresh()
    expect(deleted.has('gone')).toBe(true)
    expect(deleted.has('alice')).toBe(false)
  })

  test('keeps a name added here across a reload that has not seen it yet', async () => {
    const deleted = createDeletedUsers({ list: async () => [] })
    deleted.add('alice')
    await deleted.refresh()
    expect(deleted.has('alice')).toBe(true)
  })

  test('keeps the current set when a reload fails', async () => {
    let fail = false
    const deleted = createDeletedUsers({
      list: async () => {
        if (fail) throw new Error('db down')
        return ['gone']
      },
    })
    await deleted.refresh()
    fail = true
    const error = console.error
    console.error = () => {}
    try {
      await deleted.refresh()
    } finally {
      console.error = error
    }
    expect(deleted.has('gone')).toBe(true)
  })

  test('reloads on the interval until stopped', async () => {
    let tick: (() => void) | undefined
    let cancelled: unknown
    let loads = 0
    const deleted = createDeletedUsers({
      clearInterval: (handle) => {
        cancelled = handle
      },
      list: async () => {
        loads += 1
        return ['later']
      },
      setInterval: (fn) => {
        tick = fn
        return { id: 1 } as { unref?: () => void }
      },
    })
    const stop = deleted.startRefreshing(1000)
    tick?.()
    await Promise.resolve()
    await Promise.resolve()
    expect(loads).toBe(1)
    expect(deleted.has('later')).toBe(true)
    stop()
    expect(cancelled).toEqual({ id: 1 })
  })
})
