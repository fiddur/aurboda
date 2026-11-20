import type { LiveEventKind } from '../db/live-notify.ts'

export type { LiveEventKind }

/**
 * In-process fan-out of a user's live updates to their open SSE streams.
 *
 * The hub keeps at most **one** Postgres `LISTEN` channel open per user, whatever
 * the number of streams, and closes it when the last one disconnects. `notify`
 * always emits through PG rather than fanning out in-process, so a multi-process
 * deployment keeps working: every process listening on the user's DB receives it.
 */
export interface LiveHub {
  /**
   * Resolves once the channel is live, so an open failure surfaces to the caller
   * (which can fall back to polling), and returns an unsubscribe.
   */
  subscribe: (user: string, onEvent: (kind: LiveEventKind) => void) => Promise<() => Promise<void>>
  notify: (user: string, kind: LiveEventKind) => Promise<void>
}

export interface LiveHubDeps {
  openChannel: (user: string, onEvent: (kind: LiveEventKind) => void) => Promise<() => Promise<void>>
  emit: (user: string, kind: LiveEventKind) => Promise<void>
}

interface UserChannel {
  listeners: Set<(kind: LiveEventKind) => void>
  /** Resolves to the channel teardown; rejects if opening failed. */
  ready: Promise<() => Promise<void>>
}

export const createLiveHub = (deps: LiveHubDeps): LiveHub => {
  const channels = new Map<string, UserChannel>()

  const subscribe = async (
    user: string,
    onEvent: (kind: LiveEventKind) => void,
  ): Promise<() => Promise<void>> => {
    let channel = channels.get(user)
    if (!channel) {
      // Reserve the slot synchronously (before any await) so concurrent subscribes
      // for the same user share a single channel rather than racing to open two.
      const listeners = new Set<(kind: LiveEventKind) => void>()
      const ready = deps.openChannel(user, (kind) => {
        for (const listener of listeners) listener(kind)
      })
      const reserved: UserChannel = { listeners, ready }
      channels.set(user, reserved)
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

  const notify = (user: string, kind: LiveEventKind): Promise<void> => deps.emit(user, kind)

  return { notify, subscribe }
}
