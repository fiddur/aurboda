import type { HrZoneThresholds, UpdateSettingsInput, UserSettingsResponse } from '../state/api'
import { defaultHrZoneThresholds } from './hrZones'

/**
 * Parse a zone value string to a number, returning null if invalid
 */
export const parseZoneValue = (value: string): number | null => {
  const numValue = parseInt(value, 10)
  return isNaN(numValue) ? null : numValue
}

/**
 * Update a single zone threshold value in a thresholds object
 */
export const updateZoneThreshold = (
  currentZones: HrZoneThresholds | null,
  zone: keyof HrZoneThresholds,
  value: number,
): HrZoneThresholds => {
  const baseZones = currentZones ?? defaultHrZoneThresholds
  return { ...baseZones, [zone]: value }
}

/**
 * Compute the update params to send to the API based on form vs server state
 * Returns only the changed fields, or null if nothing changed
 */
export const computeSettingsUpdateParams = (
  formBirthDate: string,
  formHrZones: HrZoneThresholds | null,
  formRescueTimeKey: string,
  serverSettings: UserSettingsResponse | undefined,
): UpdateSettingsInput | null => {
  const params: UpdateSettingsInput = {}

  // Check birth_date changes
  const serverBirthDate = serverSettings?.birth_date ?? ''
  if (formBirthDate !== serverBirthDate) {
    params.birth_date = formBirthDate || null
  }

  // Check hr_zone_start changes - treat null and undefined as equivalent
  const serverZones = serverSettings?.hr_zone_start ?? null
  if (JSON.stringify(formHrZones) !== JSON.stringify(serverZones)) {
    params.hr_zone_start = formHrZones
  }

  // Check rescue_time_key changes
  const serverRescueTimeKey = serverSettings?.rescue_time_key ?? ''
  if (formRescueTimeKey !== serverRescueTimeKey) {
    params.rescue_time_key = formRescueTimeKey || null
  }

  return Object.keys(params).length > 0 ? params : null
}

/**
 * Validate HR zone thresholds - zones must be in ascending order
 */
export const validateHrZoneThresholds = (zones: HrZoneThresholds): { valid: boolean; error?: string } => {
  const values = [zones[1], zones[2], zones[3], zones[4], zones[5]]

  for (let i = 0; i < values.length; i++) {
    const val = values[i]
    if (val < 40 || val > 220) {
      return { error: `Zone ${i + 1} must be between 40 and 220 bpm`, valid: false }
    }
  }

  for (let i = 1; i < values.length; i++) {
    if (values[i] <= values[i - 1]) {
      return { error: `Zone ${i + 2} must be greater than Zone ${i + 1}`, valid: false }
    }
  }

  return { valid: true }
}
