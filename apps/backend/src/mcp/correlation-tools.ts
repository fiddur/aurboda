/**
 * MCP correlation analysis tools.
 */
import {
  activityImpactInputSchema,
  dateOnlySchema,
  eventProbabilityInputSchema,
  genericCorrelationBodySchema,
  hrvCorrelationInputSchema,
  tzSchema,
} from '@aurboda/api-spec'

import {
  getActivityImpact,
  getBaseline,
  getEventProbability,
  getGenericCorrelation,
  getHrvActivitiesCorrelation,
  type OutcomeConfig,
  type TriggerCondition,
} from '../services/correlations/index.ts'
import { type McpServer, type SyncProvider, tzJsonResponse } from './helpers.ts'

export const registerCorrelationTools = (server: McpServer, user: string, sync?: SyncProvider) => {
  // Tool: get_baseline
  server.tool(
    'get_baseline',
    'Get HRV baseline statistics (7-day and 30-day averages). Returns mean HRV (rmssd) and resting heart rate with trend percentage.',
    {
      reference_date: dateOnlySchema
        .optional()
        .describe('Reference date for baseline calculation in YYYY-MM-DD format. Defaults to today.'),
      tz: tzSchema,
    },
    async ({ reference_date, tz }) => {
      const referenceDate = reference_date ? new Date(reference_date) : undefined
      const baseline = await getBaseline(user, referenceDate)
      return tzJsonResponse({ data: baseline, success: true }, tz)
    },
  )

  // Tool: get_hrv_activities_correlation
  server.tool(
    'get_hrv_activities_correlation',
    'Get HRV correlations with various activities. Returns Pearson correlation coefficients between HRV and productivity, locations, and activity types.',
    { ...hrvCorrelationInputSchema.shape, tz: tzSchema },
    async ({ period_days, tz }) => {
      const periodDays = period_days ?? 30
      const correlations = await getHrvActivitiesCorrelation(user, periodDays, sync)
      return tzJsonResponse({ data: correlations, success: true }, tz)
    },
  )

  // Tool: get_activity_impact
  server.tool(
    'get_activity_impact',
    'Get the impact of a specific activity type on HRV and heart rate. Compares metric values before, during, and after the activity using time windows.',
    { ...activityImpactInputSchema.shape, tz: tzSchema },
    async ({ activity, activity_type, period_days, window_minutes, tz }) => {
      const periodDays = period_days ?? 90
      const windowMinutes = window_minutes ?? 30

      const impact = await getActivityImpact(user, activity, activity_type, windowMinutes, periodDays, sync)
      return tzJsonResponse({ data: impact, success: true }, tz)
    },
  )

  // Tool: get_event_probability
  server.tool(
    'get_event_probability',
    'Get the probability correlation between two events. Analyzes whether one event (trigger) increases or decreases the probability of another event (outcome) occurring within specified time windows. Uses chi-squared test for statistical significance.',
    { ...eventProbabilityInputSchema.shape, tz: tzSchema },
    async ({ lag_windows, outcome_pattern, period_days, trigger_type, trigger_value, tz }) => {
      const probability = await getEventProbability(
        user,
        { type: trigger_type, value: trigger_value },
        { pattern: outcome_pattern, type: 'tag' },
        lag_windows ?? ['12h', '24h', '36h', '48h'],
        period_days ?? 365,
        sync,
      )
      return tzJsonResponse({ data: probability, success: true }, tz)
    },
  )

  // Tool: get_generic_correlation
  server.tool(
    'get_generic_correlation',
    `Analyze correlations between compound triggers and various outcomes. Supports:
- Multiple trigger conditions with AND logic (e.g., "exercise 3x AND fatcoffee 5x in a week")
- Different outcome types: activity types, metrics (weight, body_fat, etc.), or productivity time
- Rolling windows for trigger counting
Examples:
- "Does meditation correlate with more productive time?" -> trigger: activity type "meditation", outcome: productivity
- "When I exercise 3x and do fatcoffee 5x in a week, does my weight change?" -> compound triggers, metric outcome`,
    { ...genericCorrelationBodySchema.shape, tz: tzSchema },
    async ({ lag_windows, outcome, period_days, triggers, tz }) => {
      const result = await getGenericCorrelation(
        user,
        triggers as TriggerCondition[],
        outcome as OutcomeConfig,
        lag_windows ?? ['24h', '48h', '7d'],
        period_days ?? 90,
        sync,
      )
      return tzJsonResponse({ data: result, success: true }, tz)
    },
  )
}
