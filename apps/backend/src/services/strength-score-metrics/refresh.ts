import { strengthScoreMetrics } from '@aurboda/api-spec'

import type { StrengthScoreInputAggregates, TimeSeriesPoint, UserSettings } from '../../db/index.ts'
import type { ItemValueResult } from '../item-value-aliases.ts'
import type { Period } from '../queries/muscle-group-history.ts'
import type { LoadedScoredSets } from '../queries/strength-score.ts'
import type { StrengthReferences } from '../strength-references.ts'

import { dayKey } from '../day-keys.ts'
import { dailyScorePoints } from './series.ts'
import { strengthScoreStamp } from './stamp.ts'

export const STRENGTH_SCORE_ACTIVITY_TYPE = 'strength_training'
export const STRENGTH_SCORE_PATH = 'sets.exercise'
export const STRENGTH_SCORE_STATE_NAME = 'strength_score'

export interface StrengthScoreMetricsDeps {
  catalogVersion: () => string
  expandActivityTypes: (user: string, types: string[]) => Promise<string[]>
  getDerivedMetricStamp: (user: string, name: string) => Promise<string | null>
  getInputAggregates: (
    user: string,
    activityTypes: readonly string[],
  ) => Promise<StrengthScoreInputAggregates>
  getUserSettings: (user: string) => Promise<Pick<UserSettings, 'sex'> | null>
  getUserTimezone: (user: string) => Promise<string>
  loadScoredSets: (
    user: string,
    activityType: string,
    path: string,
    period: Period,
  ) => Promise<ItemValueResult<LoadedScoredSets>>
  loadStrengthReferences: () => StrengthReferences
  reconcileTimeSeries: (
    user: string,
    source: string,
    metrics: readonly string[],
    points: TimeSeriesPoint[],
  ) => Promise<{ removed: number; written: number }>
  setDerivedMetricStamp: (user: string, name: string, stamp: string) => Promise<void>
}

export type StrengthScoreRefreshResult =
  | { skipped: true }
  | { removed: number; skipped: false; written: number }

/**
 * Brings the user's stored strength score metrics up to date, unless nothing they follow from changed since the last
 * run. The stamp is read before the calculation, so a change landing meanwhile makes the next run differ and redo it.
 */
export const refreshStrengthScoreMetrics = async (
  user: string,
  deps: StrengthScoreMetricsDeps,
  now: Date = new Date(),
): Promise<StrengthScoreRefreshResult> => {
  const activityTypes = await deps.expandActivityTypes(user, [STRENGTH_SCORE_ACTIVITY_TYPE])
  const [aggregates, settings, timezone, stored] = await Promise.all([
    deps.getInputAggregates(user, activityTypes),
    deps.getUserSettings(user),
    deps.getUserTimezone(user),
    deps.getDerivedMetricStamp(user, STRENGTH_SCORE_STATE_NAME),
  ])
  const stamp = strengthScoreStamp({
    activity_types: activityTypes,
    aggregates,
    catalog_version: deps.catalogVersion(),
    references_version: deps.loadStrengthReferences().version,
    sex: settings?.sex ?? null,
    timezone,
    today: dayKey(now, timezone),
  })
  if (stamp === stored) return { skipped: true }

  const loaded = await deps.loadScoredSets(user, STRENGTH_SCORE_ACTIVITY_TYPE, STRENGTH_SCORE_PATH, {
    end: now,
    start: new Date(0),
  })
  const points = loaded.success
    ? dailyScorePoints(loaded.data.sets, loaded.data.references, loaded.data.subject, now, timezone)
    : []
  const { removed, written } = await deps.reconcileTimeSeries(user, 'aurboda', strengthScoreMetrics, points)
  await deps.setDerivedMetricStamp(user, STRENGTH_SCORE_STATE_NAME, stamp)
  return { removed, skipped: false, written }
}
