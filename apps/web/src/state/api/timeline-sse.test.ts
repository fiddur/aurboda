import { describe, expect, test } from 'vitest'

import { parseTimelineEvents } from './timeline-sse'

describe('parseTimelineEvents', () => {
  test('counts complete `event: new` blocks and carries the partial tail', () => {
    const { pings, rest } = parseTimelineEvents('event: new\ndata: {}\n\nevent: new\ndata: {}\n\nevent: ne')
    expect(pings).toBe(2)
    expect(rest).toBe('event: ne')
  })

  test('ignores comment heartbeats (`: connected` / `: ping`)', () => {
    const { pings, rest } = parseTimelineEvents(': connected\n\n: ping\n\n')
    expect(pings).toBe(0)
    expect(rest).toBe('')
  })

  test('does not count a partial event still buffering', () => {
    const { pings, rest } = parseTimelineEvents('event: new\ndata: {}')
    expect(pings).toBe(0)
    expect(rest).toBe('event: new\ndata: {}')
  })

  test('reassembles an event split across two chunks', () => {
    const first = parseTimelineEvents('event: ne')
    expect(first.pings).toBe(0)
    const second = parseTimelineEvents(first.rest + 'w\ndata: {}\n\n')
    expect(second.pings).toBe(1)
    expect(second.rest).toBe('')
  })
})
