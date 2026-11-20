export type LiveEventKind = 'timeline' | 'notification'

const KINDS: ReadonlySet<string> = new Set<LiveEventKind>(['timeline', 'notification'])

const isLiveEventKind = (name: string): name is LiveEventKind => KINDS.has(name)

const eventName = (block: string): string | null => {
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) return line.slice('event:'.length).trim()
  }
  return null
}

/**
 * Parse an accumulated `/events/stream` buffer: the known event names of its complete
 * blocks, in order, and the unparsed tail to carry into the next chunk. Comments
 * (heartbeats) and unknown event names are skipped.
 */
export const parseLiveEvents = (buffer: string): { events: LiveEventKind[]; rest: string } => {
  const blocks = buffer.replaceAll('\r\n', '\n').split('\n\n')
  const rest = blocks.pop() ?? ''
  const events: LiveEventKind[] = []
  for (const block of blocks) {
    const name = eventName(block)
    if (name != null && isLiveEventKind(name)) events.push(name)
  }
  return { events, rest }
}
