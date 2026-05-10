import { beforeEach, describe, expect, test, vi } from 'vitest'

import * as userDb from '../db/user-nutrient-recommendations.ts'
import { getCentralDb } from './central-db.ts'
import { getEffectiveRecommendations } from './nutrient-recommendations.ts'

vi.mock('../db/user-nutrient-recommendations.ts', () => ({
  listUserNutrientRecommendations: vi.fn(),
}))

vi.mock('./central-db.ts', () => ({
  getCentralDb: vi.fn(),
}))

const stubCentral = (
  rows: Array<{
    nutrient_name: string
    recommended_low: number | null
    recommended_high: number | null
    unit: string
    source?: string
    source_version?: string | null
  }>,
) => {
  vi.mocked(getCentralDb).mockReturnValue({
    getAllSharedNutrientRecommendations: async () =>
      rows.map((r) => ({
        nutrient_name: r.nutrient_name,
        recommended_low: r.recommended_low,
        recommended_high: r.recommended_high,
        unit: r.unit,
        source: r.source ?? 'NNR2023',
        source_version: r.source_version ?? '2023',
        notes: null,
        updated_at: new Date(),
      })),
  } as unknown as ReturnType<typeof getCentralDb>)
}

describe('getEffectiveRecommendations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('returns central defaults when there are no overrides', async () => {
    stubCentral([{ nutrient_name: 'protein', recommended_low: 50, recommended_high: 100, unit: 'g' }])
    vi.mocked(userDb.listUserNutrientRecommendations).mockResolvedValue([])

    const result = await getEffectiveRecommendations('user')

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      nutrient_name: 'protein',
      recommended_low: 50,
      recommended_high: 100,
      source: 'central',
      source_label: 'NNR2023 2023',
    })
  })

  test('user override wins over central default', async () => {
    stubCentral([{ nutrient_name: 'protein', recommended_low: 50, recommended_high: 100, unit: 'g' }])
    vi.mocked(userDb.listUserNutrientRecommendations).mockResolvedValue([
      {
        nutrient_name: 'protein',
        recommended_low: 80,
        recommended_high: 200,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ])

    const result = await getEffectiveRecommendations('user')
    expect(result[0]).toMatchObject({
      recommended_low: 80,
      recommended_high: 200,
      source: 'user',
      unit: 'g',
    })
  })

  test('user row with both bounds null suppresses the central default', async () => {
    stubCentral([{ nutrient_name: 'protein', recommended_low: 50, recommended_high: 100, unit: 'g' }])
    vi.mocked(userDb.listUserNutrientRecommendations).mockResolvedValue([
      {
        nutrient_name: 'protein',
        recommended_low: null,
        recommended_high: null,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ])

    const result = await getEffectiveRecommendations('user')
    expect(result).toEqual([])
  })

  test('user row with one null bound keeps the other and drops the central one', async () => {
    stubCentral([{ nutrient_name: 'salt', recommended_low: null, recommended_high: 6, unit: 'g' }])
    vi.mocked(userDb.listUserNutrientRecommendations).mockResolvedValue([
      {
        nutrient_name: 'salt',
        recommended_low: null,
        recommended_high: 5,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ])

    const result = await getEffectiveRecommendations('user')
    expect(result[0]).toMatchObject({
      nutrient_name: 'salt',
      recommended_low: null,
      recommended_high: 5,
      source: 'user',
    })
  })

  test('sorts results by nutrient_name', async () => {
    stubCentral([
      { nutrient_name: 'zinc', recommended_low: 7, recommended_high: 10, unit: 'mg' },
      { nutrient_name: 'iron', recommended_low: 9, recommended_high: 15, unit: 'mg' },
      { nutrient_name: 'calcium', recommended_low: 800, recommended_high: 1000, unit: 'mg' },
    ])
    vi.mocked(userDb.listUserNutrientRecommendations).mockResolvedValue([])

    const result = await getEffectiveRecommendations('user')
    expect(result.map((r) => r.nutrient_name)).toEqual(['calcium', 'iron', 'zinc'])
  })
})
