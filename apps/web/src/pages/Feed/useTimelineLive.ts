/**
 * Subscribe to live home-timeline updates: opens the SSE stream and calls `onPing`
 * whenever the server signals new posts. If the stream can't be opened or drops
 * (proxy buffering, network blip), it falls back to polling on an interval — so the
 * "N new posts" pill still works without a live connection.
 */
import { useEffect, useRef } from 'preact/hooks'

import { openTimelineStream } from '../../state/api'

const POLL_MS = 30_000

export const useTimelineLive = (onPing: () => void): void => {
  // Keep the latest callback in a ref so re-renders don't re-open the stream.
  const cb = useRef(onPing)
  cb.current = onPing

  useEffect(() => {
    let stopped = false
    let poll: ReturnType<typeof setInterval> | null = null

    const startPolling = () => {
      if (stopped || poll) return
      poll = setInterval(() => cb.current(), POLL_MS)
    }

    const close = openTimelineStream(
      () => cb.current(),
      () => startPolling(),
    )

    return () => {
      stopped = true
      close()
      if (poll) clearInterval(poll)
    }
  }, [])
}
