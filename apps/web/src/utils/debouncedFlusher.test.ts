import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { createDebouncedFlusher } from './debouncedFlusher'

describe('createDebouncedFlusher', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('schedule fires the save after the delay', () => {
    const save = vi.fn()
    const f = createDebouncedFlusher<string>(100, save)

    f.schedule('A')
    expect(save).not.toHaveBeenCalled()

    vi.advanceTimersByTime(99)
    expect(save).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(save).toHaveBeenCalledExactlyOnceWith('A')
  })

  test('schedule again before the timer fires replaces the pending body', () => {
    const save = vi.fn()
    const f = createDebouncedFlusher<string>(100, save)

    f.schedule('A')
    vi.advanceTimersByTime(50)
    f.schedule('B')
    vi.advanceTimersByTime(99)
    expect(save).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(save).toHaveBeenCalledExactlyOnceWith('B')
  })

  test('flush runs the pending save synchronously and clears the timer', () => {
    const save = vi.fn()
    const f = createDebouncedFlusher<string>(100, save)

    f.schedule('A')
    f.flush()
    expect(save).toHaveBeenCalledExactlyOnceWith('A')

    // Timer must be cleared — advancing further must not double-fire.
    vi.advanceTimersByTime(200)
    expect(save).toHaveBeenCalledOnce()
  })

  test('flush with nothing pending is a no-op', () => {
    const save = vi.fn()
    const f = createDebouncedFlusher<string>(100, save)
    f.flush()
    expect(save).not.toHaveBeenCalled()
  })

  test('cancel drops the pending save without running it', () => {
    const save = vi.fn()
    const f = createDebouncedFlusher<string>(100, save)

    f.schedule('A')
    f.cancel()
    vi.advanceTimersByTime(200)
    expect(save).not.toHaveBeenCalled()

    // Subsequent schedule still works.
    f.schedule('B')
    vi.advanceTimersByTime(100)
    expect(save).toHaveBeenCalledExactlyOnceWith('B')
  })

  test('flush after the timer naturally fired is a no-op', () => {
    const save = vi.fn()
    const f = createDebouncedFlusher<string>(100, save)
    f.schedule('A')
    vi.advanceTimersByTime(100)
    expect(save).toHaveBeenCalledOnce()
    f.flush()
    expect(save).toHaveBeenCalledOnce() // still once
  })
})
