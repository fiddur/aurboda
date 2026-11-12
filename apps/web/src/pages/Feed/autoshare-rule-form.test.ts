import type { AutoshareRule } from '@aurboda/api-spec'

import { describe, expect, it } from 'vitest'

import {
  dataFilterToRow,
  emptyRuleFormState,
  formStateTagsText,
  formStateToAddBody,
  formStateToUpdateBody,
  ruleToFormState,
} from './autoshare-rule-form'
import { rowToDataFilter } from './autoshare-rule-text'

const rule = (over: Partial<AutoshareRule> = {}): AutoshareRule => ({
  activity_types: ['running'],
  created_at: '2026-08-01T00:00:00Z',
  data_filters: [],
  enabled: true,
  enabled_at: '2026-08-01T00:00:00Z',
  id: 'r1',
  include_chart: false,
  include_exercises: false,
  include_map: true,
  included_metrics: ['duration', 'distance'],
  max_age_hours: 48,
  name: 'Long runs',
  series_metrics: [],
  tags: null,
  updated_at: '2026-08-01T00:00:00Z',
  visibility: 'public',
  ...over,
})

describe('dataFilterToRow', () => {
  it('round trips through rowToDataFilter', () => {
    const filters = [
      { field: 'session_name', operator: 'exists' as const },
      { field: 'style', operator: 'eq' as const, value: 'yin' },
      { field: 'style', operator: 'neq' as const, value: 'hatha' },
      { field: 'session_name', operator: 'not_exists' as const },
    ]
    expect(filters.map(dataFilterToRow).map(rowToDataFilter)).toEqual(filters)
  })

  it('stringifies non-string values and blanks a missing one', () => {
    expect(dataFilterToRow({ field: 'laps', operator: 'eq', value: 5 })).toEqual({
      field: 'laps',
      operator: 'eq',
      value: '5',
    })
    expect(dataFilterToRow({ field: 'laps', operator: 'exists' })).toEqual({
      field: 'laps',
      operator: 'exists',
      value: '',
    })
  })
})

describe('ruleToFormState', () => {
  it('prefills every field the form shows', () => {
    const state = ruleToFormState(
      rule({
        data_filters: [{ field: 'style', operator: 'eq', value: 'yin' }],
        include_exercises: true,
        message: 'Out for a run',
        min_distance_meters: 5500,
        min_duration_seconds: 900,
        series_metrics: ['speed'],
        tags: ['running', 'outdoors'],
      }),
    )
    expect(state).toEqual({
      activityType: 'running',
      conditions: [{ field: 'style', operator: 'eq', value: 'yin' }],
      includeExercises: true,
      includeMap: true,
      maxAgeHours: '48',
      message: 'Out for a run',
      minKm: '5.5',
      minMinutes: '15',
      name: 'Long runs',
      ownTags: true,
      series: new Set(['speed']),
      summary: new Set(['duration', 'distance']),
      tagsText: '#running #outdoors',
      visibility: 'public',
    })
  })

  it('leaves unset optional fields blank', () => {
    const state = ruleToFormState(rule())
    expect(state.message).toBe('')
    expect(state.minKm).toBe('')
    expect(state.minMinutes).toBe('')
    expect(state.ownTags).toBe(false)
    expect(state.tagsText).toBe('')
  })

  it('renders numbers without float noise', () => {
    const state = ruleToFormState(rule({ min_distance_meters: 4321, min_duration_seconds: 1000 }))
    expect(state.minKm).toBe('4.321')
    expect(state.minMinutes).toBe('16.67')
  })

  it('puts heart rate in the series when the chart is on', () => {
    expect(ruleToFormState(rule({ include_chart: true })).series).toEqual(new Set(['heart_rate']))
    expect(ruleToFormState(rule({ series_metrics: ['heart_rate'] })).series).toEqual(new Set(['heart_rate']))
  })

  it('leaves the picker empty for a rule with several or no types', () => {
    expect(ruleToFormState(rule({ activity_types: ['running', 'cycling'] })).activityType).toBe('')
    expect(ruleToFormState(rule({ activity_types: [] })).activityType).toBe('')
  })
})

