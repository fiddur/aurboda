/**
 * In-process fan-out hub for live home-timeline updates.
 *
 * An open SSE stream `subscribe`s a listener; the ingest path `notify`s when a new
 * post arrives. The hub keeps at most **one** Postgres `LISTEN` channel open per
 * user (via the injected `openChannel`) no matter how many browser tabs that user
 * has streaming, and closes it when the last one disconnects. The PG glue is
 * injected so this refcounting + fan-out logic is unit-testable without a database.
 *
 * Notifications are pings (no payload): a listener firing means "refetch the newest
 * page". `notify` always emits via PG (rather than fanning out in-process directly)
 * so a future multi-process deployment keeps working — every process LISTENing on
 * the user's DB receives it.
 */
export interface TimelineHub {
  /**
   * Register a listener for a user's live updates. Resolves once the channel is
   * live (so an open failure surfaces to the caller, which can fall back to
   * polling) and returns an unsubscribe.
   */
  subscribe: (user: string, onEvent: () => void) => Promise<() => Promise<void>>
  /** Signal that a user's timeline gained a new post. */
  notify: (user: string) => Promise<void>
}

export interface TimelineHubDeps {
  /** Open the PG notify channel for a user, invoking `onNotify` per ping; resolves to a teardown. */
  openChannel: (user: string, onNotify: () => void) => Promise<() => Promise<void>>
  /** Emit a PG notify ping for a user. */
  emit: (user: string) => Promise<void>
}

interface UserChannel {
  listeners: Set<() => void>
  /** Resolves to the channel teardown; rejects if opening failed. */
  ready: Promise<() => Promise<void>>
}

export const createTimelineHub = (deps: TimelineHubDeps): TimelineHub => {
  const channels = new Map<string, UserChannel>()

  const subscribe = async (user: string, onEvent: () => void): Promise<() => Promise<void>> => {
    let channel = channels.get(user)
    if (!channel) {
      // Reserve the slot synchronously (before any await) so concurrent subscribes
      // for the same user share a single channel rather than racing to open two.
      const listeners = new Set<() => void>()
      const ready = deps.openChannel(user, () => {
        for (const listener of listeners) listener()
      })
      const reserved: UserChannel = { listeners, ready }
      channels.set(user, reserved)
      // If opening fails, drop the slot so a later subscribe can retry cleanly.
      ready.catch(() => {
        if (channels.get(user) === reserved) channels.delete(user)
      })
      channel = reserved
    }
    channel.listeners.add(onEvent)
    await channel.ready

    return async () => {
      const current = channels.get(user)
      if (!current) return
      current.listeners.delete(onEvent)
      if (current.listeners.size === 0) {
        channels.delete(user)
        const teardown = await current.ready.catch(() => null)
        if (teardown) await teardown().catch(() => {})
      }
    }
  }

  const notify = (user: string): Promise<void> => deps.emit(user)

  return { notify, subscribe }
}
