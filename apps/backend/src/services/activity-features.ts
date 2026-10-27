import type { ActivityFeatures } from '@aurboda/api-spec'

import { getActivityById } from '../db/activities/index.ts'
import {
  getActivityFeatures,
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
}

export const defaultActivityFeatureDeps: ActivityFeatureDeps = {
  expandActivityTypes,
  getActivity: async (user, id) => {
    const activity = await getActivityById(user, id)
    return activity?.id ? { ...activity, id: activity.id } : null
  },
  getActivityFeatures,
  getActivityTrack,
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
): Promise<ActivityFeatures | null> => {
  const activity = await deps.getActivity(user, activityId)
  if (!activity?.end_time) return null
  const { start_time: start, end_time: end } = activity

  const track = await deps.getActivityTrack(user, activityId)
  const source = track?.source ?? activity.source
  const [hr, speed, { zones }, settings, types] = await Promise.all([
    samplesFor(deps, user, 'heart_rate', source, start, end),
    samplesFor(deps, user, 'speed', source, start, end),
    deps.getEffectiveHrZones(user),
    deps.getSettings(user),
    deps.expandActivityTypes(user, [activity.activity_type]),
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
  return deps.getActivityFeatures(user, activityId)
}
