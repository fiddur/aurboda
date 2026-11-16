import {
  activityImpactInputSchema,
  continuousCorrelationBodySchema,
  dateOnlySchema,
  eventProbabilityInputSchema,
  flaggedWindowsNote,
  genericCorrelationBodySchema,
  hrvCorrelationInputSchema,
  impactDurationBucketsError,
  impactExtraMetricsError,
  impactMetricsInputSchema,
  impactTimeBucketsError,
  includeFlaggedBodySchema,
  isKnownTimezone,
  timeWeightedAveragesNote,
  tzSchema,
} from '@aurboda/api-spec'

import {
  getActivityImpact,
  getBaseline,
  getContinuousCorrelation,
  getCorrelationSelectors,
  getEventProbability,
  getGenericCorrelation,
  getHrvActivitiesCorrelation,
  getImpactMetrics,
  type OutcomeConfig,
  parseImpactPeriod,
  type Selector,
  type TriggerCondition,
} from '../services/correlations/index.ts'
import { errorResponse, type McpServer, type SyncProvider, tzJsonResponse } from './helpers.ts'

export const registerCorrelationTools = (server: McpServer, user: string, sync?: SyncProvider) => {
  server.tool(
    'get_baseline',
    `Get baseline statistics (7-day and 30-day averages) with trend percentage: sleep HRV (rmssd), resting heart rate and stress level. The stress average is time-weighted: samples are averaged per 5-minute bin, then across bins, so 1 Hz samples from a recorded activity weigh no more than other hours. ${flaggedWindowsNote}`,
    {
      include_flagged: includeFlaggedBodySchema,
      reference_date: dateOnlySchema
        .optional()
        .describe('Reference date for baseline calculation in YYYY-MM-DD format. Defaults to today.'),
      tz: tzSchema,
    },
    async ({ include_flagged, reference_date, tz }) => {
      const referenceDate = reference_date ? new Date(reference_date) : undefined
      const baseline = await getBaseline(user, referenceDate, { excludeFlagged: !include_flagged })
      return tzJsonResponse({ data: baseline, success: true }, tz)
    },
  )

  server.tool(
    'get_hrv_activities_correlation',
    'Get autonomic-context correlations with activities, locations, meals carrying each sensitivity flag (correlations.meals: flag_id, flag_name, occurrences; each meal a point occurrence at its time) and productivity. An activity type\'s row also counts its subtypes (types whose parent_type chain reaches it), listed by name in includes_subtypes; a parent row exists even when only subtypes were logged. Per item: mean HRV, heart rate and stress during it (resampled to 5-minute averages, averaged per occurrence; back-to-back or duplicate entries count as one occurrence), the *_delta_from_baseline (during minus the average over the whole period), and hrv_effect / hr_effect / stress_effect: the paired change from the window_minutes before to the window_minutes after (before_mean, after_mean, change, paired_occurrences, p_value from a paired t-test, p_value_adjusted). p_value is the raw p of that one change; p_value_adjusted is Benjamini–Hochberg adjusted over every change in the response, and comparisons says how many there are. Call a change notable only from p_value_adjusted < 0.05: with many comparisons some raw p-values fall below 0.05 by chance. Productivity categories also get correlation_coefficients: the Pearson r of the productivity score with each of hrv_rmssd, heart_rate and stress_level (null when not computable); correlation_coefficient is the one for context_metric (default hrv_rmssd). metrics (at most 4, e.g. ["body_battery", "respiratory_rate"]; list candidates with get_impact_metrics) adds other dense metrics analysed the same way: each item then has metrics.<name> with mean, stddev, delta_from_baseline and effect (productivity rows also correlation_coefficient), and metric_baselines holds their period averages. ' +
      flaggedWindowsNote,
    { ...hrvCorrelationInputSchema.shape, tz: tzSchema },
    async ({ context_metric, include_flagged, metrics, period_days, window_minutes, tz }) => {
      const extraMetrics = metrics ?? []
      const metricsError = impactExtraMetricsError(extraMetrics)
      if (metricsError) return errorResponse(metricsError)
      const periodDays = period_days ?? 30
      const correlations = await getHrvActivitiesCorrelation(
        user,
        periodDays,
        sync,
        context_metric,
        window_minutes ?? 30,
        extraMetrics,
        { excludeFlagged: !include_flagged },
      )
      return tzJsonResponse({ data: correlations, success: true }, tz)
    },
  )

  server.tool(
    'get_activity_impact',
    'Get the impact of an activity on HRV, heart rate and stress. window_minutes (10-1440, default 30) is how long before and after each occurrence to compare. Returns timeline: buckets in time order with phase (before/during/after), start_offset_minutes, end_offset_minutes and hrv/hr/stress stats (each the mean of per-occurrence means over 5-minute averages); each side has 2 buckets when window_minutes is under 60 and 4 otherwise. The legacy *_timeline objects hold the outer and inner halves of the window. Also returns hrv_effect / hr_effect / stress_effect: the paired change from the window before to the window after (before_mean, after_mean, change, paired_occurrences, p_value from a paired t-test, p_value_adjusted). p_value is the raw p of that one change; p_value_adjusted is Benjamini–Hochberg adjusted over every change in the response (the whole and every breakdown group, every metric), and comparisons says how many there are. Call a change notable only from p_value_adjusted < 0.05. Matching entries that overlap or are at most 10 minutes apart count as one occurrence. match: "contains" (default) matches every name containing activity; match: "exact" analyzes one exact type, as the context table on the Analyze page groups it. For activity_type and tag, an activity also matches when one of its ancestor types (parent_type chain) matches, so a parent type includes its subtypes. start and end (ISO 8601, given together) fix the analysed period instead of the last period_days days: start inclusive, end exclusive. metrics (at most 4, e.g. ["body_battery"]; list candidates with get_impact_metrics) adds other dense metrics: metric_effects.<name> and timeline[].metrics.<name>. Breaking down and filtering: a dimension is "duration" (session length in minutes, buckets from duration_buckets limits, default [15, 30, 60], keys like "15-30" and "60-"), "time_of_day" (local start hour in tz, buckets from time_buckets hours, default [0, 6, 12, 18], the last wrapping, keys like "18-0"), "sleep" (a sleep or nap overlapping the window before/after by 5+ minutes; keys none, before, after, both), "type" (the activity type of each occurrence, the subtypes of a parent; activity_type and tag only), "year" (local calendar year of the start in tz, keys like "2024") or "field:<path>" for a data field of the type, scalar (field:session_name) or list item (field:sets.exercise), keyed by value with "(none)" for no value; a merged session with several values is in each group. Sessions and their windows are formed first over every occurrence; filters (all must pass, any key within one) and breakdown groups then select among them, so a left-out session still clips its neighbours\' windows. breakdown repeats the analysis per group in breakdown.groups (key, label, occurrences, avg_duration_min, effects, timeline; at most 12, the rest counted in omitted_groups). include_dimensions: true lists the available dimensions in dimensions[] with their group keys and session counts before filters (fields only for activity_type "activity_type": its categorical fields; type and year only when they have two groups or more). total_occurrences counts sessions before filters; occurrences and the effects describe the sessions the filters keep. activity_type "meal_sensitivity" analyses the meals carrying a sensitivity flag: activity is the flag id (from list_correlation_selectors sensitivities or get_hrv_activities_correlation correlations.meals), match is ignored, each meal is a point occurrence at its time, the response\'s activity is the flag name, and only the time_of_day, sleep and year dimensions apply. Its response also has comparison: the meals without the flag on days marked "meal log completed" (on other days a meal without the flag does not show the food was left out), analysed the same way (occurrences, effects, timeline; no breakdown), its effects in the p-value family. ' +
      flaggedWindowsNote,
    { ...activityImpactInputSchema.shape, tz: tzSchema },
    async ({
      activity,
      activity_type,
      breakdown,
      duration_buckets,
      end,
      filters,
      include_dimensions,
      include_flagged,
      match,
      metrics,
      period_days,
      start,
      time_buckets,
      window_minutes,
      tz,
    }) => {
      const period = parseImpactPeriod(start, end)
      if (!period.ok) return errorResponse(period.error)
      const extraMetrics = metrics ?? []
      const metricsError = impactExtraMetricsError(extraMetrics)
      if (metricsError) return errorResponse(metricsError)
      const bucketsError =
        (duration_buckets && impactDurationBucketsError(duration_buckets)) ||
        (time_buckets && impactTimeBucketsError(time_buckets))
      if (bucketsError) return errorResponse(bucketsError)
      const periodDays = period_days ?? 90
      const windowMinutes = window_minutes ?? 30

      const impact = await getActivityImpact(
        user,
        activity,
        activity_type,
        windowMinutes,
        periodDays,
        sync,
        period.until,
        period.since,
        match,
        extraMetrics,
        {
          breakdown,
          durationBuckets: duration_buckets,
          filters,
          includeDimensions: include_dimensions,
          timeBuckets: time_buckets,
          tz: tz && isKnownTimezone(tz) ? tz : undefined,
        },
        { excludeFlagged: !include_flagged },
      )
      return tzJsonResponse({ data: impact, success: true }, tz)
    },
  )

  server.tool(
    'get_impact_metrics',
    'List the metrics usable in the activity-impact analysis, to pass as metrics to get_activity_impact and get_hrv_activities_correlation: every non-cumulative metric besides HRV, heart rate and stress that is recorded around the clock, so there is data before and after a session. That is data on at least 3 days of the period, with a sample in a median of at least 48 of the 96 15-minute slots of a day (half of the day) on the days that have data. Metrics recorded only during workouts or sleep (often respiration rate) and daily values do not qualify. Returns metric, label, unit, coverage_hours_per_day and samples_per_day, best covered first.',
    { ...impactMetricsInputSchema.shape, tz: tzSchema },
    async ({ period_days, tz }) => {
      const metrics = await getImpactMetrics(user, period_days ?? 30)
      return tzJsonResponse({ data: { metrics }, success: true }, tz)
    },
  )

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

  server.tool(
    'get_generic_correlation',
    `Analyze correlations between compound triggers and various outcomes. Supports:
- Multiple trigger conditions with AND logic (e.g., "exercise 3x AND fatcoffee 5x in a week")
- Different outcome types: activity types, metrics (weight, body_fat, etc.), or productivity time
- Rolling windows for trigger counting
For a metric outcome, sample_count counts the raw samples; ${timeWeightedAveragesNote} Their mean and stddev are taken over the bins, counted in bin_count.
For an event outcome, event_outcome.per_lag[] has p_value (raw, for that lag alone) and p_value_adjusted (Benjamini–Hochberg over the event_outcome.comparisons lags); call a lag notable only from p_value_adjusted < 0.05.
Examples:
- "Does meditation correlate with more productive time?" -> trigger: activity type "meditation", outcome: productivity
- "When I exercise 3x and do fatcoffee 5x in a week, does my weight change?" -> compound triggers, metric outcome
${flaggedWindowsNote} Activities, app time and samples in a flagged window are dropped and its days leave the baseline (event outcomes: the analysed days).`,
    { ...genericCorrelationBodySchema.shape, tz: tzSchema },
    async ({
      denominator,
      include_flagged,
      lag_windows,
      outcome,
      period_days,
      period_end,
      period_start,
      triggers,
      tz,
    }) => {
      const result = await getGenericCorrelation(
        user,
        triggers as TriggerCondition[],
        outcome as OutcomeConfig,
        lag_windows ?? ['24h', '48h', '7d'],
        period_days ?? 90,
        sync,
        { denominator, excludeFlagged: !include_flagged, periodEnd: period_end, periodStart: period_start },
      )
      return tzJsonResponse({ data: result, success: true }, tz)
    },
  )

  server.tool(
    'get_metric_correlation',
    `Correlate two daily data dimensions with Pearson + Spearman and an optional day lag.
Dimensions (selectors) can be a metric, nutrition (carbs/protein/fat/calories/fiber),
a tag/activity, a productivity category/app, or a sensitivity flag ({kind:"sensitivity", flag:<flag id>}:
meals that day carrying the flag; known on days with a meal or marked meal log completed, other days
unknown). Aligns only on days where both sides are known.
A night's sleep metrics (sleep_score, the sleep hrv_rmssd) are stamped on the day the night ends, so
lag_days: 1 pairs a day with the night that follows it.
Example: "How does carb intake affect my sleep score the next day?"
-> trigger: {kind:"nutrition", nutrient:"carbs"}, outcome: {kind:"metric", metric:"sleep_score"}, lag_days: 1
Example: "Do I sleep worse the night after eating gluten?"
-> trigger: {kind:"sensitivity", flag:<gluten flag id>}, outcome: {kind:"metric", metric:"sleep_score"}, lag_days: 1
${flaggedWindowsNote} Here a day overlapping a flagged window is left out on either side of a pair.`,
    { ...continuousCorrelationBodySchema.shape, tz: tzSchema },
    async ({
      include_flagged,
      lag_days,
      nutrition_completeness,
      outcome,
      period_days,
      period_end,
      period_start,
      trigger,
      tz,
    }) => {
      const result = await getContinuousCorrelation(
        user,
        {
          excludeFlagged: !include_flagged,
          lagDays: lag_days,
          nutritionCompleteness: nutrition_completeness,
          outcome: outcome as Selector,
          periodDays: period_days,
          periodEnd: period_end,
          periodStart: period_start,
          trigger: trigger as Selector,
        },
        sync,
      )
      return tzJsonResponse({ data: result, success: true }, tz)
    },
  )

  server.tool(
    'list_correlation_selectors',
    'List the data dimensions available to correlate: metrics, tags, activity types, nutrients, productivity categories and sensitivity flags (value is the flag id for a sensitivity selector or a meal_sensitivity impact). Use to discover valid selector values before calling get_generic_correlation or get_metric_correlation.',
    { tz: tzSchema },
    async ({ tz }) => {
      const data = await getCorrelationSelectors(user)
      return tzJsonResponse({ data, success: true }, tz)
    },
  )
}
