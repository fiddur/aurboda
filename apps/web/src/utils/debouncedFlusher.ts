/**
 * A debounced save scheduler that can be flushed synchronously.
 *
 * `schedule(body)` arms a timer; `flush()` runs the pending save
 * immediately (used from unmount cleanup so a navigation mid-debounce
 * doesn't drop the user's last edit); `cancel()` discards the pending
 * save without running it.
 */
export interface DebouncedFlusher<T> {
  /** Replace any pending body and (re)start the debounce timer. */
  schedule: (body: T) => void
  /** If a save is pending, run it now and clear the timer. */
  flush: () => void
  /** Discard any pending save without running it. */
  cancel: () => void
}

export const createDebouncedFlusher = <T>(delayMs: number, save: (body: T) => void): DebouncedFlusher<T> => {
  let pending: T | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  const clearTimer = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  return {
    schedule(body) {
      pending = body
      clearTimer()
      timer = setTimeout(() => {
        const due = pending
        pending = null
        timer = null
        if (due !== null) save(due)
      }, delayMs)
    },
    flush() {
      clearTimer()
      if (pending !== null) {
        const body = pending
        pending = null
        save(body)
      }
    },
    cancel() {
      clearTimer()
      pending = null
    },
  }
}
