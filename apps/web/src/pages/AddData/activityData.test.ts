import type { DataFieldDefinition } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import { buildActivityData } from './activityData'

const fields: DataFieldDefinition[] = [
  { name: 'session_name', type: 'string' },
  { name: 'weight', type: 'number', unit: 'kg' },
  { name: 'props', type: 'boolean' },
  {
    item_fields: [
      { name: 'exercise', required: true, type: 'string' },
      { name: 'weight', type: 'number', unit: 'kg' },
      { name: 'reps', type: 'number' },
      { name: 'time', type: 'number', unit: 's' },
    ],
    label: 'Sets',
    name: 'sets',
    type: 'list',
  },
]

describe('buildActivityData', () => {
  test('is undefined when nothing is filled in', () => {
    expect(buildActivityData(fields, {}, {})).toBeUndefined()
    expect(
      buildActivityData(fields, { props: '', session_name: '  ', weight: '' }, { sets: [{}] }),
    ).toBeUndefined()
    expect(buildActivityData([], {}, {})).toBeUndefined()
  })

  test('converts scalars to their declared types', () => {
    expect(buildActivityData(fields, { props: 'true', session_name: ' Flow ', weight: '72.5' }, {})).toEqual({
      props: true,
      session_name: 'Flow',
      weight: 72.5,
    })
  })

  test('drops numbers that do not parse and booleans that are not true', () => {
    expect(buildActivityData(fields, { props: 'false', weight: 'abc' }, {})).toBeUndefined()
  })

  test('keeps the filled rows of a list, without their blank values', () => {
    const sets = [
      { exercise: 'Bench press', reps: 10, time: null, weight: 80 },
      { exercise: '', reps: null, weight: null },
      { exercise: 'Plank', reps: '', time: 60 },
    ]
    expect(buildActivityData(fields, {}, { sets })).toEqual({
      sets: [
        { exercise: 'Bench press', reps: 10, weight: 80 },
        { exercise: 'Plank', time: 60 },
      ],
    })
  })

  test('parses item numbers that arrive as strings', () => {
    expect(
      buildActivityData(fields, {}, { sets: [{ exercise: 'Squat', reps: '5', weight: '100.5' }] }),
    ).toEqual({
      sets: [{ exercise: 'Squat', reps: 5, weight: 100.5 }],
    })
  })

  test('ignores values for fields the schema does not declare', () => {
    expect(buildActivityData(fields, { other: 'x' }, { laps: [{ a: 1 }] })).toBeUndefined()
  })
})
