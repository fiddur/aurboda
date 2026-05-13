import { describe, expect, it } from 'vitest'

import type { Activity } from '../../state/api/types'

import { summarizeActivities } from './activitySummary'

const makeActivity = (overrides: Partial<Activity> & Pick<Activity, 'activity_type'>): Activity =>
  ({
    end_time: new Date('2026-01-01T08:30:00Z'),
    id: 'a1',
    start_time: new Date('2026-01-01T08:00:00Z'),
    ...overrides,
  }) as unknown as Activity

describe('summarizeActivities', () => {
  it('counts generic exercise and HC exercise subtypes as workouts', () => {
    const activities: Activity[] = [
      makeActivity({ activity_type: 'exercise' }),
      makeActivity({ activity_type: 'running' }),
      makeActivity({ activity_type: 'biking' }),
      makeActivity({ activity_type: 'weightlifting' }),
    ]
    const summary = summarizeActivities(activities)
    expect(summary.exerciseCount).toBe(4)
    expect(summary.totalExerciseMinutes).toBe(120) // 4 × 30 min
  })

  it('does not count sleep or meditation as workouts', () => {
    const activities: Activity[] = [
      makeActivity({ activity_type: 'sleep' }),
      makeActivity({ activity_type: 'meditation' }),
      makeActivity({ activity_type: 'running' }),
    ]
    const summary = summarizeActivities(activities)
    expect(summary.exerciseCount).toBe(1)
    expect(summary.sleepCount).toBe(1)
    expect(summary.meditationCount).toBe(1)
  })

  it('averages sleep duration across sleep sessions', () => {
    const activities: Activity[] = [
      makeActivity({
        activity_type: 'sleep',
        end_time: new Date('2026-01-01T08:00:00Z'),
        start_time: new Date('2026-01-01T00:00:00Z'), // 8h
      }),
      makeActivity({
        activity_type: 'sleep',
        end_time: new Date('2026-01-02T06:00:00Z'),
        start_time: new Date('2026-01-02T00:00:00Z'), // 6h
      }),
    ]
    const summary = summarizeActivities(activities)
    expect(summary.avgSleepHours).toBe(7)
  })

  it('returns null avgSleepHours when there are no sleep sessions', () => {
    expect(summarizeActivities([]).avgSleepHours).toBeNull()
  })

  it('skips activities without an end_time when summing duration', () => {
    const activities: Activity[] = [
      makeActivity({ activity_type: 'running' }),
      makeActivity({ activity_type: 'exercise', end_time: undefined }),
    ]
    const summary = summarizeActivities(activities)
    expect(summary.exerciseCount).toBe(2)
    expect(summary.totalExerciseMinutes).toBe(30)
  })
})
