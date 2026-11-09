import { type DashboardConfig, dashboardPresetConfigs, defaultDashboardConfig } from '@aurboda/api-spec'
import { describe, expect, test } from 'vitest'

import { resolvePresetConfig } from './dashboard-presets.ts'

const homeConfig: DashboardConfig = { sections: [], version: 1, description: 'mine' }

const deps = (dashboard?: DashboardConfig) => ({ getSettings: async () => (dashboard ? { dashboard } : {}) })

describe('resolvePresetConfig', () => {
  test('returns an explicit config as given', async () => {
    expect(await resolvePresetConfig('u', { config: homeConfig }, deps())).toBe(homeConfig)
  })

  test('copies the home dashboard, or the default when the user has none', async () => {
    expect(await resolvePresetConfig('u', { preset: 'home' }, deps(homeConfig))).toBe(homeConfig)
    expect(await resolvePresetConfig('u', { preset: 'home' }, deps())).toBe(defaultDashboardConfig)
  })

  test('resolves the built-in presets', async () => {
    expect(await resolvePresetConfig('u', { preset: 'blank' }, deps())).toEqual({ sections: [], version: 1 })
    const month = await resolvePresetConfig('u', { preset: 'month_in_data' }, deps())
    expect(month).toBe(dashboardPresetConfigs.month_in_data.config)
    expect(month?.period).toEqual({ granularity: 'month' })
  })

  test('is null unless exactly one of config and preset is given', async () => {
    expect(await resolvePresetConfig('u', {}, deps())).toBeNull()
    expect(await resolvePresetConfig('u', { config: homeConfig, preset: 'blank' }, deps())).toBeNull()
  })
})
