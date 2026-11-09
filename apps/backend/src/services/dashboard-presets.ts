import {
  type DashboardConfig,
  type DashboardPreset,
  dashboardPresetConfigs,
  defaultDashboardConfig,
} from '@aurboda/api-spec'

import { getSettings } from './settings.ts'

interface PresetDeps {
  getSettings: (user: string) => Promise<{ dashboard?: DashboardConfig | null }>
}

/**
 * The config a new dashboard starts from: the explicit `config`, or the named
 * `preset` (`home` copies the user's home dashboard). Null unless exactly one
 * is given — the REST schema refines this, but an MCP tool sees only its shape.
 */
export const resolvePresetConfig = async (
  user: string,
  body: { config?: DashboardConfig; preset?: DashboardPreset },
  deps: PresetDeps = { getSettings },
): Promise<DashboardConfig | null> => {
  if ((body.config === undefined) === (body.preset === undefined)) return null
  if (body.config) return body.config
  if (body.preset === 'home') return (await deps.getSettings(user)).dashboard ?? defaultDashboardConfig
  return body.preset ? dashboardPresetConfigs[body.preset].config : null
}
