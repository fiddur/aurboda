/**
 * MCP correlation analysis tools.
 */
import {
  activityImpactInputSchema,
  dateOnlySchema,
  eventProbabilityInputSchema,
  genericCorrelationBodySchema,
  hrvCorrelationInputSchema,
} from '@aurboda/api-spec'

import {
  getActivityImpact,
  getBaseline,
  getEventProbability,
  getGenericCorrelation,
  getHrvActivitiesCorrelation,
  type OutcomeConfig,
  type TriggerCondition,
} from '../services/correlations.ts'
import { jsonResponse, type McpServer, type SyncProvider } from './helpers.ts'

export const registerCorrelationTools = (server: McpServer, user: string, sync?: SyncProvider) => {
  // Tool: get_baseline
  server.tool(
    'get_baseline',
    'Get HRV baseline statistics (7-day and 30-day averages). Returns mean HRV (rmssd) and resting heart rate with trend percentage.',
    {
      reference_date: dateOnlySchema
        .optional()
        .describe('Reference date for baseline calculation in YYYY-MM-DD format. Defaults to today.'),
    },
    async ({ reference_date }) => {
      const referenceDate = reference_date ? new Date(reference_date) : undefined
      const baseline = await getBaseline(user, referenceDate)
      return jsonResponse({ data: baseline, success: true })
    },
  )

  // Tool: get_hrv_activities_correlation
  server.tool(
    'get_hrv_activities_correlation',
    'Get HRV correlations with various activities. Returns Pearson correlation coefficients between HRV and productivity, locations, activities, and tags.',
    { ...hrvCorrelationInputSchema.shape },
    async ({ period_days }) => {
      const periodDays = period_days ?? 30
      const correlations = await getHrvActivitiesCorrelation(user, periodDays, sync)
      return jsonResponse({ data: correlations, success: true })
    },
  )

  // Tool: get_activity_impact
  server.tool(
    'get_activity_impact',
    'Get the impact of a specific activity/tag on HRV and heart rate. Compares metric values before, during, and after the activity using time windows.',
    { ...activityImpactInputSchema.shape },
    async ({ activity, activity_type, period_days, window_minutes }) => {
      const periodDays = period_days ?? 90
      const windowMinutes = window_minutes ?? 30

      const impact = await getActivityImpact(user, activity, activity_type, windowMinutes, periodDays, sync)
      return jsonResponse({ data: impact, success: true })
    },
  )

  // Tool: get_event_probability
  server.tool(
    'get_event_probability',
    'Get the probability correlation between two events. Analyzes whether one event (trigger) increases or decreases the probability of another event (outcome) occurring within specified time windows. Uses chi-squared test for statistical significance.',
    { ...eventProbabilityInputSchema.shape },
    async ({ lag_windows, outcome_pattern, period_days, trigger_type, trigger_value }) => {
      const probability = await getEventProbability(
        user,
        { type: trigger_type, value: trigger_value },
        { pattern: outcome_pattern, type: 'tag' },
        lag_windows ?? ['12h', '24h', '36h', '48h'],
        period_days ?? 365,
        sync,
      )
      return jsonResponse({ data: probability, success: true })
    },
  )

  // Tool: get_generic_correlation
  server.tool(
    'get_generic_correlation',
    `Analyze correlations between compound triggers and various outcomes. Supports:
- Multiple trigger conditions with AND logic (e.g., "exercise 3x AND fatcoffee 5x in a week")
- Different outcome types: tags, metrics (weight, body_fat, etc.), or productivity time
- Rolling windows for trigger counting
Examples:
- "Does meditation correlate with more productive time?" -> trigger: tag "meditation", outcome: productivity
- "When I exercise 3x and tag FatCoffee 5x in a week, does my weight change?" -> compound triggers, metric outcome`,
    { ...genericCorrelationBodySchema.shape },
    async ({ lag_windows, outcome, period_days, triggers }) => {
      const result = await getGenericCorrelation(
        user,
        triggers as TriggerCondition[],
        outcome as OutcomeConfig,
        lag_windows ?? ['24h', '48h', '7d'],
        period_days ?? 90,
        sync,
      )
      return jsonResponse({ data: result, success: true })
    },
  )
}
