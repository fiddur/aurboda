// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { buildViewHash, getDefaultOrientation, parseViewHash, timelineHref } from './viewHash'

describe('parseViewHash', () => {
  it('returns defaults when no hash', () => {
    window.location.hash = ''
    const result = parseViewHash()
    expect(result.from).toBeNull()
    expect(result.to).toBeNull()
    expect(result.hide).toEqual([])
    expect(result.orientation).toBeNull()
  })

  it('parses from and to dates', () => {
    window.location.hash = '#from=2026-01-01T08:00:00.000Z&to=2026-01-01T18:00:00.000Z'
    const result = parseViewHash()
    expect(result.from).toEqual(new Date('2026-01-01T08:00:00.000Z'))
    expect(result.to).toEqual(new Date('2026-01-01T18:00:00.000Z'))
  })

  it('parses hidden categories', () => {
    window.location.hash = '#hide=music,location'
    const result = parseViewHash()
    expect(result.hide).toEqual(['music', 'location'])
  })

  it('maps legacy category names', () => {
    window.location.hash = '#hide=sleep,nap'
    const result = parseViewHash()
    // Both map to sleep_rest, deduped via Set
    expect(result.hide).toEqual(['sleep_rest'])
  })

  it('parses orientation', () => {
    window.location.hash = '#o=h'
    expect(parseViewHash().orientation).toBe('horizontal')

    window.location.hash = '#o=v'
    expect(parseViewHash().orientation).toBe('vertical')
  })

  it('returns null for invalid dates', () => {
    window.location.hash = '#from=invalid'
    expect(parseViewHash().from).toBeNull()
  })
})

describe('buildViewHash', () => {
  it('returns empty string when no state and default orientation', () => {
    const defaultO = getDefaultOrientation()
    expect(buildViewHash(null, null, new Set(), defaultO)).toBe('')
  })

  it('includes from and to dates', () => {
    const start = new Date('2026-01-01T08:00:00.000Z')
    const end = new Date('2026-01-01T18:00:00.000Z')
    const defaultO = getDefaultOrientation()
    const hash = buildViewHash(start, end, new Set(), defaultO)
    expect(hash).toContain('from=')
    expect(hash).toContain('to=')
  })

  it('includes hidden categories', () => {
    const defaultO = getDefaultOrientation()
    const hash = buildViewHash(null, null, new Set(['music', 'location']), defaultO)
    expect(hash).toContain('hide=music')
    expect(hash).toContain('location')
  })

  it('includes orientation when non-default', () => {
    const nonDefault = getDefaultOrientation() === 'horizontal' ? 'vertical' : 'horizontal'
    const hash = buildViewHash(null, null, new Set(), nonDefault)
    expect(hash).toContain('o=')
  })

  it('starts with # when has content', () => {
    const defaultO = getDefaultOrientation()
    const hash = buildViewHash(new Date(), null, new Set(), defaultO)
    expect(hash).toMatch(/^#/)
  })
})

describe('timelineHref', () => {
  it('centres a 24 hour view on the middle of the activity', () => {
    const href = timelineHref(new Date('2026-10-07T10:05:00Z'), new Date('2026-10-07T10:25:00Z'))
    expect(href).toBe('/timeline#from=2026-10-06T22%3A15%3A00.000Z&to=2026-10-07T22%3A15%3A00.000Z')
    window.location.hash = href.slice('/timeline'.length)
    expect(parseViewHash()).toMatchObject({
      from: new Date('2026-10-06T22:15:00Z'),
      to: new Date('2026-10-07T22:15:00Z'),
    })
  })

  it('centres on the start of an activity without an end', () => {
    expect(timelineHref(new Date('2026-10-07T12:00:00Z'))).toBe(
      '/timeline#from=2026-10-07T00%3A00%3A00.000Z&to=2026-10-08T00%3A00%3A00.000Z',
    )
  })
})
