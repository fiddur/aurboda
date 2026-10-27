import type { ActivityFeatures } from '@aurboda/api-spec'

import { getActivityById } from '../db/activities/index.ts'
import {
  getActivityFeatures,
  getEffectiveActivityType,
  getMedianDurationBefore,
  upsertActivityFeatures,
} from '../db/activity-features.ts'
import { expandActivityTypes } from '../db/activity-type-definitions.ts'
import { getTimeSeries, getTimeSeriesBySource } from '../db/time-series.ts'
import { getActivityTrack } from '../db/tracks.ts'
import { computeRunFeatures } from './run-features.ts'
import { getEffectiveHrZones, getSettings, lowHrCeiling } from './settings.ts'

export interface FeatureActivity {
  id: string
  activity_type: string
  source: string
  start_time: Date
  end_time?: Date | null
}

export interface ActivityFeatureDeps {
  getActivity: (user: string, id: string) => Promise<FeatureActivity | null>
  getActivityTrack: typeof getActivityTrack
  getTimeSeriesBySource: typeof getTimeSeriesBySource
  getTimeSeries: typeof getTimeSeries
  getEffectiveHrZones: typeof getEffectiveHrZones
  getSettings: typeof getSettings
  expandActivityTypes: typeof expandActivityTypes
  getMedianDurationBefore: typeof getMedianDurationBefore
  upsertActivityFeatures: typeof upsertActivityFeatures
  getActivityFeatures: typeof getActivityFeatures
  getEffectiveActivityType: typeof getEffectiveActivityType
}

/** The stored features, with the activity's effective type (an override's when it has one). */
export type StoredActivityFeatures = ActivityFeatures & { activity_type: string }

export const defaultActivityFeatureDeps: ActivityFeatureDeps = {
  expandActivityTypes,
  getActivity: async (user, id) => {
    const activity = await getActivityById(user, id)
    return activity?.id ? { ...activity, id: activity.id } : null
  },
  getActivityFeatures,
  getActivityTrack,
  getEffectiveActivityType,
  getEffectiveHrZones,
  getMedianDurationBefore,
  getSettings,
  getTimeSeries,
  getTimeSeriesBySource,
  upsertActivityFeatures,
}

/**
 * Samples from the activity's own source first, so several sources recording the same window
 * (a watch and a chest strap, say) are not mixed; any source when that one has none.
 */
const samplesFor = async (
  deps: ActivityFeatureDeps,
  user: string,
  metric: string,
  source: string,
  start: Date,
  end: Date,
): Promise<[Date, number][]> => {
  const own = await deps.getTimeSeriesBySource(user, metric, source, start, end)
  return own.length > 0 ? own : deps.getTimeSeries(user, metric, start, end)
}

export const computeAndStoreActivityFeatures = async (
  user: string,
  activityId: string,
  deps: ActivityFeatureDeps = defaultActivityFeatureDeps,
): Promise<StoredActivityFeatures | null> => {
  const activity = await deps.getActivity(user, activityId)
  if (!activity?.end_time) return null
  const { start_time: start, end_time: end } = activity
  const activityType = (await deps.getEffectiveActivityType(user, activityId)) ?? activity.activity_type

  const track = await deps.getActivityTrack(user, activityId)
  const source = track?.source ?? activity.source
  const [hr, speed, { zones }, settings, types] = await Promise.all([
    samplesFor(deps, user, 'heart_rate', source, start, end),
    samplesFor(deps, user, 'speed', source, start, end),
    deps.getEffectiveHrZones(user),
    deps.getSettings(user),
    deps.expandActivityTypes(user, [activityType]),
  ])
  const median = await deps.getMedianDurationBefore(user, types, start)

  const features = computeRunFeatures({
    end,
    hr,
    lowHrCeilingBpm: lowHrCeiling(settings, zones),
    medianDuration90dS: median ?? undefined,
    speed,
    start,
    track,
    zones,
  })
  await deps.upsertActivityFeatures(user, activityId, features)
  const stored = await deps.getActivityFeatures(user, activityId)
  return stored && { ...stored, activity_type: activityType }
}

/** The features of the first of `ids` that has them: a merged activity's track may sit on any of its sources. */
export const firstActivityFeatures = async (
  user: string,
  ids: string[],
  getFeatures: typeof getActivityFeatures = getActivityFeatures,
): Promise<ActivityFeatures | undefined> => {
  for (const id of ids) {
    const features = await getFeatures(user, id)
    if (features) return features
  }
  return undefined
}
