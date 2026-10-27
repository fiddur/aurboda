import type { ActivityTypeDefinition, DataSchemaDefinition } from '@aurboda/api-spec'

import { beforeEach, describe, expect, test, vi } from 'vitest'

import * as db from '../db/index.ts'
import {
  aliasActivityData,
  applyItemValueAliases,
  categoricalItemPath,
  deleteAlias,
  listAliases,
  mergeItemValues,
} from './item-value-aliases.ts'

vi.mock('../db/index.ts', () => ({
  deleteItemValueAlias: vi.fn(),
  deleteItemValueAliasesByAlias: vi.fn().mockResolvedValue(0),
  expandActivityTypes: vi.fn(),
  getActivityTypeDefinition: vi.fn(),
  listItemValueAliases: vi.fn(),
  repointItemValueAliases: vi.fn().mockResolvedValue(0),
  rewriteItemValue: vi.fn(),
  upsertItemValueAlias: vi.fn(),
}))

const user = 'tester'

const schema: DataSchemaDefinition = {
  fields: [
    { is_categorical: true, name: 'session_name', type: 'string' },
    {
      item_fields: [
        { is_categorical: true, name: 'exercise', type: 'string' },
        { name: 'weight', type: 'number' },
      ],
      name: 'sets',
      type: 'list',
    },
  ],
}

const definition: ActivityTypeDefinition = {
  color: '#000000',
  data_schema: schema,
  display_category: 'exercise',
  display_name: 'Strength',
  is_builtin: true,
  name: 'strength_training',
  show_on_timeline: true,
}

const alias = (from: string, to: string, field = 'sets.exercise') => ({ alias: from, field, value: to })

describe('categoricalItemPath', () => {
  test('resolves a categorical item field of a list field', () => {
    expect(categoricalItemPath(schema, 'sets.exercise')).toEqual({ key: 'exercise', list: 'sets' })
  })

  test('rejects a scalar field, a non-categorical item field, an unknown list or no schema', () => {
    expect(categoricalItemPath(schema, 'session_name')).toBeUndefined()
    expect(categoricalItemPath(schema, 'sets.weight')).toBeUndefined()
    expect(categoricalItemPath(schema, 'sets.unknown')).toBeUndefined()
    expect(categoricalItemPath(schema, 'laps.exercise')).toBeUndefined()
    expect(categoricalItemPath(schema, 'session_name.exercise')).toBeUndefined()
    expect(categoricalItemPath(undefined, 'sets.exercise')).toBeUndefined()
  })
})

describe('applyItemValueAliases', () => {
  test('maps matching items trimmed and case-insensitively, keeping other keys and order', () => {
    const data = {
      sets: [
        { exercise: ' dumbbell BICEP curl ', reps: 10 },
        { exercise: 'Bench Press', reps: 5 },
        'not an item',
        { exercise: 'Dumbbell Bicep Curl', reps: 8 },
      ],
      title: 'x',
    }
    const before = structuredClone(data)

    const result = applyItemValueAliases(data, [alias('Dumbbell Bicep Curl', 'Dumbbell Curl')])

    expect(result).toEqual({
      sets: [
        { exercise: 'Dumbbell Curl', reps: 10 },
        { exercise: 'Bench Press', reps: 5 },
        'not an item',
        { exercise: 'Dumbbell Curl', reps: 8 },
      ],
      title: 'x',
    })
    expect(data).toEqual(before)
  })

  test('returns the same reference when nothing matches', () => {
    const data = { sets: [{ exercise: 'Bench Press' }] }
    expect(applyItemValueAliases(data, [alias('Squat', 'Back Squat')])).toBe(data)
    expect(applyItemValueAliases(data, [alias('Bench Press', 'Bench', 'laps.exercise')])).toBe(data)
    expect(applyItemValueAliases(data, [])).toBe(data)
  })

  test('leaves undefined data undefined', () => {
    expect(applyItemValueAliases(undefined, [alias('a', 'b')])).toBeUndefined()
  })

  test('applies several aliases', () => {
    const data = { sets: [{ exercise: 'DB Curl' }, { exercise: 'Bench' }] }
    expect(
      applyItemValueAliases(data, [alias('db curl', 'Dumbbell Curl'), alias('bench', 'Bench Press')]),
    ).toEqual({
      sets: [{ exercise: 'Dumbbell Curl' }, { exercise: 'Bench Press' }],
    })
  })
})

describe('aliasActivityData', () => {
  beforeEach(() => vi.clearAllMocks())

  test('does not read the aliases when the data has no list', async () => {
    const data = { session_name: 'Flow' }
    expect(await aliasActivityData(user, data)).toBe(data)
    expect(await aliasActivityData(user, undefined)).toBeUndefined()
    expect(db.listItemValueAliases).not.toHaveBeenCalled()
  })

  test('applies the stored aliases to list data', async () => {
    vi.mocked(db.listItemValueAliases).mockResolvedValue([
      { ...alias('Dumbbell Bicep Curl', 'Dumbbell Curl'), created_at: new Date(), id: 'a1' },
    ])
    expect(await aliasActivityData(user, { sets: [{ exercise: 'Dumbbell Bicep Curl' }] })).toEqual({
      sets: [{ exercise: 'Dumbbell Curl' }],
    })
    expect(db.listItemValueAliases).toHaveBeenCalledWith(user)
  })
})

