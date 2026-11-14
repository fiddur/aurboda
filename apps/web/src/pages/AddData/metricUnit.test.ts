import type { MetricCatalogEntry } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import {
  catalogUnitOptions,
  chosenCatalogUnit,
  defaultCatalogUnit,
  metricLabel,
  plainMetricUnit,
} from './metricUnit'

const ferritin: MetricCatalogEntry = {
  aliases: ['serum ferritin'],
  display_name: 'Ferritin',
  group: 'blood_count',
  in_use: false,
  name: 'ferritin',
  unit: 'µg/L',
  units: [{ factor: 1, unit: 'ng/mL' }],
}

describe('catalogUnitOptions', () => {
  test('the stored unit first, then the accepted units', () => {
    expect(catalogUnitOptions(ferritin)).toEqual(['µg/L', 'ng/mL'])
  })

  test('the user’s own unit is offered first when it is none of them', () => {
    expect(catalogUnitOptions({ ...ferritin, in_use: true, in_use_unit: 'ug/l' })).toEqual([
      'ug/l',
      'µg/L',
      'ng/mL',
    ])
    expect(catalogUnitOptions({ ...ferritin, in_use: true, in_use_unit: 'ng/mL' })).toEqual(['µg/L', 'ng/mL'])
  })
})

describe('defaultCatalogUnit', () => {
  test('the user’s unit when in use, else the stored unit', () => {
    expect(defaultCatalogUnit(ferritin)).toBe('µg/L')
    expect(defaultCatalogUnit({ ...ferritin, in_use: true, in_use_unit: 'ng/mL' })).toBe('ng/mL')
  })
})

describe('chosenCatalogUnit', () => {
  test('the unit picked for the same metric, else the default, and none for other metrics', () => {
    expect(chosenCatalogUnit('ferritin', ferritin, { metric: 'ferritin', unit: 'ng/mL' })).toBe('ng/mL')
    expect(chosenCatalogUnit('ferritin', ferritin, { metric: 'ldl_cholesterol', unit: 'mg/dL' })).toBe('µg/L')
    expect(chosenCatalogUnit('weight', undefined, { metric: 'weight', unit: 'lb' })).toBeUndefined()
  })
})

describe('plainMetricUnit and metricLabel', () => {
  test('built-in and custom units', () => {
    expect(plainMetricUnit('weight', [])).toBe('kg')
    expect(plainMetricUnit('mood', [{ name: 'mood', unit: 'score' }])).toBe('score')
    expect(plainMetricUnit('nothing', [])).toBeUndefined()
  })

  test('catalogue display name, custom description, built-in label', () => {
    expect(metricLabel('ferritin', [], [ferritin])).toBe('Ferritin')
    expect(metricLabel('mood', [{ description: 'Mood', name: 'mood', unit: 'score' }], [])).toBe('Mood')
    expect(metricLabel('weight', [], [])).toBe('Weight')
  })
})
