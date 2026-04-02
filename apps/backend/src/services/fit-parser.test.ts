import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { parseFitBuffer } from './fit-parser.ts'

describe('parseFitBuffer', () => {
  it('parses a QZ treadmill FIT file', async () => {
    const buf = await readFile(join(__dirname, '__fixtures__/sample.fit'))
    const activities = await parseFitBuffer(buf)

    expect(activities).toHaveLength(1)
    const act = activities[0]

    expect(act.activity_type).toBe('exercise')
    // QZ file has sport=running, sub_sport=virtual_activity → running_treadmill
    expect(act.exercise_type).toBe('running_treadmill')
    expect(act.start_time).toBeInstanceOf(Date)
    expect(act.end_time).toBeInstanceOf(Date)
    expect(act.end_time.getTime()).toBeGreaterThan(act.start_time.getTime())
    expect(act.title).toContain('Running Treadmill')
    expect(act.data.calories).toBe(76)
    expect(act.data.distance_meters).toBe(813.19)
    expect(act.data.source_detail).toBe('fit_import')
  })

  it('extracts time series records', async () => {
    const buf = await readFile(join(__dirname, '__fixtures__/sample.fit'))
    const [act] = await parseFitBuffer(buf)

    // The sample file has 628 records; not all will have non-zero values
    expect(act.timeSeries.length).toBeGreaterThan(0)

    const metrics = new Set(act.timeSeries.map((p) => p.metric))
    // Sample file should have at least power and speed records
    expect(metrics.has('power')).toBe(true)
    expect(metrics.has('speed')).toBe(true)

    // Every time series point should have a valid timestamp
    for (const point of act.timeSeries) {
      expect(point.time).toBeInstanceOf(Date)
      expect(point.value).toBeGreaterThan(0)
    }
  })

  it('throws for empty buffer', async () => {
    await expect(parseFitBuffer(Buffer.alloc(0))).rejects.toThrow()
  })
})
