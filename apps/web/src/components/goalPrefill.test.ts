import { describe, expect, test } from 'vitest'

import { goalFromQuery, goalsHref } from './goalPrefill'

const ID = 'a0000001-0000-4000-8000-000000000001'

const queryOf = (href: string): Record<string, string> =>
  Object.fromEntries(new URLSearchParams(href.split('?')[1]))

describe('goalsHref', () => {
  test('an EMA trend goal with only the fields given', () => {
    expect(
      goalsHref({
        display_period: 'weekly',
        half_life_days: 15,
        new: 'trend',
        pattern: 'coffee',
        source_type: 'activity_type',
      }),
    ).toBe(
      '/goals?new=trend&source_type=activity_type&pattern=coffee&half_life_days=15&display_period=weekly',
    )
  })

  test('a measure trend goal carries the measure and its filter', () => {
    expect(
      queryOf(
        goalsHref({
          filter_field: 'sets.exercise',
          filter_value: 'Squat',
          half_life_days: 120,
          measure: 'e1rm',
          new: 'trend',
          pattern: 'strength_training',
          source_type: 'activity_type',
        }),
      ),
    ).toEqual({
      filter_field: 'sets.exercise',
      filter_value: 'Squat',
      half_life_days: '120',
      measure: 'e1rm',
      new: 'trend',
      pattern: 'strength_training',
      source_type: 'activity_type',
    })
  })

  test('a measure goal; a filter needs both parts', () => {
    expect(
      goalsHref({
        activity_type: 'strength_training',
        filter_value: 'Squat',
        measure: 'volume',
        new: 'measure',
      }),
    ).toBe('/goals?new=measure&activity_type=strength_training&measure=volume')
  })
})

describe('goalFromQuery', () => {
  test('an EMA trend goal with the defaults filled in and no target', () => {
    expect(goalFromQuery({ new: 'trend', pattern: 'coffee', source_type: 'activity_type' }, ID)).toEqual({
      display_period: 'monthly',
      goal_type: 'trend',
      half_life_days: 15,
      id: ID,
      pattern: 'coffee',
      source_type: 'activity_type',
    })
  })

  test('keeps a valid aggregation and display period, drops invalid ones', () => {
    expect(
      goalFromQuery(
        {
          aggregation: 'sum',
          display_period: 'weekly',
          half_life_days: '30',
          new: 'trend',
          pattern: 'weight',
          source_type: 'metric',
        },
        ID,
      ),
    ).toMatchObject({ aggregation: 'sum', display_period: 'weekly', half_life_days: 30 })
    const goal = goalFromQuery(
      {
        aggregation: 'max',
        display_period: 'yearly',
        new: 'trend',
        pattern: 'weight',
        source_type: 'metric',
      },
      ID,
    )
    expect(goal).not.toHaveProperty('aggregation')
    expect(goal).toMatchObject({ display_period: 'monthly' })
  })

  test('a measure trend goal round-trips from its href, 120 days by default', () => {
    const href = goalsHref({
      filter_field: 'sets.exercise',
      filter_value: 'Squat',
      measure: 'e1rm',
      new: 'trend',
      pattern: 'strength_training',
      source_type: 'activity_type',
    })
    expect(goalFromQuery(queryOf(href), ID)).toEqual({
      display_period: 'monthly',
      filter_field: 'sets.exercise',
      filter_value: 'Squat',
      goal_type: 'trend',
      half_life_days: 120,
      id: ID,
      measure: 'e1rm',
      pattern: 'strength_training',
      source_type: 'activity_type',
    })
  })

  test('an unknown measure leaves out the measure and its filter', () => {
    const goal = goalFromQuery(
      {
        filter_field: 'sets.exercise',
        filter_value: 'Squat',
        measure: 'bogus',
        new: 'trend',
        pattern: 'strength_training',
        source_type: 'activity_type',
      },
      ID,
    )
    expect(goal).not.toHaveProperty('measure')
    expect(goal).not.toHaveProperty('filter_field')
    expect(goal).toMatchObject({ half_life_days: 15 })
  })

  test('a measure goal with its default aggregation and window', () => {
    const href = goalsHref({
      activity_type: 'strength_training',
      filter_field: 'sets.exercise',
      filter_value: 'Squat',
      measure: 'e1rm',
      new: 'measure',
    })
    expect(goalFromQuery(queryOf(href), ID)).toEqual({
      activity_type: 'strength_training',
      aggregation: 'max',
      filter_field: 'sets.exercise',
      filter_value: 'Squat',
      goal_type: 'measure',
      id: ID,
      measure: 'e1rm',
      window: '30d',
    })
    expect(
      goalFromQuery({ activity_type: 'strength_training', measure: 'volume', new: 'measure' }, ID),
    ).toMatchObject({ aggregation: 'sum' })
  })

  test('nothing for anything else', () => {
    expect(goalFromQuery({}, ID)).toBeUndefined()
    expect(goalFromQuery({ new: 'metric' }, ID)).toBeUndefined()
    expect(goalFromQuery({ new: 'trend', pattern: 'coffee' }, ID)).toBeUndefined()
    expect(goalFromQuery({ new: 'trend', pattern: 'coffee', source_type: 'bogus' }, ID)).toBeUndefined()
    expect(goalFromQuery({ new: 'measure', activity_type: 'strength_training' }, ID)).toBeUndefined()
    expect(goalFromQuery({ measure: 'e1rm', new: 'measure' }, ID)).toBeUndefined()
  })
})
