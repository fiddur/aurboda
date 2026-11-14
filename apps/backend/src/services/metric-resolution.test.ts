import { describe, expect, test } from 'vitest'

import { getCatalogMetric, loadMetricCatalog } from './metric-catalog.ts'
import { resolveMetricForWrite, valueForWrite } from './metric-resolution.ts'

const catalog = loadMetricCatalog()
const ldl = getCatalogMetric(catalog, 'ldl_cholesterol')!
const ferritin = getCatalogMetric(catalog, 'ferritin')!

describe('resolveMetricForWrite', () => {
  test('a built-in metric keeps its unit and has no catalogue entry', () => {
    expect(resolveMetricForWrite('weight', [], catalog)).toEqual({
      adopt: false,
      metric: 'weight',
      unit: 'kg',
    })
  })

  test('a custom metric of exactly that name wins, with the catalogue entry of the same name', () => {
    expect(resolveMetricForWrite('ferritin', [{ name: 'ferritin', unit: 'ng/mL' }], catalog)).toEqual({
      adopt: false,
      entry: ferritin,
      metric: 'ferritin',
      unit: 'ng/mL',
    })
    expect(resolveMetricForWrite('mood', [{ name: 'mood', unit: 'score' }], catalog)).toEqual({
      adopt: false,
      metric: 'mood',
      unit: 'score',
    })
  })

  test('a custom metric named like an alias wins over the catalogue', () => {
    expect(resolveMetricForWrite('ldl', [{ name: 'ldl', unit: 'mg/dL' }], catalog)).toEqual({
      adopt: false,
      metric: 'ldl',
      unit: 'mg/dL',
    })
  })

  test('an alias resolves to the catalogue entry, to be adopted', () => {
    expect(resolveMetricForWrite('LDL', [], catalog)).toEqual({
      adopt: true,
      entry: ldl,
      metric: 'ldl_cholesterol',
      unit: 'mmol/L',
    })
  })

  test('an alias resolves to the user’s metric of the entry’s name', () => {
    expect(resolveMetricForWrite('ldl', [{ name: 'ldl_cholesterol', unit: 'mg/dL' }], catalog)).toEqual({
      adopt: false,
      entry: ldl,
      metric: 'ldl_cholesterol',
      unit: 'mg/dL',
    })
  })

  test('unknown', () => {
    expect(resolveMetricForWrite('no_such_metric', [], catalog)).toBeUndefined()
  })
})

describe('valueForWrite', () => {
  const adopting = resolveMetricForWrite('ldl', [], catalog)!

  test('no unit: the value is taken to be in the metric’s unit', () => {
    expect(valueForWrite(adopting, 3.1, undefined)).toEqual({ value: 3.1 })
  })

  test('the same unit after normalisation is stored as is', () => {
    expect(valueForWrite(adopting, 3.1, 'mmol/l')).toEqual({ value: 3.1 })
    expect(valueForWrite({ adopt: false, metric: 'body_fat', unit: 'percent' }, 20, '%')).toEqual({
      value: 20,
    })
  })

  test('a spelling of the stored unit listed by the entry is stored as is', () => {
    const tsh = resolveMetricForWrite('tsh', [], catalog)!
    expect(valueForWrite(tsh, 2.1, 'mU/L')).toEqual({ value: 2.1 })
  })

  test('an accepted unit converts to the stored unit', () => {
    expect(valueForWrite(adopting, 100, 'mg/dL')).toEqual({ value: 2.586 })
  })

  test('converts to the unit of the user’s own metric', () => {
    const own = resolveMetricForWrite('ldl', [{ name: 'ldl_cholesterol', unit: 'mg/dL' }], catalog)!
    expect(valueForWrite(own, 2.586, 'mmol/L')).toEqual({ value: 100 })
  })

  test('refuses a unit a catalogue metric does not accept', () => {
    const resolved = resolveMetricForWrite('ferritin', [], catalog)!
    expect(valueForWrite(resolved, 50, 'mmol/L')).toEqual({
      error:
        'Unit "mmol/L" is not accepted for "ferritin", which is stored in µg/L. Accepted units: µg/L, ng/mL.',
    })
  })

  test('refuses a unit that does not match a metric without a catalogue entry', () => {
    expect(valueForWrite({ adopt: false, metric: 'weight', unit: 'kg' }, 160, 'lb')).toEqual({
      error: 'Unit "lb" does not match "weight", which is stored in kg.',
    })
  })
})
