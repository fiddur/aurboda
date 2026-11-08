import type { DashboardPreset } from '@aurboda/api-spec'

import { dashboardPresetConfigs } from '@aurboda/api-spec'

export const PRESET_OPTIONS: { label: string; value: DashboardPreset }[] = [
  { label: 'Blank', value: 'blank' },
  { label: 'Copy of home', value: 'home' },
  { label: 'Month in data', value: 'month_in_data' },
]

export const presetName = (preset: DashboardPreset): string =>
  preset === 'home' ? 'Copy of home' : dashboardPresetConfigs[preset].name

/** The create form's name after the preset changes: the preset's name, unless the user typed their own. */
export const nameAfterPresetChange = (
  current: string,
  previous: DashboardPreset,
  next: DashboardPreset,
): string => (current.trim() === '' || current === presetName(previous) ? presetName(next) : current)
