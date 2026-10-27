import type { Activity } from '../db/types.ts'

import { getActivityById, getOverrideForActivity } from '../db/activities/index.ts'
import { deleteAllActivityFeatures, listTrackedActivitiesWithoutFeatures } from '../db/activity-features.ts'
import { getActivityTrack } from '../db/tracks.ts'
import { computeAndStoreActivityFeatures, defaultActivityFeatureDeps } from './activity-features.ts'
import { auditError, auditInfo } from './audit-log.ts'
import { defaultRouteMatchDeps, matchActivityRoute, rematchActivityRoute } from './routes.ts'
import { ensureDefaultRunCategoryRules } from './run-category-rules.ts'

export interface AnalysedActivity {
  /** The type the merged view shows: an override's retype wins over the synced row's. */
  activity_type: string
  start: Date
  end: Date
}

export type AnalysedNotifier = (user: string, activityType: string, start: Date, end: Date) => void

export interface FeatureStepDeps {
  computeFeatures: (user: string, activityId: string) => Promise<AnalysedActivity | null>
  ensureDefaultRules: (user: string, activityType: string) => Promise<unknown>
  notify: AnalysedNotifier
}

export interface TrackAnalyseStepDeps extends FeatureStepDeps {
  matchRoute: (user: string, activityId: string) => Promise<unknown>
}

export interface FeatureBackfillDeps extends FeatureStepDeps {
  listActivitiesWithoutFeatures: (user: string) => Promise<{ activity_id: string }[]>
  deleteAllFeatures: (user: string) => Promise<unknown>
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
  const override = await getOverrideForActivity(user, activityId)
  return {
    activity_type: override?.activity_type ?? activity.activity_type,
    end: activity.end_time,
    start: activity.start_time,
  }
}

export const defaultFeatureStepDeps = {
  computeFeatures: computeFeaturesForActivity,
  ensureDefaultRules: (user: string, activityType: string) =>
    ensureDefaultRunCategoryRules(user, activityType),
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
  step: () => Promise<T> | T,
  failures?: string[],
): Promise<T | null> => {
  try {
    return await step()
  } catch (error) {
    auditError(user, 'data', message, {
      ...(activityId ? { activity_id: activityId } : {}),
      error: String(error),
    })
    failures?.push(`${message}: ${String(error)}`)
    return null
  }
}

/**
 * Every step runs even when an earlier one failed (a broken route match must not keep a run
 * uncategorised); any failure is rethrown at the end so the job is retried; each step is idempotent.
 */
export const analyseTrack = async (
  user: string,
  activityId: string,
  deps: TrackAnalyseStepDeps,
): Promise<void> => {
  const failures: string[] = []
  await attempt(user, 'Route matching failed', activityId, () => deps.matchRoute(user, activityId), failures)
  const analysed = await attempt(
    user,
    'Activity feature computation failed',
    activityId,
    () => deps.computeFeatures(user, activityId),
    failures,
  )
  if (analysed) {
    await attempt(
      user,
      'Seeding the default run category rules failed',
      activityId,
      () => deps.ensureDefaultRules(user, analysed.activity_type),
      failures,
    )
    await attempt(
      user,
      'Notifying the analysed activity failed',
      activityId,
      () => deps.notify(user, analysed.activity_type, analysed.start, analysed.end),
      failures,
    )
  }
  if (failures.length > 0) throw new Error(`Track analysis of ${activityId} failed: ${failures.join('; ')}`)
}

export const NOTIFY_WINDOW_MS = 30 * 86_400_000

/** Consecutive spans (sorted by start) grouped into windows no longer than `maxMs`; a longer span gets its own. */
export const notifyWindows = (
  spans: { start: Date; end: Date }[],
  maxMs = NOTIFY_WINDOW_MS,
): { start: Date; end: Date }[] => {
  const windows: { start: Date; end: Date }[] = []
  for (const span of spans.toSorted((a, b) => a.start.getTime() - b.start.getTime())) {
    const last = windows.at(-1)
    const end = last && span.end > last.end ? span.end : last?.end
    if (last && end && end.getTime() - last.start.getTime() <= maxMs) last.end = end
    else windows.push({ end: span.end, start: span.start })
  }
  return windows
}

export const backfillActivityFeatures = async (
  user: string,
  deps: FeatureBackfillDeps,
  { recompute = false }: { recompute?: boolean } = {},
): Promise<{ computed: number }> => {
  if (recompute) await deps.deleteAllFeatures(user)
  const pending = await deps.listActivitiesWithoutFeatures(user)
  const analysed: AnalysedActivity[] = []
  for (const { activity_id } of pending) {
    const result = await attempt(user, 'Activity feature computation failed', activity_id, () =>
      deps.computeFeatures(user, activity_id),
    )
    if (result) analysed.push(result)
  }
  if (analysed.length === 0) return { computed: 0 }
  for (const type of new Set(analysed.map((a) => a.activity_type))) {
    await attempt(user, 'Seeding the default run category rules failed', undefined, () =>
      deps.ensureDefaultRules(user, type),
    )
  }
  for (const window of notifyWindows(analysed)) deps.notify(user, '*', window.start, window.end)
  auditInfo(user, 'data', '🏃 Activity features computed', { computed: analysed.length })
  return { computed: analysed.length }
}

export const defaultFeatureBackfillDeps = {
  ...defaultFeatureStepDeps,
  deleteAllFeatures: deleteAllActivityFeatures,
  listActivitiesWithoutFeatures: listTrackedActivitiesWithoutFeatures,
}

export interface ReanalyseDeps {
  rematchRoutes: (user: string, activityIds: string[]) => Promise<unknown>
  recomputeFeatures: (user: string, activityId: string) => Promise<unknown>
  getActivity: (user: string, id: string) => Promise<Activity | null>
}

export const defaultReanalyseDeps: ReanalyseDeps = {
  getActivity: (user, id) => getActivityById(user, id, true),
  recomputeFeatures: async (user, activityId) => {
    if (await getActivityTrack(user, activityId)) {
      await computeAndStoreActivityFeatures(user, activityId, defaultActivityFeatureDeps)
    }
  },
  rematchRoutes: (user, activityIds) => rematchActivityRoute(user, activityIds, defaultRouteMatchDeps),
}

/**
 * After the type the merged view shows changed (a retype, or an override deleted or restored):
 * routes are matched again so a walk does not stay on a run's route, and features are recomputed
 * for the rows that own a track. Failures are audited, never thrown: the edit itself succeeded.
 */
export const reanalyseActivities = async (
  user: string,
  activityIds: string[],
  deps: ReanalyseDeps = defaultReanalyseDeps,
): Promise<void> => {
  await attempt(user, 'Failed to re-match routes after activity retype', undefined, () =>
    deps.rematchRoutes(user, activityIds),
  )
  for (const id of activityIds) {
    await attempt(user, 'Failed to recompute activity features after retype', id, () =>
      deps.recomputeFeatures(user, id),
    )
  }
}

/** For an override deleted or restored: its targets show another type now when theirs differs from its. */
export const reanalyseOverrideTargets = async (
  user: string,
  override: Pick<Activity, 'activity_type' | 'override_target_ids'>,
  deps: ReanalyseDeps = defaultReanalyseDeps,
): Promise<void> => {
  const targetIds = override.override_target_ids ?? []
  if (targetIds.length === 0) return
  const targets = await attempt(user, 'Failed to load override targets', undefined, () =>
    Promise.all(targetIds.map((id) => deps.getActivity(user, id))),
  )
  if (!targets?.some((t) => t && t.activity_type !== override.activity_type)) return
  await reanalyseActivities(user, targetIds, deps)
}
