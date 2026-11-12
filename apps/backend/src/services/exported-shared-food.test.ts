import { describe, expect, test } from 'vitest'

import {
  type ExportedSharedFoodRow,
  exportedSharedFoodTrailer,
  planSharedFoodReconcile,
  type ReconcileLookup,
  sourceKey,
} from './exported-shared-food.ts'

const row = (overrides: Partial<ExportedSharedFoodRow> = {}): ExportedSharedFoodRow => ({
  id: 'old-1',
  name: 'Apple',
  source: 'livsmedelsverket',
  source_id: '42',
  ...overrides,
})

const lookup = (overrides: Partial<ReconcileLookup> = {}): ReconcileLookup => ({
  centralIdBySource: new Map(),
  centralIds: new Set(),
  userIdBySource: new Map(),
  userIds: new Set(),
  userNamesLower: new Set(),
  ...overrides,
})

describe('planSharedFoodReconcile', () => {
  test('keeps an id the central library has', () => {
    expect(planSharedFoodReconcile([row()], lookup({ centralIds: new Set(['old-1']) }))).toEqual([
      { id: 'old-1', kind: 'keep' },
    ])
  })

  test('keeps an id that is already one of the user’s own items', () => {
    expect(planSharedFoodReconcile([row()], lookup({ userIds: new Set(['old-1']) }))).toEqual([
      { id: 'old-1', kind: 'keep' },
    ])
  })

  test('re-points to the central row with the same source and source id', () => {
    const plan = planSharedFoodReconcile(
      [row()],
      lookup({ centralIdBySource: new Map([[sourceKey('livsmedelsverket', '42'), 'new-1']]) }),
    )
    expect(plan).toEqual([{ from: 'old-1', kind: 'repoint', target: 'central', to: 'new-1' }])
  })

  test('re-points to the user’s own item with the same source and source id when central has none', () => {
    const plan = planSharedFoodReconcile(
      [row()],
      lookup({ userIdBySource: new Map([[sourceKey('livsmedelsverket', '42'), 'own-1']]) }),
    )
    expect(plan).toEqual([{ from: 'old-1', kind: 'repoint', target: 'user', to: 'own-1' }])
  })

  test('copies a row without a source id even when another row shares its source', () => {
    const plan = planSharedFoodReconcile(
      [row({ source: 'manual', source_id: null })],
      lookup({ centralIdBySource: new Map([[sourceKey('manual', ''), 'x']]) }),
    )
    expect(plan).toEqual([{ kind: 'copy', name: 'Apple', row: row({ source: 'manual', source_id: null }) }])
  })

  test('copies under the same name when the user has no item by that name', () => {
    expect(planSharedFoodReconcile([row()], lookup())).toEqual([{ kind: 'copy', name: 'Apple', row: row() }])
  })

  test('names a copy apart from the user’s own items and from other copies', () => {
    const plan = planSharedFoodReconcile(
      [row(), row({ id: 'old-2', source_id: '43' }), row({ id: 'old-3', source_id: '44' })],
      lookup({ userNamesLower: new Set(['apple']) }),
    )
    expect(plan.map((action) => (action.kind === 'copy' ? action.name : action.kind))).toEqual([
      'Apple (livsmedelsverket)',
      'Apple (livsmedelsverket 2)',
      'Apple (livsmedelsverket 3)',
    ])
  })

  test('keeps a disambiguated name within the column length', () => {
    const long = 'A'.repeat(255)
    const [action] = planSharedFoodReconcile(
      [row({ name: long })],
      lookup({ userNamesLower: new Set([long.toLowerCase()]) }),
    )
    if (action.kind !== 'copy') throw new Error('expected a copy')
    expect(action.name).toHaveLength(255)
    expect(action.name.endsWith(' (livsmedelsverket)')).toBe(true)
  })
})

describe('exportedSharedFoodTrailer', () => {
  test('is empty without items', () => {
    expect(exportedSharedFoodTrailer([])).toBe('')
  })

  test('creates the table schema-qualified and inserts in batches', () => {
    const items = Array.from({ length: 201 }, (_, i) => ({
      created_at: new Date('2026-01-01T00:00:00Z'),
      id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      name: `Item ${i}`,
      name_lower: `item ${i}`,
      source: 'livsmedelsverket',
      updated_at: new Date('2026-01-01T00:00:00Z'),
    }))
    const sql = exportedSharedFoodTrailer(items)
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.exported_shared_food_items (')
    expect(sql).toContain('    calories double precision')
    expect(sql.match(/^INSERT INTO /gm)).toHaveLength(2)
    expect(sql).toContain("'Item 200'")
  })
})
