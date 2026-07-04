/**
 * Small shared timeout util for the feed's synchronous, best-effort network
 * calls (actor icon deref, cross-instance enrichment, …): race a promise
 * against a timer so a hung remote can never stall an inbox/follow handler.
 */

/** Reject `promise` if it doesn't settle within `ms` (clearing the timer either way). */
export const withTimeout = async <T>(promise: Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
