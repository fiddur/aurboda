/**
 * Correlation analysis services for health data.
 *
 * Provides statistical analysis of correlations between HRV/HR and various
 * activity sources (RescueTime, locations, activities).
 * Note: 'tag' type is kept as backward-compat alias for 'activity_type'.
 */

export { getActivityImpact } from './activity-impact.ts'
export { getBaseline } from './baseline.ts'
export { getEventProbability } from './event-probability.ts'
export { getGenericCorrelation } from './generic.ts'
export { getHrvActivitiesCorrelation } from './hrv-activities.ts'
export {
  type ContinuousCorrelation,
  type ContinuousParams,
  type EventOutcomeCorrelation,
  type EventOutcomeParams,
  getContinuousCorrelation,
  getEventOutcomeCorrelation,
} from './explore.ts'
export { computeEventOutcome, type EventOutcomeResult, type LagExposureResult } from './event-outcome.ts'
export { computeContinuous, type ContinuousResult } from './continuous.ts'
export { resolveSelector, type Selector, type ThresholdSpec } from './selectors.ts'
export type {
  ActivityCorrelation,
  ActivityImpactResult,
  BaselineResult,
  BaselineStats,
  GenericCorrelationResult,
  HrvActivitiesResult,
  HrvStats,
  HrvStatsWithDelta,
  LagResult,
  LagWindowResult,
  LocationCorrelation,
  MetricBaseline,
  MetricLagResult,
  MetricOutcome,
  MovementCorrelation,
  OutcomeConfig,
  ProductivityBaseline,
  ProductivityCorrelation,
  ProductivityLagResult,
  ProductivityOutcome,
  TagBaseline,
  TagLagResult,
  TagOutcome,
  EventProbabilityResult,
  TimeWindowStats,
  TriggerCondition,
} from './types.ts'
