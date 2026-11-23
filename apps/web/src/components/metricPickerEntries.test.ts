import { strengthScoreMetrics } from '@aurboda/api-spec'
import { describe, expect, test } from 'vitest'

import { buildMetricEntries } from './metricPickerEntries'

const valuesOf = (writable: boolean) =>
  buildMetricEntries([{ name: 'mood', unit: 'score' }], [], { writable }).map((e) => e.value)

describe('buildMetricEntries', () => {
  test('the picker for entering a value leaves out the metrics Aurboda calculates', () => {
    const values = valuesOf(true)
    for (const metric of strengthScoreMetrics) expect(values).not.toContain(metric)
    expect(values).toContain('weight')
    expect(values).toContain('mood')
  })

  test('the chart and dashboard pickers offer them', () => {
    const values = valuesOf(false)
    for (const metric of strengthScoreMetrics) expect(values).toContain(metric)
  })
})
