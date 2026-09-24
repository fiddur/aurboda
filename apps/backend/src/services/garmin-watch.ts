import type { GarminWatchConfigResponse, GarminWatchType } from '@aurboda/api-spec'

import { getActivityTypeDefinitions } from '../db/index.ts'
import { getSettings } from './settings.ts'

export const findGarminWatchTypeByCode = (
  types: GarminWatchType[],
  code: number,
): GarminWatchType | undefined => types.find((entry) => entry.code === code)

export const getGarminWatchTypes = async (user: string): Promise<GarminWatchType[]> =>
  (await getSettings(user)).garmin_watch_types ?? []

export const getGarminWatchConfig = async (user: string): Promise<GarminWatchConfigResponse> => {
  const types = await getGarminWatchTypes(user)
  if (types.length === 0) return { success: true, types: [] }
  const displayNames = new Map(
    (await getActivityTypeDefinitions(user)).map((def) => [def.name, def.display_name]),
  )
  return {
    success: true,
    types: types.map((entry) => ({
      ...entry,
      display_name: displayNames.get(entry.activity_type) ?? entry.activity_type,
    })),
  }
}
