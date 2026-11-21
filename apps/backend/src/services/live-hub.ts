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
   * (which can fall back to polling), and returns an unsubscribe. `onClosed` is called once
   * if the channel drops underneath the subscriber; unsubscribing after that is a no-op.
   */
  subscribe: (
    user: string,
    onEvent: (kind: LiveEventKind) => void,
    onClosed?: () => void,
  ) => Promise<() => Promise<void>>
  notify: (user: string, kind: LiveEventKind) => Promise<void>
}

export interface LiveHubDeps {
  /** `onClosed` is called once when the open channel drops by itself, never on its own teardown. */
  openChannel: (
    user: string,
    onEvent: (kind: LiveEventKind) => void,
    onClosed: () => void,
  ) => Promise<() => Promise<void>>
  emit: (user: string, kind: LiveEventKind) => Promise<void>
}

interface Subscriber {
  onEvent: (kind: LiveEventKind) => void
  onClosed?: () => void
}

interface UserChannel {
  subscribers: Set<Subscriber>
  /** Resolves to the channel teardown; rejects if opening failed. */
  ready: Promise<() => Promise<void>>
  closed: boolean
}

export const createLiveHub = (deps: LiveHubDeps): LiveHub => {
  const channels = new Map<string, UserChannel>()

  // Reserves the slot synchronously (before any await) so concurrent subscribes
  // for the same user share a single channel rather than racing to open two.
  const openChannel = (user: string): UserChannel => {
    const subscribers = new Set<Subscriber>()
    const onClosed = () => {
      if (channel.closed) return
      channel.closed = true
      if (channels.get(user) === channel) channels.delete(user)
      void channel.ready.then((teardown) => teardown()).catch(() => {})
      const told = [...subscribers]
      subscribers.clear()
      for (const subscriber of told) subscriber.onClosed?.()
    }
    const channel: UserChannel = {
      closed: false,
      ready: deps.openChannel(
        user,
        (kind) => {
          for (const subscriber of subscribers) subscriber.onEvent(kind)
        },
        onClosed,
      ),
      subscribers,
    }
    channels.set(user, channel)
    channel.ready.catch(() => {
      if (channels.get(user) === channel) channels.delete(user)
    })
    return channel
  }

  const subscribe = async (
    user: string,
    onEvent: (kind: LiveEventKind) => void,
    onClosed?: () => void,
  ): Promise<() => Promise<void>> => {
    const channel = channels.get(user) ?? openChannel(user)
    const subscriber: Subscriber = { onClosed, onEvent }
    channel.subscribers.add(subscriber)
    await channel.ready

    return async () => {
      if (!channel.subscribers.delete(subscriber)) return
      if (channel.subscribers.size > 0 || channels.get(user) !== channel) return
      channels.delete(user)
      const teardown = await channel.ready.catch(() => null)
      if (teardown) await teardown().catch(() => {})
    }
  }

  const notify = (user: string, kind: LiveEventKind): Promise<void> => deps.emit(user, kind)

  return { notify, subscribe }
}
