import sharp from 'sharp'
import { describe, expect, test, vi } from 'vitest'

import { renderChartPng, renderRoutePng } from './feed-images.ts'

/** PNG files start with this 8-byte signature. */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const isPng = (buf: Buffer) => buf.subarray(0, 8).equals(PNG_MAGIC)

/** A solid-colour 256×256 tile, standing in for an OSM tile (no network). */
const fakeTile = (r: number, g: number, b: number): Promise<Buffer> =>
  sharp({ create: { background: { b, g, r }, channels: 3, height: 256, width: 256 } })
    .png()
    .toBuffer()

/** The RGB of a single pixel in a PNG. */
const pixelAt = async (png: Buffer, px: number, py: number) => {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const i = (py * info.width + px) * info.channels
  return { b: data[i + 2], g: data[i + 1], r: data[i] }
}

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

  test('composites the OSM basemap when tiles are supplied', async () => {
    const tile = await fakeTile(180, 210, 170) // a distinctive light green
    const png = await renderRoutePng(coords, { fetchTile: async () => tile })
    expect(isPng(png)).toBe(true)
    const meta = await sharp(png).metadata()
    expect(meta.width).toBe(700)
    expect(meta.height).toBe(700)
    // A corner interior pixel should be the basemap tile colour, proving the
    // tiles were actually composited (the bare fallback is near-black there).
    const p = await pixelAt(png, 40, 40)
    expect(p.g).toBeGreaterThan(150)
    expect(p.r).toBeGreaterThan(120)
  })

  test('falls back to the bare shape when every tile fails to load', async () => {
    // An OSM outage/block (every tile null) must be observable, not silent.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const png = await renderRoutePng(coords, { fetchTile: async () => null })
      expect(isPng(png)).toBe(true)
      // No basemap → the dark background shows through at the corner.
      const p = await pixelAt(png, 40, 40)
      expect(p.g).toBeLessThan(60)
      // ...and a warning is logged so the degradation isn't invisible.
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('all'))
    } finally {
      warn.mockRestore()
    }
  })

  test('renders a plain background for an empty route without throwing', async () => {
    const png = await renderRoutePng([])
    expect(isPng(png)).toBe(true)
  })
})
