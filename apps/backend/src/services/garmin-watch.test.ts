import type { ActivityTypeDefinition } from '@aurboda/api-spec'

import { beforeEach, describe, expect, test, vi } from 'vitest'

import * as db from '../db/index.ts'
import { findGarminWatchTypeByCode, getGarminWatchConfig } from './garmin-watch.ts'

vi.mock('../db', () => ({
  getActivityTypeDefinitions: vi.fn(),
  getUserSettings: vi.fn(),
}))

const definition = (name: string, display_name: string): ActivityTypeDefinition => ({
  aliases: [name],
  color: '#000000',
  display_category: 'exercise',
  display_name,
  is_builtin: false,
  name,
  show_on_timeline: true,
})

const sex = { activity_type: 'sex', code: 7, fit_sport: 10, fit_sub_sport: 43, session_name: 'Yoga+' }
const meditation = {
  activity_type: 'meditation',
  code: 3,
  fit_sport: 67,
  fit_sub_sport: 0,
  session_name: 'Meditate',
}
const custom = { activity_type: 'gone_type', code: 9, fit_sport: 0, fit_sub_sport: 0, session_name: 'Gone' }

describe('getGarminWatchConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('returns the stored types in order with display names resolved', async () => {
    vi.mocked(db.getUserSettings).mockResolvedValue({ garmin_watch_types: [sex, meditation, custom] })
    vi.mocked(db.getActivityTypeDefinitions).mockResolvedValue([
      definition('meditation', 'Meditation'),
      definition('sex', 'Sex'),
    ])

    const result = await getGarminWatchConfig('testuser')

    expect(result).toEqual({
      success: true,
      types: [
        { ...sex, display_name: 'Sex' },
        { ...meditation, display_name: 'Meditation' },
        { ...custom, display_name: 'gone_type' },
      ],
    })
  })

  test('returns an empty list when nothing is configured', async () => {
    vi.mocked(db.getUserSettings).mockResolvedValue(null)

    const result = await getGarminWatchConfig('testuser')

    expect(result).toEqual({ success: true, types: [] })
    expect(db.getActivityTypeDefinitions).not.toHaveBeenCalled()
  })
})

describe('findGarminWatchTypeByCode', () => {
  test('finds the entry with the code, or undefined', () => {
    expect(findGarminWatchTypeByCode([sex, meditation], 3)).toBe(meditation)
    expect(findGarminWatchTypeByCode([sex, meditation], 4)).toBeUndefined()
  })
})
