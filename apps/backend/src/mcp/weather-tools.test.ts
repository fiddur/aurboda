import { describe, expect, test, vi } from 'vitest'

import type { WeatherDeps } from '../services/weather.ts'
import type { McpServer } from './helpers.ts'

import { registerWeatherTools } from './weather-tools.ts'

type ToolHandler = (
  params: Record<string, unknown>,
) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>

const buildTool = (deps: WeatherDeps): ToolHandler => {
  const tools = new Map<string, ToolHandler>()
  const server = {
    tool: (name: string, _desc: string, _shape: unknown, handler: ToolHandler) => {
      tools.set(name, handler)
    },
  } as unknown as McpServer
  registerWeatherTools(server, 'tester', deps)
  return tools.get('get_weather')!
}

const deps = (): WeatherDeps => ({
  getEntries: vi.fn(async () => [
    {
      metric: 'weather_code',
      source: 'open_meteo',
      time: new Date('2026-11-01T10:00:00Z'),
      unit: 'wmo',
      value: 61,
    },
    {
      metric: 'weather_temperature',
      source: 'open_meteo',
      time: new Date('2026-11-01T10:00:00Z'),
      unit: 'celsius',
      value: 6,
    },
  ]),
  getUserTimezone: vi.fn(async () => 'UTC'),
  locateHours: vi.fn(async (_user, hours) => hours.map(() => null)),
})

describe('MCP get_weather', () => {
  test('answers a span with its hours and summary', async () => {
    const result = await buildTool(deps())({ end: '2026-11-01T10:40:00Z', start: '2026-11-01T10:20:00Z' })
    const body = JSON.parse(result.content[0].text)
    expect(body).toMatchObject({
      hours: [{ code: 61, temperature: 6 }],
      success: true,
      summary: { condition: 'Slight rain', temperature_avg: 6 },
    })
  })

  test('a day carries its timezone', async () => {
    const body = JSON.parse((await buildTool(deps())({ date: '2026-11-01' })).content[0].text)
    expect(body.tz).toBe('UTC')
    expect(body.summary.hours).toBe(1)
  })

  test('refuses a call with neither date nor a span', async () => {
    const result = await buildTool(deps())({})
    expect(result.isError).toBe(true)
  })
})
