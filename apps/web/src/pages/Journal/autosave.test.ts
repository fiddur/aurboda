import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { type AutosaveStatus, autosaveLabel, createAutosaver, type SaveOutcome } from './autosave'

const setup = (outcomes: (() => Promise<SaveOutcome>)[] = []) => {
  const statuses: AutosaveStatus[] = []
  const saved: string[] = []
  const save = vi.fn(async (value: string) => {
    saved.push(value)
    const next = outcomes.shift()
    return next ? next() : { kind: 'saved' as const }
  })
  const autosaver = createAutosaver<string>({
    delayMs: 3000,
    onStatus: (s) => statuses.push(s),
    retryMs: 10_000,
    save,
  })
  return { autosaver, save, saved, statuses }
}

describe('createAutosaver', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  test('saves 3 seconds after typing stops, once, with the latest text', async () => {
    const { autosaver, saved, statuses } = setup()
    autosaver.change('a')
    await vi.advanceTimersByTimeAsync(2000)
    autosaver.change('ab')
    await vi.advanceTimersByTimeAsync(2999)
    expect(saved).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(saved).toEqual(['ab'])
    expect(statuses).toEqual(['dirty', 'saving', 'saved'])
  })

  test('flush saves at once (blur, leaving)', async () => {
    const { autosaver, saved } = setup()
    autosaver.change('a')
    await autosaver.flush()
    expect(saved).toEqual(['a'])
    await vi.advanceTimersByTimeAsync(5000)
    expect(saved).toEqual(['a'])
  })

  test('a failure keeps the text and retries', async () => {
    const { autosaver, saved, statuses } = setup([() => Promise.reject(new Error('offline'))])
    autosaver.change('a')
    await vi.advanceTimersByTimeAsync(3000)
    expect(autosaver.status()).toBe('retrying')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(saved).toEqual(['a', 'a'])
    expect(statuses.at(-1)).toBe('saved')
  })

  test('typing during a save saves again afterwards', async () => {
    let release: (v: SaveOutcome) => void = () => {}
    const { autosaver, saved } = setup([() => new Promise((resolve) => (release = resolve))])
    autosaver.change('a')
    await vi.advanceTimersByTimeAsync(3000)
    autosaver.change('ab')
    release({ kind: 'saved' })
    await vi.advanceTimersByTimeAsync(0)
    expect(autosaver.status()).toBe('dirty')
    await vi.advanceTimersByTimeAsync(3000)
    expect(saved).toEqual(['a', 'ab'])
    expect(autosaver.status()).toBe('saved')
  })

  test('a conflict stops autosaving until resumed', async () => {
    const { autosaver, saved } = setup([() => Promise.resolve({ kind: 'conflict' })])
    autosaver.change('a')
    await vi.advanceTimersByTimeAsync(3000)
    expect(autosaver.status()).toBe('conflict')
    autosaver.change('ab')
    await vi.advanceTimersByTimeAsync(30_000)
    await autosaver.flush()
    expect(saved).toEqual(['a'])
    autosaver.resume('resolved')
    await vi.advanceTimersByTimeAsync(0)
    expect(saved).toEqual(['a', 'resolved'])
    expect(autosaver.status()).toBe('saved')
  })

  test('stop cancels the pending timer', async () => {
    const { autosaver, saved } = setup()
    autosaver.change('a')
    autosaver.stop()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(saved).toEqual([])
  })
})

describe('autosaveLabel', () => {
  test('never a spinner, plain words', () => {
    expect(autosaveLabel('saved')).toBe('Saved')
    expect(autosaveLabel('saving')).toBe('Saving…')
    expect(autosaveLabel('retrying')).toBe('Not saved yet: will retry')
  })
})
