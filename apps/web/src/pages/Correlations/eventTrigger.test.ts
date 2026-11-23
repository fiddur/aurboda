import { describe, expect, test } from 'vitest'

import { eventTriggerLabel, parseMinMinutes, toTriggerCondition } from './eventTrigger'

const ANNA = '11111111-1111-4111-8111-111111111111'
const selectors = {
  people: [
    { label: 'Time with people', value: '' },
    { label: 'Anna', value: ANNA },
  ],
}

describe('toTriggerCondition', () => {
  test('the time with anyone', () => {
    expect(toTriggerCondition({ kind: 'people' }, '')).toEqual({ type: 'people' })
  })

  test('one person, at least N minutes', () => {
    expect(toTriggerCondition({ kind: 'people', person_id: ANNA }, '60')).toEqual({
      person_id: ANNA,
      threshold: { op: 'gte', value: 60 },
      type: 'people',
    })
  })

  test('the other kinds keep their pattern or nutrient', () => {
    expect(toTriggerCondition({ kind: 'activity', pattern: 'run' }, '60')).toEqual({
      pattern: 'run',
      type: 'activity',
    })
    expect(toTriggerCondition({ kind: 'nutrition', nutrient: 'carbs' }, '')).toEqual({
      nutrient: 'carbs',
      type: 'nutrition',
    })
    expect(toTriggerCondition({ kind: 'productivity_app', pattern: 'vim' }, '')).toEqual({
      pattern: 'vim',
      type: 'productivity_app',
    })
  })
})

describe('parseMinMinutes', () => {
  test.each([
    ['', null],
    ['0', null],
    ['-5', null],
    ['1.5', null],
    ['abc', null],
    [' 45 ', 45],
  ])('%j is %j', (raw, expected) => {
    expect(parseMinMinutes(raw)).toBe(expected)
  })
})

describe('eventTriggerLabel', () => {
  test('Time with anyone', () => {
    expect(eventTriggerLabel({ kind: 'people' }, selectors, '')).toBe('Time with anyone')
  })

  test('Time with a named person, with the minimum', () => {
    expect(eventTriggerLabel({ kind: 'people', person_id: ANNA }, selectors, '30')).toBe(
      'Time with Anna (at least 30 min)',
    )
  })

  test('a person no longer listed', () => {
    expect(
      eventTriggerLabel({ kind: 'people', person_id: '22222222-2222-4222-8222-222222222222' }, selectors, ''),
    ).toBe('Time with a person no longer listed')
  })

  test('other kinds read by their value', () => {
    expect(eventTriggerLabel({ kind: 'activity', pattern: 'alcohol' }, selectors, '')).toBe('alcohol')
  })
})
