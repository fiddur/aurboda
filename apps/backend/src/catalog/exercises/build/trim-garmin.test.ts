import { describe, expect, test } from 'vitest'

import { GARMIN_SOURCE, parseProperties, trimGarmin } from './trim-garmin.ts'

const muscles = { primaryMuscles: ['CHEST'], secondaryMuscles: ['TRICEPS'] }

describe('parseProperties', () => {
  test('splits on the first =, skips comments and lines without =, and the first key wins', () => {
    const properties = parseProperties(
      ['# comment', 'A=Plié Squat', 'no separator', 'B=x=y', 'A=Second', '', 'C='].join('\n'),
    )
    expect([...properties]).toEqual([
      ['A', 'Plié Squat'],
      ['B', 'x=y'],
      ['C', ''],
    ])
  })
})

describe('trimGarmin', () => {
  const trim = (categories: Record<string, string[]>, names: Record<string, string> = {}) =>
    trimGarmin(
      {
        categories: Object.fromEntries(
          Object.entries(categories).map(([category, exercises]) => [
            category,
            { exercises: Object.fromEntries(exercises.map((name) => [name, muscles])) },
          ]),
        ),
      },
      new Map(Object.entries(names)),
    )

  test('looks names up as CATEGORY_NAME, then exercise_type_CATEGORY_NAME, then exercise_type_NAME', () => {
    const names = {
      BANDED_EXERCISES_CURL: 'Banded Curl',
      CURL_CURL: 'Curl',
      exercise_type_CURL: 'Generic Curl',
      exercise_type_CURL_HAMMER_CURL: 'Hammer Curl',
      exercise_type_ROW: 'Row',
    }
    expect(trim({ BANDED_EXERCISES: ['CURL'], CURL: ['CURL', 'HAMMER_CURL', 'ROW'] }, names).entries).toEqual(
      [
        { fit: 'banded_exercises/curl', name: 'Banded Curl' },
        { fit: 'curl/curl', name: 'Curl' },
        { fit: 'curl/hammer_curl', name: 'Hammer Curl' },
        { fit: 'curl/row', name: 'Row' },
      ],
    )
  })

  test('falls back to the title-cased name', () => {
    expect(trim({ SLED: ['_BACKWARD_DRAG_', 'PULL'] }).entries.map((e) => e.name)).toEqual([
      'Backward Drag',
      'Pull',
    ])
  })

  test('leaves out the cardio and machine categories', () => {
    const skipped = [
      'RUN',
      'RUN_INDOOR',
      'BIKE_OUTDOOR',
      'INDOOR_BIKE',
      'ELLIPTICAL',
      'STAIR_STEPPER',
      'FLOOR_CLIMB',
      'CARDIO',
    ]
    const trimmed = trim({ ...Object.fromEntries(skipped.map((c) => [c, ['X']])), PLANK: ['PLANK'] })
    expect(trimmed.entries.map((e) => e.fit)).toEqual(['plank/plank'])
  })

  test('sorts by FIT key and keeps only fit and name', () => {
    const trimmed = trim({ SQUAT: ['SQUAT', 'AIR_SQUAT'], CRUNCH: ['CRUNCH'] })
    expect(trimmed).toEqual({
      entries: [
        { fit: 'crunch/crunch', name: 'Crunch' },
        { fit: 'squat/air_squat', name: 'Air Squat' },
        { fit: 'squat/squat', name: 'Squat' },
      ],
      source: GARMIN_SOURCE,
    })
    expect(JSON.stringify(trimmed)).not.toMatch(/Muscles|CHEST|TRICEPS/)
  })
})
