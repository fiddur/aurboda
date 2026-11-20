import { describe, expect, test } from 'vitest'

import { parseLiveEvents } from './live-sse'

describe('parseLiveEvents', () => {
  test('returns the names of complete events in order and carries the partial tail', () => {
    const { events, rest } = parseLiveEvents(
      'event: timeline\ndata: {}\n\nevent: notification\ndata: {}\n\nevent: noti',
    )
    expect(events).toEqual(['timeline', 'notification'])
    expect(rest).toBe('event: noti')
  })

  test('skips comment heartbeats', () => {
    expect(parseLiveEvents(': connected\n\n: ping\n\n')).toEqual({ events: [], rest: '' })
  })

  test('holds back an event still buffering', () => {
    expect(parseLiveEvents('event: timeline\ndata: {}')).toEqual({
      events: [],
      rest: 'event: timeline\ndata: {}',
    })
  })

  test('reassembles an event split across chunks', () => {
    const first = parseLiveEvents('event: notif')
    expect(first.events).toEqual([])
    const second = parseLiveEvents(first.rest + 'ication\ndata: {}\n')
    expect(second.events).toEqual([])
    const third = parseLiveEvents(second.rest + '\n')
    expect(third).toEqual({ events: ['notification'], rest: '' })
  })

  test('accepts CRLF line endings, also when the pair is split across chunks', () => {
    expect(parseLiveEvents('event: timeline\r\ndata: {}\r\n\r\n')).toEqual({ events: ['timeline'], rest: '' })
    const first = parseLiveEvents('event: notification\r\ndata: {}\r\n\r')
    expect(first.events).toEqual([])
    expect(parseLiveEvents(first.rest + '\n').events).toEqual(['notification'])
  })

  test('ignores unknown event names and unnamed events', () => {
    const { events } = parseLiveEvents(
      'event: new\ndata: {}\n\nevent: other\n\ndata: {}\n\nevent: timeline\n\n',
    )
    expect(events).toEqual(['timeline'])
  })
})
