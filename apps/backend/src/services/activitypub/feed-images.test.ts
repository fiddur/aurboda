import { describe, expect, test } from 'vitest'

import { renderChartPng, renderRoutePng } from './feed-images.ts'

/** PNG files start with this 8-byte signature. */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const isPng = (buf: Buffer) => buf.subarray(0, 8).equals(PNG_MAGIC)

describe('renderChartPng', () => {
  const series: [Date, number][] = [
    [new Date('2026-07-01T06:30:00Z'), 70],
    [new Date('2026-07-01T06:35:00Z'), 95],
    [new Date('2026-07-01T06:40:00Z'), 88],
    [new Date('2026-07-01T06:45:00Z'), 60],
  ]

  test('renders a non-empty PNG for a series', async () => {
    const png = await renderChartPng(series)
    expect(isPng(png)).toBe(true)
    expect(png.length).toBeGreaterThan(100)
  })

  test('tolerates a single point and non-finite values without throwing', async () => {
    const png = await renderChartPng([
      [new Date('2026-07-01T06:30:00Z'), 70],
      [new Date('2026-07-01T06:35:00Z'), Number.NaN],
    ])
    expect(isPng(png)).toBe(true)
  })
})

describe('renderRoutePng', () => {
  // A small loop near Gothenburg, GeoJSON [lon, lat] order.
  const coords: [number, number][] = [
    [11.97, 57.7],
    [11.975, 57.702],
    [11.98, 57.701],
    [11.976, 57.699],
    [11.97, 57.7],
  ]

  test('renders a non-empty PNG for a route', async () => {
    const png = await renderRoutePng(coords)
    expect(isPng(png)).toBe(true)
    expect(png.length).toBeGreaterThan(100)
  })

  test('tolerates a degenerate single-point route without throwing', async () => {
    const png = await renderRoutePng([[11.97, 57.7]])
    expect(isPng(png)).toBe(true)
  })
})
