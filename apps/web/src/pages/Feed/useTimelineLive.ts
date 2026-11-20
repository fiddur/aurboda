import { useEffect, useRef } from 'preact/hooks'

import { subscribeLiveEvents } from '../../state/live-events'

const POLL_MS = 30_000

/** Calls `onPing` when the timeline gains posts: live over the shared stream, by polling while it is down. */
export const useTimelineLive = (onPing: () => void): void => {
  const cb = useRef(onPing)
  cb.current = onPing

  useEffect(() => {
    let poll: ReturnType<typeof setInterval> | null = null
    const stopPolling = () => {
      if (poll) clearInterval(poll)
      poll = null
    }
    const unsubscribe = subscribeLiveEvents(
      'timeline',
      () => cb.current(),
      (down) => {
        if (!down) return stopPolling()
        poll ??= setInterval(() => cb.current(), POLL_MS)
      },
    )
    return () => {
      unsubscribe()
      stopPolling()
    }
  }, [])
}
