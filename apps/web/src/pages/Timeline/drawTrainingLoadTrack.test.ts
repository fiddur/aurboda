import type { TrainingLoadPoint, WorkoutTrimp } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import { buildTrainingLoadTooltipHtml } from './drawTrainingLoadTrack'

const point: TrainingLoadPoint = {
  activity_impulse: 0,
  atl: 20,
  ctl: 30,
  time: '2024-01-03T10:00:00.000Z',
  training_impulse: 40,
  tsb: 10,
}

const workout = (overrides: Partial<WorkoutTrimp>): WorkoutTrimp => ({
  date: '2024-01-03',
  duration_minutes: 30,
  end_time: '2024-01-03T10:30:00.000Z',
  start_time: '2024-01-03T10:00:00.000Z',
  title: 'Run',
  trimp: 40,
  trimp_basis: 'hr',
  ...overrides,
})

describe('buildTrainingLoadTooltipHtml', () => {
  test('shows the average HR of a workout scored from heart rate', () => {
    expect(buildTrainingLoadTooltipHtml(point, [workout({ avg_hr: 151.4 })])).toContain(
      'Run: 30min, TRIMP 40 (151 bpm avg)',
    )
  })

  test('says when a workout TRIMP is estimated from duration', () => {
    const html = buildTrainingLoadTooltipHtml(point, [
      workout({ avg_hr: 55, trimp: 15, trimp_basis: 'duration_estimate' }),
    ])
    expect(html).toContain('Run: 30min, TRIMP 15 (estimated from duration)')
    expect(html).not.toContain('bpm avg')
  })
})
