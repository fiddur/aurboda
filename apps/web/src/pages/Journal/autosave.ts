/**
 * When to save the editor's text: a few seconds after typing stops, at once on blur or leaving,
 * again after a failure, and never again after a conflict until the person resolves it.
 * Plain closures over injected timers, so it runs under fake timers in tests.
 */

export type AutosaveStatus = 'saved' | 'dirty' | 'saving' | 'retrying' | 'conflict'

export type SaveOutcome = { kind: 'saved' } | { kind: 'conflict' }

export interface AutosaveOptions<T> {
  save: (value: T) => Promise<SaveOutcome>
  onStatus: (status: AutosaveStatus) => void
  delayMs?: number
  retryMs?: number
}

export interface Autosaver<T> {
  /** The editor changed: save this after the pause. */
  change: (value: T) => void
  /** Save what is pending now (blur, leaving). Resolves once nothing is pending or saving fails. */
  flush: () => Promise<void>
  /** After a conflict was resolved: start saving again from this value. */
  resume: (value: T) => void
  /** The editor closed: no more timers. */
  stop: () => void
  status: () => AutosaveStatus
}

export const AUTOSAVE_DELAY_MS = 3000
export const AUTOSAVE_RETRY_MS = 10_000

export const createAutosaver = <T>({
  save,
  onStatus,
  delayMs = AUTOSAVE_DELAY_MS,
  retryMs = AUTOSAVE_RETRY_MS,
}: AutosaveOptions<T>): Autosaver<T> => {
  let status: AutosaveStatus = 'saved'
  let pending: { value: T } | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let inFlight: Promise<void> | undefined
  let stopped = false

  const setStatus = (next: AutosaveStatus) => {
    if (next === status) return
    status = next
    onStatus(next)
  }

  const clearTimer = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }

  const schedule = (ms: number) => {
    clearTimer()
    if (stopped) return
    timer = setTimeout(() => {
      timer = undefined
      void run()
    }, ms)
  }

  const run = async (): Promise<void> => {
    if (inFlight) return inFlight
    if (!pending || status === 'conflict') return
    const sending = pending
    setStatus('saving')
    inFlight = (async () => {
      try {
        const outcome = await save(sending.value)
        if (outcome.kind === 'conflict') {
          clearTimer()
          setStatus('conflict')
          return
        }
        if (pending === sending) {
          pending = undefined
          setStatus('saved')
        } else {
          setStatus('dirty')
          schedule(delayMs)
        }
      } catch {
        setStatus('retrying')
        schedule(retryMs)
      }
    })()
    try {
      await inFlight
    } finally {
      inFlight = undefined
    }
  }

  return {
    change: (value) => {
      pending = { value }
      if (status === 'conflict') return
      if (status !== 'saving') setStatus('dirty')
      schedule(delayMs)
    },
    flush: async () => {
      clearTimer()
      if (inFlight) await inFlight
      if (pending && status !== 'conflict') await run()
    },
    resume: (value) => {
      pending = { value }
      status = 'dirty'
      onStatus('dirty')
      void run()
    },
    status: () => status,
    stop: () => {
      stopped = true
      clearTimer()
    },
  }
}

export const autosaveLabel = (status: AutosaveStatus): string => {
  switch (status) {
    case 'saved':
      return 'Saved'
    case 'dirty':
      return 'Not saved yet'
    case 'saving':
      return 'Saving…'
    case 'retrying':
      return 'Not saved yet: will retry'
    case 'conflict':
      return 'Changed elsewhere: choose a version below'
  }
}
