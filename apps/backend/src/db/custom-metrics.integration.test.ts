import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import {
  adoptCatalogMetric,
  bulkInsertCustomMetricDefinitions,
  getCustomMetricByName,
  getCustomMetricDefinitions,
  insertCustomMetricDefinition,
  updateCustomMetricDefinition,
} from './custom-metrics.ts'

const CONTAINER_TIMEOUT = 120_000

describe('custom metric definitions', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('aggregation defaults to avg', async () => {
    const user = getTestUser()
    await insertCustomMetricDefinition(user, { name: 'mood', unit: 'score' })

    expect((await getCustomMetricByName(user, 'mood'))?.aggregation).toBe('avg')
  })

  test('aggregation round-trips on insert and update', async () => {
    const user = getTestUser()
    await insertCustomMetricDefinition(user, { aggregation: 'sum', name: 'ibuprofen_mg', unit: 'mg' })

    expect((await getCustomMetricByName(user, 'ibuprofen_mg'))?.aggregation).toBe('sum')

    const updated = await updateCustomMetricDefinition(user, 'ibuprofen_mg', { aggregation: 'avg' })
    expect(updated?.aggregation).toBe('avg')

    const untouched = await updateCustomMetricDefinition(user, 'ibuprofen_mg', { unit: 'g' })
    expect(untouched).toMatchObject({ aggregation: 'avg', unit: 'g' })
  })

  test('better defaults to neutral and round-trips on insert and update', async () => {
    const user = getTestUser()
    await insertCustomMetricDefinition(user, { name: 'mood', unit: 'score' })
    await insertCustomMetricDefinition(user, { better: 'lower', name: 'pain', unit: 'score' })

    expect((await getCustomMetricByName(user, 'mood'))?.better).toBe('neutral')
    expect((await getCustomMetricByName(user, 'pain'))?.better).toBe('lower')

    expect((await updateCustomMetricDefinition(user, 'mood', { better: 'higher' }))?.better).toBe('higher')
    expect(await updateCustomMetricDefinition(user, 'mood', { unit: 'points' })).toMatchObject({
      better: 'higher',
      unit: 'points',
    })
  })

  test('bulk insert writes aggregation', async () => {
    const user = getTestUser()
    await bulkInsertCustomMetricDefinitions(user, [
      { aggregation: 'sum', name: 'caffeine_mg', unit: 'mg' },
      { name: 'waist', unit: 'cm' },
    ])

    const definitions = await getCustomMetricDefinitions(user)
    expect(definitions.map((d) => [d.name, d.aggregation])).toEqual([
      ['caffeine_mg', 'sum'],
      ['waist', 'avg'],
    ])
  })

  test('adopting a catalogue metric inserts it once and never changes an existing one', async () => {
    const user = getTestUser()
    const ldl = {
      aggregation: 'avg' as const,
      description: 'LDL cholesterol',
      name: 'ldl_cholesterol',
      unit: 'mmol/L',
    }
    expect(await adoptCatalogMetric(user, ldl)).toBe('mmol/L')
    expect(await adoptCatalogMetric(user, ldl)).toBe('mmol/L')
    expect(await getCustomMetricDefinitions(user)).toEqual([
      { ...ldl, better: 'neutral', include_in_daily_summary: false },
    ])

    await insertCustomMetricDefinition(user, { name: 'ferritin', unit: 'ng/mL' })
    expect(await adoptCatalogMetric(user, { description: 'Ferritin', name: 'ferritin', unit: 'µg/L' })).toBe(
      'ng/mL',
    )
    expect(await getCustomMetricByName(user, 'ferritin')).toMatchObject({ unit: 'ng/mL' })
    expect(await getCustomMetricByName(user, 'ferritin')).not.toHaveProperty('description')
  })
})
