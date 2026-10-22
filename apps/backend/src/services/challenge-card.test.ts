import { describe, expect, test } from 'vitest'

import { cardMembers, countJoined, describeChallenge, type ResolvedChallenge } from './challenge-card.ts'

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
      joined: 0,
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
          { cached_total: null, display_name: 'Anna', is_host: true },
          { cached_total: 500, display_name: 'Bo', is_host: false },
          { cached_total: 1200, display_name: 'Cecilia', is_host: false },
        ],
      }),
      new Date('2026-10-20T12:00:00Z'),
    )
    expect(d.status).toBe('ongoing')
    expect(d.phrase).toBe('Ends in 11 days')
    expect(d.joined).toBe(2)
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

describe('cardMembers', () => {
  const member = (
    overrides: Partial<Parameters<typeof cardMembers>[0][number]> = {},
  ): Parameters<typeof cardMembers>[0][number] => ({
    cached_total: null,
    display_name: 'fiddur',
    kind: 'local',
    local_user: 'fiddur',
    status: 'active',
    ...overrides,
  })

  test("flags the owner's own local membership as the host", () => {
    expect(cardMembers([member()], 'fiddur')).toEqual([
      { cached_total: null, display_name: 'fiddur', is_host: true },
    ])
  })

  test('another local user or a remote member is not the host, and withdrawn members are left out', () => {
    const members = cardMembers(
      [
        member(),
        member({ display_name: 'anna', local_user: 'anna' }),
        member({ display_name: 'bo@elsewhere', kind: 'remote', local_user: null }),
        member({ display_name: 'cecilia', local_user: 'cecilia', status: 'withdrawn' }),
      ],
      'fiddur',
    )
    expect(members.map((m) => [m.display_name, m.is_host])).toEqual([
      ['fiddur', true],
      ['anna', false],
      ['bo@elsewhere', false],
    ])
  })
})

describe('countJoined', () => {
  test('a challenge with only its host has nobody joined', () => {
    expect(countJoined([{ is_host: true }])).toBe(0)
  })

  test('the host plus two others is two joined', () => {
    expect(countJoined([{ is_host: true }, { is_host: false }, { is_host: false }])).toBe(2)
  })
})
