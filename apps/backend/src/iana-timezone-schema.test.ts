import {
  chartDataHttpQuerySchema,
  ianaTimezoneSchema,
  isKnownTimezone,
  nutrientPeriodSummaryQuerySchema,
} from '@aurboda/api-spec'
import { describe, expect, test } from 'vitest'

const accepted = ['UTC', 'Europe/Stockholm', 'Asia/Kolkata']
const rejected = ['Mars/Base', '', '; drop']

describe('ianaTimezoneSchema', () => {
  test.each(accepted)('accepts %s', (tz) => {
    expect(isKnownTimezone(tz)).toBe(true)
    expect(ianaTimezoneSchema.safeParse(tz).success).toBe(true)
  })

  test.each(rejected)('rejects %j', (tz) => {
    expect(isKnownTimezone(tz)).toBe(false)
    expect(ianaTimezoneSchema.safeParse(tz).success).toBe(false)
  })

  test('chart data and nutrient period summary queries share it', () => {
    const chart = { end: '2025-01-02T00:00:00Z', source_type: 'metric', start: '2025-01-01T00:00:00Z' }
    const nutrient = { end: '2025-01-07', start: '2025-01-01' }
    for (const tz of accepted) {
      expect(chartDataHttpQuerySchema.safeParse({ ...chart, tz }).success).toBe(true)
      expect(nutrientPeriodSummaryQuerySchema.safeParse({ ...nutrient, tz }).success).toBe(true)
    }
    for (const tz of rejected) {
      expect(chartDataHttpQuerySchema.safeParse({ ...chart, tz }).success).toBe(false)
      expect(nutrientPeriodSummaryQuerySchema.safeParse({ ...nutrient, tz }).success).toBe(false)
    }
    expect(nutrientPeriodSummaryQuerySchema.safeParse(nutrient).success).toBe(true)
  })
})
