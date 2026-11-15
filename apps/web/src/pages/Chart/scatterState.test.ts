import { describe, expect, it } from 'vitest'

import { parseScatterQuery, scatterAllowed, scatterParams } from './scatterState'

describe('parseScatterQuery', () => {
  it('defaults to Z3+ minutes, uncoloured', () => {
    expect(parseScatterQuery({})).toEqual({ collapse: false, group_by: '', scatter_y: 'z3_minutes' })
  })

  it('reads the y choice, the field and collapse', () => {
    expect(parseScatterQuery({ collapse: '1', group_by: 'session_name', y: 'avg_hr' })).toEqual({
      collapse: true,
      group_by: 'session_name',
      scatter_y: 'avg_hr',
    })
  })

  it('ignores collapse without a field', () => {
    expect(parseScatterQuery({ collapse: '1' }).collapse).toBe(false)
  })
})

describe('scatterAllowed', () => {
  it('is an activity-type chart only', () => {
    expect(scatterAllowed({ chart_type: 'scatter', source_type: 'activity_type' })).toBe(true)
    expect(scatterAllowed({ chart_type: 'scatter' })).toBe(true)
    expect(scatterAllowed({ chart_type: 'scatter', source_type: 'metric' })).toBe(false)
    expect(scatterAllowed({ chart_type: 'bar', source_type: 'activity_type' })).toBe(false)
  })
})

describe('scatterParams', () => {
  it('round-trips through parseScatterQuery', () => {
    const state = { collapse: true, group_by: 'place', scatter_y: 'avg_hr' as const }
    expect(scatterParams(state)).toEqual({ collapse: '1', group_by: 'place', y: 'avg_hr' })
    expect(parseScatterQuery(scatterParams(state))).toEqual(state)
  })

  it('leaves out the field and collapse when uncoloured', () => {
    expect(scatterParams({ collapse: true, group_by: '', scatter_y: 'z3_minutes' })).toEqual({
      y: 'z3_minutes',
    })
  })
})
