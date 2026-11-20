import type { ActivityTypeDefinition } from '@aurboda/api-spec'

import { nutrientKeySchema } from '@aurboda/api-spec'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import * as db from '../../db/index.ts'
import { getCorrelationSelectors } from './discovery.ts'

vi.mock('../../db/index.ts', () => ({
  getActivityTypeDefinitions: vi.fn(),
  getDistinctMetrics: vi.fn(),
  getScreentimeCategories: vi.fn(),
  listPeopleWithActivities: vi.fn(),
  listSensitivityFlags: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(db.getDistinctMetrics).mockResolvedValue(['hrv', 'weight'])
  vi.mocked(db.getActivityTypeDefinitions).mockResolvedValue([
    { display_name: 'Running', is_builtin: true, name: 'running' },
    { display_name: 'Sauna', is_builtin: false, name: 'sauna' },
  ] as unknown as ActivityTypeDefinition[])
  vi.mocked(db.getScreentimeCategories).mockResolvedValue([
    { name: ['Work', 'Programming'] },
  ] as unknown as db.ScreentimeCategory[])
  vi.mocked(db.listPeopleWithActivities).mockResolvedValue([
    { id: '11111111-1111-4111-8111-111111111111', name: 'Anna' },
  ])
  vi.mocked(db.listSensitivityFlags).mockResolvedValue([
    { id: 'flag-1', name: 'gluten' },
  ] as unknown as db.SensitivityFlag[])
})

describe('getCorrelationSelectors', () => {
  test('lists every dimension with labels and values', async () => {
    expect(await getCorrelationSelectors('user')).toEqual({
      activity_types: [
        { label: 'Running', value: 'running' },
        { label: 'Sauna', value: 'sauna' },
      ],
      metrics: [
        { label: 'hrv', value: 'hrv' },
        { label: 'weight', value: 'weight' },
      ],
      nutrients: nutrientKeySchema.options.map((n) => ({ label: n, value: n })),
      people: [
        { label: 'Time with people', value: '' },
        { label: 'Anna', value: '11111111-1111-4111-8111-111111111111' },
      ],
      productivity_categories: [{ label: 'Work > Programming', value: 'Work > Programming' }],
      sensitivities: [{ label: 'gluten', value: 'flag-1' }],
      tags: [{ label: 'Sauna', value: 'sauna' }],
    })
  })

  test('looks for metrics with data over the last year', async () => {
    await getCorrelationSelectors('user')
    const [user, start, end] = vi.mocked(db.getDistinctMetrics).mock.calls[0]
    expect(user).toBe('user')
    expect(end.getTime() - start.getTime()).toBe(365 * 86_400_000)
  })
})
