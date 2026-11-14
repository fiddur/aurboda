import { describe, expect, it } from 'vitest'

import type { SessionDraft } from './sessionModel'

import {
  createSaveQueue,
  finishLiveSession,
  type LiveApi,
  saveLiveSession,
  type SaveStatus,
} from './saveQueue'

const deferred = () => {
  let resolve!: () => void
  let reject!: (e: unknown) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, reject, resolve }
}

const fakeTimers = () => {
  const pending: { fn: () => void; ms: number }[] = []
  return {
    clearTimer: (h: unknown) => {
      const i = pending.indexOf(h as (typeof pending)[number])
      if (i >= 0) pending.splice(i, 1)
    },
    fire: () => pending.splice(0).forEach((t) => t.fn()),
    pending,
    setTimer: (fn: () => void, ms: number) => {
      const t = { fn, ms }
      pending.push(t)
      return t
    },
  }
}

describe('createSaveQueue', () => {
  it('runs one save at a time and queues exactly one follow-up with the newest state', async () => {
    let state = 1
    const seen: number[] = []
    const gates = [deferred(), deferred()]
    const statuses: SaveStatus[] = []
    const timers = fakeTimers()
    const queue = createSaveQueue({
      ...timers,
      onStatus: (s) => statuses.push(s),
      save: () => {
        seen.push(state)
        return gates[seen.length - 1].promise
      },
    })

    const first = queue.request()
    state = 2
    void queue.request()
    state = 3
    void queue.request()
    expect(seen).toEqual([1])

    gates[0].resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(seen).toEqual([1, 3])
    gates[1].resolve()
    await first
    await queue.whenIdle()
    expect(seen).toEqual([1, 3])
    expect(statuses.at(-1)).toBe('saved')
    expect(queue.isDirty()).toBe(false)
  })

  it('keeps the queue dirty after a failure and retries on the timer and on demand', async () => {
    let fail = true
    let calls = 0
    const statuses: SaveStatus[] = []
    const timers = fakeTimers()
    const queue = createSaveQueue({
      ...timers,
      onStatus: (s) => statuses.push(s),
      retryMs: 15_000,
      save: async () => {
        calls++
        if (fail) throw new Error('offline')
      },
    })

    await queue.request()
    expect(statuses).toEqual(['saving', 'failed'])
    expect(queue.isDirty()).toBe(true)
    expect(timers.pending.map((t) => t.ms)).toEqual([15_000])

    timers.fire()
    await queue.whenIdle()
    expect(calls).toBe(2)
    expect(timers.pending).toHaveLength(1)

    fail = false
    await queue.retry()
    expect(calls).toBe(3)
    expect(statuses.at(-1)).toBe('saved')
    expect(queue.isDirty()).toBe(false)
    expect(timers.pending).toHaveLength(0)

    await queue.retry()
    expect(calls).toBe(3)
  })

  it('does nothing after dispose', async () => {
    let calls = 0
    const queue = createSaveQueue({
      ...fakeTimers(),
      onStatus: () => undefined,
      save: async () => {
        calls++
      },
    })
    queue.dispose()
    await queue.request()
    expect(calls).toBe(0)
  })
})

const draft = (extra: Partial<SessionDraft> = {}): SessionDraft => ({
  blocks: [
    {
      catalog_key: 'barbell_squat',
      exercise: 'Squat',
      id: 'b1',
      planned: [],
      sets: [{ exercise: 'Squat', reps: 5, weight: 100 }],
    },
  ],
  last_set_at: '2026-11-10T17:30:00.000Z',
  rev: 1,
  saved_rev: 0,
  start_time: '2026-11-10T17:02:00.000Z',
  ...extra,
})

const recordingApi = (open?: string) => {
  const calls: unknown[][] = []
  const api: LiveApi = {
    create: async (body) => {
      calls.push(['create', body])
      return 'new-id'
    },
    findOpen: async (start) => {
      calls.push(['findOpen', start])
      return open
    },
    update: async (id, body) => {
      calls.push(['update', id, body])
    },
  }
  return { api, calls }
}

const sentSets = [{ exercise: 'Squat', exercise_key: 'barbell_squat', reps: 5, weight: 100 }]

describe('saveLiveSession', () => {
  it('creates an open session on the first save, marking the attempt first', async () => {
    const { api, calls } = recordingApi()
    const order: string[] = []
    const id = await saveLiveSession(draft(), api, () => order.push('marked'))
    expect(id).toBe('new-id')
    expect(order).toEqual(['marked'])
    expect(calls).toEqual([
      [
        'create',
        {
          activity_type: 'strength_training',
          data: { in_progress: true, last_set_at: '2026-11-10T17:30:00.000Z', sets: sentSets },
          start_time: '2026-11-10T17:02:00.000Z',
        },
      ],
    ])
  })

  it('patches the sets once the session has an id', async () => {
    const { api, calls } = recordingApi()
    expect(await saveLiveSession(draft({ id: 'act1' }), api, () => undefined)).toBe('act1')
    expect(calls).toEqual([
      ['update', 'act1', { data: { last_set_at: '2026-11-10T17:30:00.000Z', sets: sentSets } }],
    ])
  })

  it('adopts the session an earlier create of unknown outcome made instead of creating again', async () => {
    const { api, calls } = recordingApi('made-before')
    expect(await saveLiveSession(draft({ create_attempted: true }), api, () => undefined)).toBe('made-before')
    expect(calls.map((c) => c[0])).toEqual(['findOpen', 'update'])
  })

  it('creates again when the earlier attempt made nothing', async () => {
    const { api, calls } = recordingApi(undefined)
    expect(await saveLiveSession(draft({ create_attempted: true }), api, () => undefined)).toBe('new-id')
    expect(calls.map((c) => c[0])).toEqual(['findOpen', 'create'])
  })
})

describe('finishLiveSession', () => {
  it('sets the end time and clears in_progress, sending the newest sets', async () => {
    const { api, calls } = recordingApi()
    expect(await finishLiveSession(draft({ id: 'act1' }), api, '2026-11-10T18:00:00.000Z')).toBe('act1')
    expect(calls).toEqual([
      [
        'update',
        'act1',
        {
          data: { in_progress: false, last_set_at: '2026-11-10T17:30:00.000Z', sets: sentSets },
          end_time: '2026-11-10T18:00:00.000Z',
        },
      ],
    ])
  })

  it('creates the finished session when it was never saved', async () => {
    const { api, calls } = recordingApi()
    expect(await finishLiveSession(draft(), api, '2026-11-10T17:30:00.000Z')).toBe('new-id')
    expect(calls[0][0]).toBe('create')
    expect(calls[0][1]).toMatchObject({ data: { in_progress: false }, end_time: '2026-11-10T17:30:00.000Z' })
  })

  it('never ends before the start and leaves nothing behind when no set was logged', async () => {
    const { api, calls } = recordingApi()
    await finishLiveSession(draft({ id: 'act1' }), api, '2026-11-10T16:00:00.000Z')
    expect(calls[0][2]).toMatchObject({ end_time: '2026-11-10T17:02:00.000Z' })
    const empty = recordingApi()
    expect(
      await finishLiveSession(draft({ blocks: [] }), empty.api, '2026-11-10T18:00:00.000Z'),
    ).toBeUndefined()
    expect(empty.calls).toEqual([])
  })
})
