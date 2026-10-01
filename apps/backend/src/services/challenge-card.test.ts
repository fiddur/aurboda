import { describe, expect, test } from 'vitest'

import { describeChallenge, type ResolvedChallenge } from './challenge-card.ts'

const october = (overrides: Partial<ResolvedChallenge> = {}): ResolvedChallenge => ({
  banner_updated_at: null,
  end_ts: '2026-11-01T00:00:00.000Z',
  id: 'c1',
  is_public: true,
  members: [],
  name: 'October steps',
  spec: { pattern: 'steps', source_type: 'metric', unit: 'steps' },
  start_ts: '2026-10-04T00:00:00.000Z',
  timezone: 'UTC',
  ...overrides,
})

describe('describeChallenge', () => {
  test('an upcoming challenge nobody has joined', () => {
    const d = describeChallenge(october(), new Date('2026-10-01T12:00:00Z'))
    expect(d).toMatchObject({
      measure: 'Steps',
      members: [],
      phrase: 'Starts in 3 days',
      range: '4 Oct – 31 Oct 2026',
      status: 'upcoming',
      unit: 'steps',
    })
    expect(d.theme.key).toBe('steps')
  })

  test('an ongoing challenge sorts members by total, unfetched last', () => {
    const d = describeChallenge(
      october({
        members: [
          { cached_total: null, display_name: 'Anna' },
          { cached_total: 500, display_name: 'Bo' },
          { cached_total: 1200, display_name: 'Cecilia' },
        ],
      }),
      new Date('2026-10-20T12:00:00Z'),
    )
    expect(d.status).toBe('ongoing')
    expect(d.phrase).toBe('Ends in 11 days')
    expect(d.members).toEqual([
      { name: 'Cecilia', total: 1200 },
      { name: 'Bo', total: 500 },
      { name: 'Anna', total: null },
    ])
  })

  test('an ended activity-type challenge is measured by the activity name', () => {
    const d = describeChallenge(
      october({ spec: { pattern: 'trail_running', source_type: 'activity_type', unit: 'km' } }),
      new Date('2026-11-05T12:00:00Z'),
    )
    expect(d).toMatchObject({
      measure: 'Trail running',
      phrase: 'Ended 31 Oct 2026',
      status: 'ended',
      unit: 'km',
    })
    expect(d.theme.key).toBe('running')
  })
})
