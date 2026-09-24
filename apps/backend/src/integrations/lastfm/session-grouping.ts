export interface TimestampedEvent {
  readonly timestamp: Date
}

export interface Session<T> {
  readonly events: T[]
  readonly startTime: Date
  readonly endTime: Date
}

/**
 * @param events - Events sorted ascending by timestamp
 * @param maxGapMs - Maximum gap in milliseconds between consecutive events in the same session
 */
export const groupIntoSessions = <T extends TimestampedEvent>(
  events: T[],
  maxGapMs: number,
): Session<T>[] => {
  if (events.length === 0) return []

  const sessions: Session<T>[] = []
  let currentEvents: T[] = [events[0]]

  for (let i = 1; i < events.length; i++) {
    const gap = events[i].timestamp.getTime() - events[i - 1].timestamp.getTime()
    if (gap <= maxGapMs) {
      currentEvents.push(events[i])
    } else {
      sessions.push({
        endTime: currentEvents[currentEvents.length - 1].timestamp,
        events: currentEvents,
        startTime: currentEvents[0].timestamp,
      })
      currentEvents = [events[i]]
    }
  }

  sessions.push({
    endTime: currentEvents[currentEvents.length - 1].timestamp,
    events: currentEvents,
    startTime: currentEvents[0].timestamp,
  })

  return sessions
}