describe('mergeItemValues', () => {
  const created_at = new Date('2026-10-01T00:00:00Z')

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.getActivityTypeDefinition).mockResolvedValue(definition)
    vi.mocked(db.expandActivityTypes).mockResolvedValue(['strength_training', 'calisthenics'])
    vi.mocked(db.rewriteItemValue).mockResolvedValue(3)
    vi.mocked(db.upsertItemValueAlias).mockImplementation(async (_user, field, from, to) => ({
      alias: from,
      created_at,
      field,
      id: 'alias-1',
      value: to,
    }))
  })

  test('rewrites the items, repoints and stores the alias', async () => {
    const result = await mergeItemValues(user, 'strength_training', {
      field: 'sets.exercise',
      source: ' Dumbbell Bicep Curl ',
      target: 'Dumbbell Curl',
    })

    expect(result).toEqual({
      data: {
        activities_updated: 3,
        alias: {
          alias: 'Dumbbell Bicep Curl',
          created_at: '2026-10-01T00:00:00.000Z',
          field: 'sets.exercise',
          id: 'alias-1',
          value: 'Dumbbell Curl',
        },
      },
      success: true,
    })
    expect(db.expandActivityTypes).toHaveBeenCalledWith(user, ['strength_training'])
    expect(db.rewriteItemValue).toHaveBeenCalledWith(
      user,
      ['strength_training', 'calisthenics'],
      'sets',
      'exercise',
      'Dumbbell Bicep Curl',
      'Dumbbell Curl',
    )
    expect(db.repointItemValueAliases).toHaveBeenCalledWith(
      user,
      'sets.exercise',
      'Dumbbell Bicep Curl',
      'Dumbbell Curl',
    )
    expect(db.deleteItemValueAliasesByAlias).toHaveBeenCalledWith(user, 'sets.exercise', 'Dumbbell Curl')
    expect(db.upsertItemValueAlias).toHaveBeenCalledWith(
      user,
      'sets.exercise',
      'Dumbbell Bicep Curl',
      'Dumbbell Curl',
    )
  })

  test('a spelling-only merge rewrites without keeping an alias', async () => {
    const result = await mergeItemValues(user, 'strength_training', {
      field: 'sets.exercise',
      source: 'dumbbell curl',
      target: 'Dumbbell Curl',
    })

    expect(result).toEqual({ data: { activities_updated: 3, alias: null }, success: true })
    expect(db.rewriteItemValue).toHaveBeenCalled()
    expect(db.deleteItemValueAliasesByAlias).not.toHaveBeenCalled()
    expect(db.upsertItemValueAlias).not.toHaveBeenCalled()
  })

  test('rejects equal values', async () => {
    const result = await mergeItemValues(user, 'strength_training', {
      field: 'sets.exercise',
      source: 'Squat ',
      target: 'Squat',
    })
    expect(result.success).toBe(false)
    expect(db.rewriteItemValue).not.toHaveBeenCalled()
  })

  test('rejects an unknown type with a not found error', async () => {
    vi.mocked(db.getActivityTypeDefinition).mockResolvedValue(null)
    const result = await mergeItemValues(user, 'nope', { field: 'sets.exercise', source: 'a', target: 'b' })
    expect(result).toEqual({ error: expect.stringContaining('not found'), success: false })
  })

  test('rejects a field that is not a categorical item path, naming it', async () => {
    const result = await mergeItemValues(user, 'strength_training', {
      field: 'sets.weight',
      source: 'a',
      target: 'b',
    })
    expect(result).toEqual({ error: expect.stringContaining('sets.weight'), success: false })
    expect(result).not.toMatchObject({ error: expect.stringContaining('not found') })
    expect(db.rewriteItemValue).not.toHaveBeenCalled()
  })
})

describe('listAliases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.getActivityTypeDefinition).mockResolvedValue(definition)
  })

  test('lists the aliases of the item path with ISO dates', async () => {
    vi.mocked(db.listItemValueAliases).mockResolvedValue([
      { ...alias('DB Curl', 'Dumbbell Curl'), created_at: new Date('2026-10-01T00:00:00Z'), id: 'a1' },
    ])

    expect(await listAliases(user, 'strength_training', 'sets.exercise')).toEqual({
      data: [
        {
          alias: 'DB Curl',
          created_at: '2026-10-01T00:00:00.000Z',
          field: 'sets.exercise',
          id: 'a1',
          value: 'Dumbbell Curl',
        },
      ],
      success: true,
    })
    expect(db.listItemValueAliases).toHaveBeenCalledWith(user, 'sets.exercise')
  })

  test('rejects a field that is not a categorical item path', async () => {
    expect((await listAliases(user, 'strength_training', 'session_name')).success).toBe(false)
    expect(db.listItemValueAliases).not.toHaveBeenCalled()
  })
})

describe('deleteAlias', () => {
  beforeEach(() => vi.clearAllMocks())

  test('deletes a known alias', async () => {
    vi.mocked(db.deleteItemValueAlias).mockResolvedValue(true)
    const id = '00000000-0000-4000-8000-000000000001'
    expect(await deleteAlias(user, id)).toEqual({ success: true })
    expect(db.deleteItemValueAlias).toHaveBeenCalledWith(user, id)
  })

  test('answers not found for an unknown or malformed id', async () => {
    vi.mocked(db.deleteItemValueAlias).mockResolvedValue(false)
    expect(await deleteAlias(user, '00000000-0000-4000-8000-000000000002')).toEqual({
      error: expect.stringContaining('not found'),
      success: false,
    })
    expect(await deleteAlias(user, 'nope')).toEqual({
      error: expect.stringContaining('not found'),
      success: false,
    })
    expect(db.deleteItemValueAlias).toHaveBeenCalledTimes(1)
  })
})