describe('formStateToUpdateBody', () => {
  it('round trips an untouched rule', () => {
    const original = rule({
      data_filters: [{ field: 'style', operator: 'exists' }],
      message: 'Out for a run',
      min_distance_meters: 4321,
      min_duration_seconds: 1000,
      series_metrics: ['heart_rate', 'speed'],
      include_chart: true,
      tags: ['running'],
    })
    expect(formStateToUpdateBody(ruleToFormState(original), original)).toEqual({
      activity_types: ['running'],
      data_filters: [{ field: 'style', operator: 'exists' }],
      include_chart: true,
      include_exercises: false,
      include_map: true,
      included_metrics: ['duration', 'distance'],
      max_age_hours: 48,
      message: 'Out for a run',
      min_distance_meters: 4321,
      min_duration_seconds: 1000,
      name: 'Long runs',
      series_metrics: ['heart_rate', 'speed'],
      tags: ['running'],
      visibility: 'public',
    })
  })

  it('sends null for cleared fields', () => {
    const original = rule({
      message: 'Hi',
      min_distance_meters: 5000,
      min_duration_seconds: 600,
      tags: ['run'],
    })
    const state = { ...ruleToFormState(original), message: '  ', minKm: '', minMinutes: '', ownTags: false }
    expect(formStateToUpdateBody(state, original)).toMatchObject({
      message: null,
      min_distance_meters: null,
      min_duration_seconds: null,
      tags: null,
    })
  })

  it('keeps default tags as null, and empty own tags as none', () => {
    const original = rule({ tags: null })
    expect(formStateToUpdateBody(ruleToFormState(original), original).tags).toBeNull()
    const none = rule({ tags: [] })
    expect(formStateToUpdateBody(ruleToFormState(none), none).tags).toEqual([])
  })

  it('omits activity types for a rule with several, and never sends max duration or source', () => {
    const original = rule({
      activity_types: ['running', 'cycling'],
      max_duration_seconds: 7200,
      source: 'garmin',
    })
    const body = formStateToUpdateBody(ruleToFormState(original), original)
    expect(body).not.toHaveProperty('activity_types')
    expect(body).not.toHaveProperty('max_duration_seconds')
    expect(body).not.toHaveProperty('source')
  })

  it('sends the picked type, or none for any', () => {
    const original = rule()
    expect(
      formStateToUpdateBody({ ...ruleToFormState(original), activityType: 'walking' }, original),
    ).toMatchObject({ activity_types: ['walking'] })
    expect(formStateToUpdateBody({ ...ruleToFormState(original), activityType: '' }, original)).toMatchObject(
      {
        activity_types: [],
      },
    )
  })

  it('keeps metric keys the form does not list', () => {
    const original = rule({ included_metrics: ['duration', 'pace_avg'] })
    expect(formStateToUpdateBody(ruleToFormState(original), original).included_metrics).toEqual([
      'duration',
      'pace_avg',
    ])
  })

  it('keeps stored series keys it does not recognise, after the known ones', () => {
    const original = rule({ series_metrics: ['future_series', 'speed', 'heart_rate'] })
    expect(formStateToUpdateBody(ruleToFormState(original), original).series_metrics).toEqual([
      'heart_rate',
      'speed',
      'future_series',
    ])
  })

  it('rounds a tiny positive minimum duration up to one second', () => {
    const original = rule()
    const body = (minMinutes: string) =>
      formStateToUpdateBody({ ...ruleToFormState(original), minMinutes }, original).min_duration_seconds
    expect(body('0.001')).toBe(1)
    expect(body('0.5')).toBe(30)
    expect(body('0')).toBe(0)
    expect(body('')).toBeNull()
  })
})

describe('formStateToAddBody', () => {
  it('builds the create body from the empty form', () => {
    expect(
      formStateToAddBody({ ...emptyRuleFormState(), name: ' Runs ', minMinutes: '15', minKm: '0.5' }),
    ).toEqual({
      activity_types: [],
      data_filters: [],
      include_chart: false,
      include_exercises: false,
      include_map: false,
      included_metrics: ['duration', 'distance', 'heart_rate_avg', 'heart_rate_max', 'calories'],
      max_age_hours: 24,
      min_distance_meters: 500,
      min_duration_seconds: 900,
      name: 'Runs',
      series_metrics: [],
      visibility: 'followers',
    })
  })

  it('previews an edited rule with the predicate fields the form does not show', () => {
    const original = rule({
      activity_types: ['running', 'cycling'],
      max_duration_seconds: 7200,
      source: 'garmin',
    })
    expect(formStateToAddBody(ruleToFormState(original), original)).toMatchObject({
      activity_types: ['running', 'cycling'],
      max_duration_seconds: 7200,
      source: 'garmin',
    })
  })
})

describe('formStateTagsText', () => {
  it('adds the message hashtags to the default tags', () => {
    expect(formStateTagsText({ ...emptyRuleFormState(), message: '#aurboda #strengthtraining' })).toBe(
      'your default tags + #aurboda #strengthtraining',
    )
  })

  it('counts the message hashtags when own tags are empty', () => {
    expect(
      formStateTagsText({
        ...emptyRuleFormState(),
        message: '#aurboda #strengthtraining',
        ownTags: true,
        tagsText: '',
      }),
    ).toBe('#aurboda #strengthtraining')
  })
})
