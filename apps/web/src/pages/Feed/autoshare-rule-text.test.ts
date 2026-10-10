import type { AutoshareRule } from '@aurboda/api-spec'

import { describe, expect, it } from 'vitest'

import {
  dataFilterRowComplete,
  dataFilterSummary,
  newDataFilterRow,
  rowToDataFilter,
  ruleSummary,
} from './autoshare-rule-text'

describe('rowToDataFilter', () => {
  it('drops the value for the presence operators', () => {
    expect(rowToDataFilter({ field: 'session_name', operator: 'exists', value: 'left over' })).toEqual({
      field: 'session_name',
      operator: 'exists',
    })
    expect(rowToDataFilter({ field: 'session_name', operator: 'not_exists', value: '' })).toEqual({
      field: 'session_name',
      operator: 'not_exists',
    })
  })

  it('keeps a trimmed value for eq and neq, and trims the field', () => {
    expect(rowToDataFilter({ field: ' session_name ', operator: 'eq', value: ' Yin yoga ' })).toEqual({
      field: 'session_name',
      operator: 'eq',
      value: 'Yin yoga',
    })
    expect(rowToDataFilter({ field: 'style', operator: 'neq', value: 'hatha' })).toEqual({
      field: 'style',
      operator: 'neq',
      value: 'hatha',
    })
  })
})

describe('dataFilterRowComplete', () => {
  it('needs a data-key field name', () => {
    expect(dataFilterRowComplete(newDataFilterRow('session_name'))).toBe(true)
    expect(dataFilterRowComplete(newDataFilterRow())).toBe(false)
    expect(dataFilterRowComplete({ field: 'Session name', operator: 'exists', value: '' })).toBe(false)
  })

  it('needs a value for eq and neq', () => {
    expect(dataFilterRowComplete({ field: 'style', operator: 'eq', value: '  ' })).toBe(false)
    expect(dataFilterRowComplete({ field: 'style', operator: 'neq', value: '' })).toBe(false)
    expect(dataFilterRowComplete({ field: 'style', operator: 'eq', value: 'yin' })).toBe(true)
  })

  it('a new row defaults to has a value', () => {
    expect(newDataFilterRow('session_name')).toEqual({ field: 'session_name', operator: 'exists', value: '' })
  })
})

describe('dataFilterSummary', () => {
  it('reads each operator', () => {
    expect(dataFilterSummary({ field: 'session_name', operator: 'exists' })).toBe('session name set')
    expect(dataFilterSummary({ field: 'session_name', operator: 'eq', value: 'Yin yoga' })).toBe(
      'session name is Yin yoga',
    )
    expect(dataFilterSummary({ field: 'session_name', operator: 'neq', value: 'X' })).toBe(
      'session name is not X',
    )
    expect(dataFilterSummary({ field: 'session_name', operator: 'not_exists' })).toBe('no session name')
  })

  it('uses a schema label when one is known', () => {
    expect(dataFilterSummary({ field: 'session_name', operator: 'exists' }, 'Session')).toBe('Session set')
  })
})

describe('ruleSummary', () => {
  const rule = (over: Partial<AutoshareRule> = {}): AutoshareRule => ({
    activity_types: ['yoga'],
    created_at: '2026-08-01T00:00:00Z',
    data_filters: [],
    enabled: false,
    enabled_at: null,
    id: 'r1',
    include_chart: false,
    include_map: false,
    included_metrics: [],
    name: 'Named yoga',
    series_metrics: [],
    updated_at: '2026-08-01T00:00:00Z',
    visibility: 'followers',
    ...over,
  })

  it('lists the predicate and the visibility', () => {
    expect(ruleSummary(rule({ min_duration_seconds: 900, source: 'garmin' }))).toBe(
      'yoga, ≥ 15 min, from garmin → followers',
    )
    expect(ruleSummary(rule({ activity_types: [] }))).toBe('any activity → followers')
  })

  it('appends each data condition, with labels when known', () => {
    const filtered = rule({
      data_filters: [
        { field: 'session_name', operator: 'exists' },
        { field: 'style', operator: 'eq', value: 'yin' },
      ],
    })
    expect(ruleSummary(filtered)).toBe('yoga, session name set, style is yin → followers')
    expect(ruleSummary(filtered, (field) => (field === 'style' ? 'Yoga style' : undefined))).toBe(
      'yoga, session name set, Yoga style is yin → followers',
    )
  })
})
