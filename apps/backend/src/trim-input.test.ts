import { describe, expect, test } from 'vitest'

import { trimStrings, UNTRIMMED_KEYS } from './trim-input.ts'

describe('trimStrings', () => {
  test('trims a bare string', () => {
    expect(trimStrings('  yoga \t\n')).toBe('yoga')
  })

  test('keeps internal whitespace', () => {
    expect(trimStrings({ title: '  Morning  run ' })).toEqual({ title: 'Morning  run' })
  })

  test('a whitespace-only string becomes empty', () => {
    expect(trimStrings({ title: '   ' })).toEqual({ title: '' })
  })

  test('trims nested objects and arrays', () => {
    expect(
      trimStrings({
        activity_type: 'running ',
        data: { gear: ' shoes ', laps: [' a', { name: 'b ' }] },
        tags: [' x ', 'y '],
      }),
    ).toEqual({
      activity_type: 'running',
      data: { gear: 'shoes', laps: ['a', { name: 'b' }] },
      tags: ['x', 'y'],
    })
  })

  test('keeps untrimmed keys at any depth, including the whole subtree', () => {
    expect(
      trimStrings({
        conditions: [{ pattern: ' ^a ', type: ' tag ' }],
        data: { content: ' # Heading\n', title: ' T ' },
        password: ' secret ',
        rule: { rule_regex: { nested: ' x ' } },
        username: ' fredrik ',
      }),
    ).toEqual({
      conditions: [{ pattern: ' ^a ', type: 'tag' }],
      data: { content: ' # Heading\n', title: 'T' },
      password: ' secret ',
      rule: { rule_regex: { nested: ' x ' } },
      username: 'fredrik',
    })
  })

  test('every listed key is kept', () => {
    const input = Object.fromEntries([...UNTRIMMED_KEYS].map((key) => [key, ` ${key} `]))
    expect(trimStrings(input)).toEqual(input)
  })

  test('leaves non-strings untouched', () => {
    const date = new Date('2024-01-01T00:00:00Z')
    const buffer = Buffer.from(' x ')
    const map = new Map([['k', ' v ']])
    const result = trimStrings({
      buffer,
      date,
      flag: true,
      map,
      n: 1.5,
      none: null,
      undef: undefined,
    }) as Record<string, unknown>
    expect(result.buffer).toBe(buffer)
    expect(result.date).toBe(date)
    expect(result.map).toBe(map)
    expect(result).toMatchObject({ flag: true, n: 1.5, none: null, undef: undefined })
  })

  test('does not mutate the input', () => {
    const input = { data: { name: ' a ' }, list: [' b '], title: ' c ' }
    const snapshot = structuredClone(input)
    const result = trimStrings(input)
    expect(input).toEqual(snapshot)
    expect(result).not.toBe(input)
  })

  test('trims objects with a null prototype', () => {
    const input = Object.assign(Object.create(null) as Record<string, unknown>, { q: ' oat ' })
    expect(trimStrings(input)).toEqual({ q: 'oat' })
  })
})
