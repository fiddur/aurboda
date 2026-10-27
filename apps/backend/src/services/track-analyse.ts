import { getActivityById } from '../db/activities/index.ts'
import { listTrackedActivitiesWithoutFeatures } from '../db/activity-features.ts'
import { computeAndStoreActivityFeatures, defaultActivityFeatureDeps } from './activity-features.ts'
import { auditError, auditInfo } from './audit-log.ts'
import { defaultRouteMatchDeps, matchActivityRoute } from './routes.ts'
import { ensureDefaultRunCategoryRules } from './run-category-rules.ts'

export interface AnalysedActivity {
  activity_type: string
  start: Date
  end: Date
}

export type AnalysedNotifier = (user: string, activityType: string, start: Date, end: Date) => void

export interface FeatureStepDeps {
  computeFeatures: (user: string, activityId: string) => Promise<AnalysedActivity | null>
  ensureDefaultRules: (user: string) => Promise<unknown>
  notify: AnalysedNotifier
}

export interface TrackAnalyseStepDeps extends FeatureStepDeps {
  matchRoute: (user: string, activityId: string) => Promise<unknown>
}

export interface FeatureBackfillDeps extends FeatureStepDeps {
  listActivitiesWithoutFeatures: (user: string) => Promise<{ activity_id: string }[]>
}

/** Null when nothing was stored (no end time, no activity); the span is what the deduction queue re-evaluates. */
export const computeFeaturesForActivity = async (
  user: string,
  activityId: string,
): Promise<AnalysedActivity | null> => {
  const features = await computeAndStoreActivityFeatures(user, activityId, defaultActivityFeatureDeps)
  if (!features) return null
  const activity = await getActivityById(user, activityId)
  if (!activity?.end_time) return null
  return { activity_type: activity.activity_type, end: activity.end_time, start: activity.start_time }
}

export const defaultFeatureStepDeps = {
  computeFeatures: computeFeaturesForActivity,
  ensureDefaultRules: ensureDefaultRunCategoryRules,
}

export const createTrackAnalyseStepDeps = (notify: AnalysedNotifier): TrackAnalyseStepDeps => ({
  ...defaultFeatureStepDeps,
  matchRoute: (user, activityId) => matchActivityRoute(user, activityId, defaultRouteMatchDeps),
  notify,
})

const attempt = async <T>(
  user: string,
  message: string,
  activityId: string | undefined,
  step: () => Promise<T>,
): Promise<T | null> => {
  try {
    return await step()
  } catch (error) {
    auditError(user, 'data', message, {
      ...(activityId ? { activity_id: activityId } : {}),
      error: String(error),
    })
    return null
  }
}

/** Each step runs even when an earlier one failed: a broken route match must not keep a run uncategorised. */
export const analyseTrack = async (
  user: string,
  activityId: string,
  deps: TrackAnalyseStepDeps,
): Promise<void> => {
  await attempt(user, 'Route matching failed', activityId, () => deps.matchRoute(user, activityId))
  const analysed = await attempt(user, 'Activity feature computation failed', activityId, () =>
    deps.computeFeatures(user, activityId),
  )
  if (!analysed) return
  await attempt(user, 'Seeding the default run category rules failed', activityId, () =>
    deps.ensureDefaultRules(user),
  )
  deps.notify(user, analysed.activity_type, analysed.start, analysed.end)
}

export const backfillActivityFeatures = async (
  user: string,
  deps: FeatureBackfillDeps,
): Promise<{ computed: number }> => {
  const pending = await deps.listActivitiesWithoutFeatures(user)
  let computed = 0
  let start: Date | undefined
  let end: Date | undefined
  for (const { activity_id } of pending) {
    const analysed = await attempt(user, 'Activity feature computation failed', activity_id, () =>
      deps.computeFeatures(user, activity_id),
    )
    if (!analysed) continue
    computed++
    if (!start || analysed.start < start) start = analysed.start
    if (!end || analysed.end > end) end = analysed.end
  }
  if (computed === 0 || !start || !end) return { computed }
  await attempt(user, 'Seeding the default run category rules failed', undefined, () =>
    deps.ensureDefaultRules(user),
  )
  deps.notify(user, '*', start, end)
  auditInfo(user, 'data', '🏃 Activity features computed', { computed })
  return { computed }
}

export const defaultFeatureBackfillDeps = {
  ...defaultFeatureStepDeps,
  listActivitiesWithoutFeatures: listTrackedActivitiesWithoutFeatures,
}
