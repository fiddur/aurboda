/**
 * Type definitions for correlation analysis services.
 */

import type { LagExposureResult } from './event-outcome.ts'

/** HRV statistics for a context/activity */
export interface HrvStats {
  mean_hrv: number | null
  stddev_hrv: number | null
  mean_hr: number | null
  stddev_hr: number | null
  mean_stress: number | null
  stddev_stress: number | null
  sample_minutes: number
  sample_count: number
}

/** HRV stats with baseline comparison */
export interface HrvStatsWithDelta extends HrvStats {
  hrv_delta_from_baseline: number | null
  hr_delta_from_baseline: number | null
  stress_delta_from_baseline: number | null
}

/** Baseline statistics result */
export interface BaselineResult {
  hrv: {
    avg7day: number | null
    avg30day: number | null
    trend_percent: number | null
  }
  resting_hr: {
    avg7day: number | null
    avg30day: number | null
    trend_percent: number | null
  }
  stress: {
    avg7day: number | null
    avg30day: number | null
    trend_percent: number | null
  }
  period: {
    start: string
    end: string
  }
}

/** Correlation by productivity category */
export interface ProductivityCorrelation extends HrvStatsWithDelta {
  category: string
  /** Pearson correlation between productivity score and HRV (-1 to 1) */
  correlation_coefficient: number | null
}

/** Correlation by location */
export interface LocationCorrelation extends HrvStatsWithDelta {
  location_name: string
  visit_count: number
}

/** Correlation by activity type */
export interface ActivityCorrelation extends HrvStatsWithDelta {
  activity_type: string
  occurrences: number
  avg_duration_min?: number
}

/** Movement state correlation */
export interface MovementCorrelation extends HrvStatsWithDelta {
  state: 'sedentary' | 'walking' | 'post_exercise_30min'
}

/** Full HRV-activities correlation result */
export interface HrvActivitiesResult {
  period: {
    start: string
    end: string
    days: number
  }
  baseline: HrvStats
  correlations: {
    productivity: ProductivityCorrelation[]
    locations: LocationCorrelation[]
    activities: ActivityCorrelation[]
  }
}

/** Time window stats for activity impact */
export interface TimeWindowStats {
  mean: number | null
  stddev: number | null
  sample_count: number
}

/** Activity impact timeline result */
export interface ActivityImpactResult {
  activity: string
  activity_type: 'productivity_category' | 'productivity_app' | 'location' | 'tag' | 'activity_type'
  occurrences: number
  avg_duration_min: number
  hrv_timeline: {
    before30min: TimeWindowStats
    before15min: TimeWindowStats
    during: TimeWindowStats
    after15min: TimeWindowStats
    after30min: TimeWindowStats
  }
  hr_timeline: {
    before30min: TimeWindowStats
    before15min: TimeWindowStats
    during: TimeWindowStats
    after15min: TimeWindowStats
    after30min: TimeWindowStats
  }
  stress_timeline: {
    before30min: TimeWindowStats
    before15min: TimeWindowStats
    during: TimeWindowStats
    after15min: TimeWindowStats
    after30min: TimeWindowStats
  }
}

/** Lag window result for event probability */
export interface LagWindowResult {
  probability: number
  relative_risk: number
  occurrences: number
}

/** Event probability result */
export interface EventProbabilityResult {
  trigger: {
    type: 'activity' | 'tag'
    value: string
  }
  outcome: {
    type: 'tag'
    pattern: string
  }
  period: {
    start: string
    end: string
  }
  baseline: {
    probability: number
    description: string
  }
  post_trigger: Record<string, LagWindowResult>
  sample_size: {
    trigger_events: number
    outcome_events: number
    days_analyzed: number
  }
  statistical_significance: {
    chi_squared: number | null
    p_value: number | null
  }
}

// ============================================================================
// Generic Correlation Types
// ============================================================================

/** Nutrient keys with authoritative per-day meal totals. */
export type NutrientKey = 'calories' | 'protein' | 'carbs' | 'fat' | 'fiber'

/** Threshold turning a numeric value into a discrete event. */
export interface ThresholdSpec {
  op: 'gt' | 'gte' | 'lt' | 'lte'
  value: number
}

