import { describe, expect, it } from 'vitest'

import { losslessIntegerReviver, parseStravaJson, stravaIdOf, toStravaId } from './ids.ts'

const ABOVE_SAFE = '9007199254740993'
const INT64_MAX = '9223372036854775807'

describe('parseStravaJson', () => {
  it('keeps an id above 2^53 exact where JSON.parse rounds it', () => {
    expect(JSON.parse(ABOVE_SAFE)).toBe(9007199254740992)
    expect(parseStravaJson(ABOVE_SAFE)).toBe(ABOVE_SAFE)
  })

  it('keeps the int64 max exact', () => {
    expect(parseStravaJson(`{"id":${INT64_MAX}}`)).toEqual({ id: INT64_MAX })
  })

  it('leaves safe integers, floats, exponents and strings alone', () => {
    expect(parseStravaJson('{"a":12345,"b":1.5,"c":1e21,"d":"9007199254740993","e":-7}')).toEqual({
      a: 12345,
      b: 1.5,
      c: 1e21,
      d: ABOVE_SAFE,
      e: -7,
    })
  })

  it('works in nested objects and arrays', () => {
    expect(
      parseStravaJson(`[{"id":${ABOVE_SAFE},"athlete":{"id":42}},{"id":7,"laps":[{"id":${INT64_MAX}}]}]`),
    ).toEqual([
      { athlete: { id: 42 }, id: ABOVE_SAFE },
      { id: 7, laps: [{ id: INT64_MAX }] },
    ])
  })

  it('keeps a big negative integer exact too', () => {
    expect(parseStravaJson('-9007199254740993')).toBe('-9007199254740993')
  })

  it('returns the value untouched without a source context', () => {
    expect(losslessIntegerReviver('id', 9007199254740992)).toBe(9007199254740992)
  })
})

describe('toStravaId', () => {
  it.each([
    [12345, '12345'],
    ['12345', '12345'],
    [ABOVE_SAFE, ABOVE_SAFE],
    [INT64_MAX, INT64_MAX],
    ['9223372036854775808', null],
    ['12345678901234567890', null],
    [0, null],
    ['0', null],
    [-5, null],
    ['-5', null],
    [1.5, null],
    [9007199254740992, null],
    [Number.NaN, null],
    ['123456789012345678901', null],
    ['012', null],
    ['12a', null],
    [' 12', null],
    ['', null],
    [{}, null],
    [null, null],
    [undefined, null],
  ])('%j gives %j', (input, expected) => {
    expect(toStravaId(input)).toBe(expected)
  })
})

describe('stravaIdOf', () => {
  it('prefers id_str', () => {
    expect(stravaIdOf({ id: 9007199254740992, id_str: ABOVE_SAFE })).toBe(ABOVE_SAFE)
  })

  it('falls back to a number id', () => {
    expect(stravaIdOf({ id: 4242 })).toBe('4242')
  })

  it('falls back to a string id when id_str is not usable', () => {
    expect(stravaIdOf({ id: INT64_MAX, id_str: 'nope' })).toBe(INT64_MAX)
  })

  it('throws when neither is usable', () => {
    expect(() => stravaIdOf({ id: 9007199254740992 })).toThrow('Strava object has no usable id')
  })
})
