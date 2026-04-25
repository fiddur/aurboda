/**
 * Training load (Banister impulse-response model).
 *
 * The original `services/training-load.ts` was split by responsibility:
 *  - banister.ts    — pure math (TRIMP, EMA, recovery zones, settings helpers)
 *  - aggregation.ts — DST-aware bucket aggregation
 *  - hr-cache.ts    — observed_hr_max cache shared by read + write
 *  - recompute.ts   — write path (chunked impulse recomputation)
 *  - query.ts       — read path (computeTrainingLoad)
 *  - deps.ts        — TrainingLoadDeps interface + production deps factory
 */
export { aggregateTrainingLoadPoints, floorToLocalBucket } from './aggregation.ts'

export {
  calculateTrimp,
  computeHourlyImpulses,
  computeHourlyLoadSeries,
  computeRecoveryZones,
  floorToHour,
  getAverageHrForSession,
  getCurrentHourStart,
  getEffectiveSettings,
  getWorkoutTrimpForHour,
  resolveHrMax,
  resolveHrRest,
  type HourlyImpulses,
  type HourlyLoadParams,
  type ResolvedTrainingLoadSettings,
  type TrimpCalcParams,
} from './banister.ts'

export { createTrainingLoadDeps, type TrainingLoadDeps } from './deps.ts'

export { recomputeImpulseBuckets } from './recompute.ts'

export { computeTrainingLoad } from './query.ts'
