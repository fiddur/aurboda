/**
 * MCP correlation analysis tools.
 */
import { dateOnlySchema } from '@aurboda/api-spec'
import { z } from 'zod'
import {
  getActivityImpact,
  getBaseline,
  getEventProbability,
  getGenericCorrelation,
  getHrvActivitiesCorrelation,
  type OutcomeConfig,
  type TriggerCondition,
} from '../services/correlations'
import { jsonResponse, type McpServer, type SyncProvider } from './helpers'

// eslint-disable-next-line max-lines-per-function -- tool registrations are inherently long
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
    {
      period_days: z.number().int().optional().describe('Number of days to analyze. Defaults to 30.'),
    },
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
    {
      activity: z
        .string()
        .describe('The activity or tag name to analyze (e.g., "gym", "coffee", "meditation")'),
      activity_type: z
        .enum(['productivity_category', 'productivity_app', 'location', 'tag', 'activity_type'])
        .describe('Type of activity to search for'),
      period_days: z.number().int().optional().describe('Number of days to analyze. Defaults to 90.'),
      window_minutes: z
        .number()
        .int()
        .optional()
        .describe('Minutes to analyze before/after the activity. Defaults to 30.'),
    },
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
    {
      lag_windows: z
        .array(z.string())
        .optional()
        .describe(
          'Time windows to analyze (e.g., ["12h", "24h", "36h", "48h"]). Uses hours (h) or days (d).',
        ),
      outcome_pattern: z
        .string()
        .describe('Regex pattern for outcome tags (e.g., "headache|migraine", "good_sleep")'),
      period_days: z.number().int().optional().describe('Number of days to analyze. Defaults to 365.'),
      trigger_type: z.enum(['activity', 'tag']).describe('Type of trigger event'),
      trigger_value: z
        .string()
        .describe('Trigger activity type or tag pattern (e.g., "exercise", "gym", "coffee")'),
    },
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
    {
      lag_windows: z
        .array(z.string())
        .optional()
        .describe('Time windows to analyze after trigger (e.g., ["24h", "7d"]). Uses hours (h) or days (d).'),
      outcome: z
        .object({
          app: z.string().optional().describe('For productivity: specific app to measure'),
          category: z.string().optional().describe('For productivity: category to measure'),
          metric: z.string().optional().describe('For metric: metric name (e.g., "weight", "body_fat")'),
          pattern: z.string().optional().describe('For tag: regex pattern to match'),
          type: z.enum(['tag', 'metric', 'productivity']).describe('Type of outcome to measure'),
        })
        .describe('Outcome to measure'),
      period_days: z.number().int().optional().describe('Number of days to analyze. Defaults to 90.'),
      triggers: z
        .array(
          z.object({
            minCount: z.number().int().optional().describe('Minimum occurrences in window (default: 1)'),
            pattern: z.string().describe('Pattern to match (regex for tags, name for activities)'),
            type: z
              .enum(['activity', 'tag', 'productivity_category', 'productivity_app'])
              .describe('Type of trigger'),
            windowDays: z.number().int().optional().describe('Rolling window in days (default: 1)'),
          }),
        )
        .describe('Trigger conditions (all must be met)'),
    },
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
