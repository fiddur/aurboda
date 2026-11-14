import type { AddActivityBody, UpdateActivityBody } from '@aurboda/api-spec'

import { STRENGTH_TYPE } from './constants'
import { loggedSetCount, type SessionDraft, withExerciseKeys } from './sessionModel'

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'failed'

export const RETRY_MS = 15_000

export interface SaveQueueDeps {
  save: () => Promise<void>
  onStatus: (status: SaveStatus) => void
  setTimer: (fn: () => void, ms: number) => unknown
  clearTimer: (handle: unknown) => void
  retryMs?: number
}

export interface SaveQueue {
  request: () => Promise<void>
  retry: () => Promise<void>
  whenIdle: () => Promise<void>
  isDirty: () => boolean
  dispose: () => void
}

/**
 * One save at a time; a request during a save queues exactly one follow-up, which reads the newest
 * state through `save`. A failure keeps the queue dirty and retries every `retryMs` until a save
 * succeeds; `retry` is for the online and visibility events.
 */
export const createSaveQueue = ({
  save,
  onStatus,
  setTimer,
  clearTimer,
  retryMs = RETRY_MS,
}: SaveQueueDeps): SaveQueue => {
  let running: Promise<void> | undefined
  let queued = false
  let dirty = false
  let disposed = false
  let timer: unknown

  const stopRetry = () => {
    if (timer !== undefined) clearTimer(timer)
    timer = undefined
  }

  const scheduleRetry = () => {
    if (timer !== undefined || disposed) return
    timer = setTimer(() => {
      timer = undefined
      if (dirty) void kick()
    }, retryMs)
  }

  const loop = async () => {
    do {
      queued = false
      onStatus('saving')
      try {
        await save()
        if (!queued) {
          dirty = false
          stopRetry()
          onStatus('saved')
        }
      } catch {
        if (!queued) {
          onStatus('failed')
          scheduleRetry()
        }
      }
    } while (queued && !disposed)
  }

  const kick = (): Promise<void> => {
    if (disposed) return Promise.resolve()
    if (running) {
      queued = true
      return running
    }
    running = loop().finally(() => {
      running = undefined
    })
    return running
  }

  return {
    dispose: () => {
      disposed = true
      stopRetry()
    },
    isDirty: () => dirty,
    request: () => {
      dirty = true
      return kick()
    },
    retry: () => (dirty ? kick() : Promise.resolve()),
    whenIdle: async () => {
      while (running) await running
    },
  }
}

export interface LiveApi {
  create: (body: AddActivityBody) => Promise<string>
  update: (id: string, body: UpdateActivityBody) => Promise<void>
  findOpen: (startTime: string) => Promise<string | undefined>
}

const liveData = (draft: SessionDraft): Record<string, unknown> => ({
  sets: withExerciseKeys(draft.blocks),
  ...(draft.last_set_at ? { last_set_at: draft.last_set_at } : {}),
})

/**
 * Create is not idempotent on the server, so once a create has been sent the next attempt first looks
 * for the open session it may have made. `markAttempt` must persist that before the create is sent.
 */
const existingId = async (draft: SessionDraft, api: LiveApi): Promise<string | undefined> =>
  draft.id ?? (draft.create_attempted ? await api.findOpen(draft.start_time) : undefined)

export const saveLiveSession = async (
  draft: SessionDraft,
  api: LiveApi,
  markAttempt: () => void,
): Promise<string> => {
  const data = liveData(draft)
  const id = await existingId(draft, api)
  if (id) {
    await api.update(id, { data })
    return id
  }
  markAttempt()
  return api.create({
    activity_type: STRENGTH_TYPE,
    data: { ...data, in_progress: true },
    start_time: draft.start_time,
  })
}

const laterOf = (a: string, b: string): string => (Date.parse(a) >= Date.parse(b) ? a : b)

/** Ends the session at `endTime`; undefined when nothing was ever logged, so nothing exists to finish. */
export const finishLiveSession = async (
  draft: SessionDraft,
  api: LiveApi,
  endTime: string,
): Promise<string | undefined> => {
  const id = await existingId(draft, api)
  if (!id && loggedSetCount(draft.blocks) === 0) return undefined
  const end_time = laterOf(endTime, draft.start_time)
  const data = { ...liveData(draft), in_progress: false }
  if (id) {
    await api.update(id, { data, end_time })
    return id
  }
  return api.create({ activity_type: STRENGTH_TYPE, data, end_time, start_time: draft.start_time })
}
