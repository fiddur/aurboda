import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { isMultiDaySpan, isReachable, presetRange, rangePresetOf, stepRange } from './rangePreset'

const at = (iso: string) => new Date(iso)
const iso = (range: { start: Date; end: Date }) => [range.start.toISOString(), range.end.toISOString()]

describe('presetRange', () => {
  it('gives the local day around a moment', () => {
    expect(iso(presetRange('day', at('2026-11-15T13:00:00Z')))).toEqual([
      '2026-11-15T00:00:00.000Z',
      '2026-11-15T23:59:59.999Z',
    ])
  })

  it('gives the Monday-to-Sunday week, also from a Sunday', () => {
    expect(iso(presetRange('week', at('2026-11-15T13:00:00Z')))).toEqual([
      '2026-11-09T00:00:00.000Z',
      '2026-11-15T23:59:59.999Z',
    ])
    expect(iso(presetRange('week', at('2026-11-16T00:00:00Z')))).toEqual([
      '2026-11-16T00:00:00.000Z',
      '2026-11-22T23:59:59.999Z',
    ])
  })

  it.each([
    ['2026-02-10T12:00:00Z', '2026-02-01T00:00:00.000Z', '2026-02-28T23:59:59.999Z'],
    ['2028-02-10T12:00:00Z', '2028-02-01T00:00:00.000Z', '2028-02-29T23:59:59.999Z'],
    ['2026-04-30T12:00:00Z', '2026-04-01T00:00:00.000Z', '2026-04-30T23:59:59.999Z'],
    ['2026-12-31T23:00:00Z', '2026-12-01T00:00:00.000Z', '2026-12-31T23:59:59.999Z'],
  ])('gives the calendar month around %s', (moment, start, end) => {
    expect(iso(presetRange('month', at(moment)))).toEqual([start, end])
  })
})

describe('rangePresetOf', () => {
  it('recognises each preset from its own range', () => {
    const moment = at('2026-11-12T09:00:00Z')
    expect(rangePresetOf(presetRange('day', moment).start, presetRange('day', moment).end)).toBe('day')
    expect(rangePresetOf(presetRange('week', moment).start, presetRange('week', moment).end)).toBe('week')
    expect(rangePresetOf(presetRange('month', moment).start, presetRange('month', moment).end)).toBe('month')
  })

  it('tolerates a few minutes off the boundaries, as an hash round trip or a drag leaves them', () => {
    expect(rangePresetOf(at('2026-11-09T00:02:00Z'), at('2026-11-16T00:00:00Z'))).toBe('week')
    expect(rangePresetOf(at('2026-02-01T00:00:00Z'), at('2026-03-01T00:00:00Z'))).toBe('month')
  })

  it('highlights nothing for a free zoom', () => {
    expect(rangePresetOf(at('2026-11-09T00:30:00Z'), at('2026-11-16T00:00:00Z'))).toBeNull()
    expect(rangePresetOf(at('2026-11-10T00:00:00Z'), at('2026-11-17T00:00:00Z'))).toBeNull()
    expect(rangePresetOf(at('2026-11-14T12:00:00Z'), at('2026-11-15T12:00:00Z'))).toBeNull()
  })

  it.each(['2026-02-01', '2028-02-01', '2026-04-01', '2026-01-01'])(
    'recognises the month starting %s whatever its length',
    (first) => {
      const range = presetRange('month', at(`${first}T00:00:00Z`))
      expect(rangePresetOf(range.start, range.end)).toBe('month')
    },
  )
})

describe('stepRange', () => {
  it('steps a day, a week or a month by the active preset', () => {
    expect(iso(stepRange(presetRange('day', at('2026-11-15T12:00:00Z')), -1))[0]).toBe(
      '2026-11-14T00:00:00.000Z',
    )
    expect(iso(stepRange(presetRange('week', at('2026-11-15T12:00:00Z')), 1))).toEqual([
      '2026-11-16T00:00:00.000Z',
      '2026-11-22T23:59:59.999Z',
    ])
    expect(iso(stepRange(presetRange('month', at('2026-03-15T12:00:00Z')), -1))).toEqual([
      '2026-02-01T00:00:00.000Z',
      '2026-02-28T23:59:59.999Z',
    ])
    expect(iso(stepRange(presetRange('month', at('2026-01-31T12:00:00Z')), 1))).toEqual([
      '2026-02-01T00:00:00.000Z',
      '2026-02-28T23:59:59.999Z',
    ])
  })

  it('moves a free zoom by one day', () => {
    expect(iso(stepRange({ end: at('2026-11-15T12:00:00Z'), start: at('2026-11-14T12:00:00Z') }, 1))).toEqual(
      ['2026-11-15T12:00:00.000Z', '2026-11-16T12:00:00.000Z'],
    )
  })
})

describe('isReachable and isMultiDaySpan', () => {
  it('lets a range starting by now through and stops one in the future', () => {
    const now = at('2026-11-15T12:00:00Z')
    expect(isReachable(presetRange('month', now), now)).toBe(true)
    expect(isReachable(presetRange('day', at('2026-11-16T12:00:00Z')), now)).toBe(false)
  })

  it('is over three days for a week but not for a day', () => {
    expect(
      isMultiDaySpan(presetRange('week', at('2026-11-15T12:00:00Z')).start, at('2026-11-15T23:59:59Z')),
    ).toBe(true)
    expect(isMultiDaySpan(at('2026-11-12T00:00:00Z'), at('2026-11-15T00:00:00Z'))).toBe(false)
  })
})

// DST needs a non-UTC zone. Mutating the worker-shared process.env.TZ is off limits
// (#1014), so the module runs in a child Node process with its own TZ.
describe('across daylight saving time', () => {
  it('keeps weeks and months on local midnight and recognises them', { timeout: 20_000 }, () => {
    const moduleUrl = new URL('./rangePreset.ts', import.meta.url).href
    const script = `
      const { presetRange, rangePresetOf, stepRange } = await import(${JSON.stringify(moduleUrl)})
      const show = (r) => [r.start.toISOString(), r.end.toISOString(), rangePresetOf(r.start, r.end)]
      const springWeek = presetRange('week', new Date('2026-03-29T12:00:00+02:00'))
      const autumnMonth = presetRange('month', new Date('2026-10-15T12:00:00+02:00'))
      console.log(JSON.stringify([
        show(springWeek),
        show(autumnMonth),
        show(stepRange(autumnMonth, 1)),
        show(stepRange(presetRange('day', new Date('2026-03-29T12:00:00+02:00')), -1)),
      ]))
    `
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: fileURLToPath(new URL('.', import.meta.url)),
      env: { PATH: process.env.PATH, TZ: 'Europe/Stockholm' },
    })
    expect(JSON.parse(out.toString())).toEqual([
      ['2026-03-22T23:00:00.000Z', '2026-03-29T21:59:59.999Z', 'week'],
      ['2026-09-30T22:00:00.000Z', '2026-10-31T22:59:59.999Z', 'month'],
      ['2026-10-31T23:00:00.000Z', '2026-11-30T22:59:59.999Z', 'month'],
      ['2026-03-27T23:00:00.000Z', '2026-03-28T22:59:59.999Z', 'day'],
    ])
  })
})