/** Trigger condition for generic correlation */
export interface TriggerCondition {
  type: 'activity' | 'tag' | 'productivity_category' | 'productivity_app' | 'nutrition'
  /** Pattern to match (omitted for nutrition triggers). */
  pattern?: string
  /** Nutrient to use when type is 'nutrition'. */
  nutrient?: NutrientKey
  /** Threshold turning a daily value into a trigger (default: value > 0). */
  threshold?: ThresholdSpec
  /** Minimum count within the window (default: 1) */
  min_count?: number
  /** Rolling window in days for counting (default: 1) */
  window_days?: number
}

/** Tag outcome configuration */
export interface TagOutcome {
  type: 'tag'
  pattern: string
}

/** Metric outcome configuration */
export interface MetricOutcome {
  type: 'metric'
  /** Metric name (validated at API level) */
  metric: string
  /** Aggregation method for multiple values (default: 'mean') */
  aggregation?: 'mean' | 'min' | 'max' | 'last'
}

/** Productivity outcome configuration */
export interface ProductivityOutcome {
  type: 'productivity'
  /** Category to measure time in */
  category?: string
  /** Specific app to measure time in */
  app?: string
}

/** Event outcome configuration (presence-only / discrete onset analysis). */
export interface EventOutcomeConfig {
  type: 'event'
  source: 'metric' | 'tag'
  /** Metric name when source is 'metric'. */
  metric?: string
  /** Regex for the outcome tag when source is 'tag'. */
  pattern?: string
  /** Threshold defining an event (default: value > 0). */
  threshold?: ThresholdSpec
  /** Consecutive event days within this gap collapse into one onset (default: 3). */
  collapse_gap_days?: number
}

export type OutcomeConfig = TagOutcome | MetricOutcome | ProductivityOutcome | EventOutcomeConfig

/** Result for tag outcomes in lag windows */
export interface TagLagResult {
  probability: number
  relative_risk: number
  occurrences: number
}

/** Result for metric outcomes in lag windows */
export interface MetricLagResult {
  mean: number | null
  stddev: number | null
  sample_count: number
  delta_from_baseline: number | null
}

/** Result for productivity outcomes in lag windows */
export interface ProductivityLagResult {
  total_minutes: number
  avg_minutes_per_day: number
  delta_from_baseline: number | null
}

export type LagResult = TagLagResult | MetricLagResult | ProductivityLagResult

/** Baseline stats for metric outcomes */
export interface MetricBaseline {
  mean: number | null
  stddev: number | null
  sample_count: number
}

/** Baseline stats for productivity outcomes */
export interface ProductivityBaseline {
  avg_minutes_per_day: number
  total_minutes: number
}

/** Baseline stats for tag outcomes */
export interface TagBaseline {
  probability: number
  description: string
}

export type BaselineStats = MetricBaseline | ProductivityBaseline | TagBaseline

/** Options for the generic correlation event-outcome mode and regime scoping. */
export interface GenericCorrelationOptions {
  /** Inclusive regime start (YYYY-MM-DD); overrides periodDays when set. */
  periodStart?: string
  /** Inclusive regime end (YYYY-MM-DD); defaults to today. */
  periodEnd?: string
  /** Denominator universe for event outcomes (default: 'known'). */
  denominator?: 'known' | 'all'
}

/** Event-outcome analysis attached to a generic correlation result. */
export interface EventOutcomeBlock {
  denominator: 'known' | 'all'
  collapse_gap_days: number
  trigger_days: number
  outcome_days: number
  onsets: number
  known_days: number
  per_lag: LagExposureResult[]
}

/** Generic correlation result */
export interface GenericCorrelationResult {
  triggers: TriggerCondition[]
  outcome: OutcomeConfig
  period: {
    start: string
    end: string
    days: number
  }
  /** Number of windows where all trigger conditions were met */
  windows_matched: number
  /** Baseline statistics (periods without triggers) */
  baseline: BaselineStats
  /** Results for each lag window */
  post_trigger: Record<string, LagResult>
  /** Exposure-corrected analysis (present when outcome.type === 'event'). */
  event_outcome?: EventOutcomeBlock
  statistical_significance: {
    chi_squared: number | null
    p_value: number | null
  }
}
