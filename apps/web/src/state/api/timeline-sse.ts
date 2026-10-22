/**
 * Pure SSE parsing for the live home-timeline stream — kept free of the API
 * config (no `window`) so it's unit-testable in a plain Node environment.
 */

/**
 * Parse an accumulated SSE text buffer: count the complete `event: new` blocks
 * (server pings) and return the unparsed tail. Events are `\n\n`-separated; the
 * trailing partial block is carried over to the next chunk.
 */
export const parseTimelineEvents = (buffer: string): { pings: number; rest: string } => {
  const blocks = buffer.split('\n\n')
  const rest = blocks.pop() ?? ''
  let pings = 0
  for (const block of blocks) {
    if (block.split('\n').some((line) => line.trim() === 'event: new')) pings++
  }
  return { pings, rest }
}
