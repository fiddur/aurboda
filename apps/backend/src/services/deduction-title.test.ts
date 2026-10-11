import { describe, expect, test } from 'vitest'

import { activityTypeTitleNames, ruleTitleChange } from './deduction-title.ts'

const RULE = 'rule-1'
const typeNames = ['Yoga']
const session = 'Heart-Opening Yin Yoga with Jade'
const change = { data: { _titled_by: RULE, _titled_value: session }, title: session }

describe('ruleTitleChange', () => {
  test.each([
    ['the type name', 'Yoga'],
    ['the type name in another case', 'yoga '],
    ['a blank title', '  '],
    ['an empty title', ''],
    ['no title', null],
  ])('replaces %s', (_label, title) => {
    expect(
      ruleTitleChange({ data: { session_name: session }, title }, 'session_name', RULE, typeNames),
    ).toEqual(change)
  })

  test('trims the value', () => {
    expect(
      ruleTitleChange(
        { data: { session_name: `  ${session} ` }, title: 'Yoga' },
        'session_name',
        RULE,
        typeNames,
      ),
    ).toEqual(change)
  })

  test('keeps a title typed by hand', () => {
    expect(
      ruleTitleChange(
        { data: { session_name: session }, title: 'Morning flow' },
        'session_name',
        RULE,
        typeNames,
      ),
    ).toBeNull()
  })

  test('overwrites its own previous title when the field changed', () => {
    const data = { _titled_by: RULE, _titled_value: 'Old session', session_name: session }
    expect(ruleTitleChange({ data, title: 'Old session' }, 'session_name', RULE, typeNames)).toEqual(change)
  })

  test('keeps its own previous title once someone changed it', () => {
    const data = { _titled_by: RULE, _titled_value: 'Old session', session_name: session }
    expect(ruleTitleChange({ data, title: 'Renamed by hand' }, 'session_name', RULE, typeNames)).toBeNull()
  })

  test('does not take over a title another rule wrote', () => {
    const data = { _titled_by: 'other-rule', _titled_value: 'Old session', session_name: session }
    expect(ruleTitleChange({ data, title: 'Old session' }, 'session_name', RULE, typeNames)).toBeNull()
  })

  test.each([
    ['missing', {}],
    ['blank', { session_name: '   ' }],
    ['a number', { session_name: 42 }],
    ['null', { session_name: null }],
  ])('never clears a title when the field is %s', (_label, data) => {
    expect(ruleTitleChange({ data, title: 'Yoga' }, 'session_name', RULE, typeNames)).toBeNull()
  })

  test('no change when the title already is the value', () => {
    expect(
      ruleTitleChange(
        { data: { session_name: session }, title: ` ${session}` },
        'session_name',
        RULE,
        typeNames,
      ),
    ).toBeNull()
  })

  test('handles activities without data', () => {
    expect(ruleTitleChange({ data: null, title: 'Yoga' }, 'session_name', RULE, typeNames)).toBeNull()
  })
})

describe('activityTypeTitleNames', () => {
  test('lists the display name and the prettified key', () => {
    expect(activityTypeTitleNames('other_workout', 'Other workout')).toEqual([
      'Other workout',
      'Other workout',
    ])
    expect(activityTypeTitleNames('trail_running', 'Trail run')).toEqual(['Trail run', 'Trail running'])
  })

  test('falls back to the key without a display name', () => {
    expect(activityTypeTitleNames('yoga')).toEqual(['Yoga'])
    expect(activityTypeTitleNames('yoga', ' ')).toEqual(['Yoga'])
  })
})
