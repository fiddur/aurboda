import type { StrengthScoreMetricsDeps } from './refresh.ts'

import {
  expandActivityTypes,
  getDerivedMetricStamp,
  getStrengthScoreInputAggregates,
  getUserSettings,
  reconcileTimeSeries,
  setDerivedMetricStamp,
} from '../../db/index.ts'
import { loadExerciseCatalog } from '../exercise-catalog.ts'
import { defaultStrengthScoreDeps, loadScoredSets } from '../queries/strength-score.ts'
import { getUserTimezone } from '../settings.ts'
import { loadStrengthReferences } from '../strength-references.ts'

export const defaultStrengthScoreMetricsDeps = (): StrengthScoreMetricsDeps => {
  const scoreDeps = defaultStrengthScoreDeps()
  return {
    catalogVersion: () => loadExerciseCatalog().version,
    expandActivityTypes,
    getDerivedMetricStamp,
    getInputAggregates: getStrengthScoreInputAggregates,
    getUserSettings,
    getUserTimezone,
    loadScoredSets: (user, activityType, path, period) =>
      loadScoredSets(user, activityType, path, period, scoreDeps),
    loadStrengthReferences,
    reconcileTimeSeries,
    setDerivedMetricStamp,
  }
}
