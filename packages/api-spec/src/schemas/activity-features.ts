/** Features computed from an activity's HR, speed and track, and the run categories rules derive from them. */
import { z } from 'zod'

export const activityFeatureNameSchema = z
  .enum([
    'elapsed_s',
    'moving_s',
    'zone0_fraction',
    'zone1_fraction',
    'zone2_fraction',
    'zone3_fraction',
    'zone4_fraction',
    'zone5_fraction',
    'low_hr_fraction',
    'low_hr_ceiling_bpm',
    'hr_drift_pct',
    'pace_cv',
    'interval_count',
    'work_block_median_s',
    'rest_block_median_s',
    'work_block_cv',
    'work_rest_pace_ratio',
    'elevation_gain_m',
    'elevation_oscillation',
    'duration_vs_median_90d',
  ])
  .meta({
    id: 'ActivityFeatureName',
    description: 'Name of a feature computed from an activity (see ActivityFeatures for each definition)',
  })

export type ActivityFeatureName = z.infer<typeof activityFeatureNameSchema>

const feature = (description: string) => z.number().nullable().meta({ description })

const zoneFraction = (zone: number) =>
  feature(`Share of the HR-covered time spent in HR zone ${zone} (0–1); null without HR samples`)

export const activityFeaturesSchema = z
  .object({
    activity_id: z.string().uuid(),
    computed_at: z.string().meta({ description: 'When the features were computed (ISO 8601)' }),
    duration_vs_median_90d: feature(
      "Elapsed time ÷ the median elapsed time of the user's activities of this type over the 90 days before; null without that median",
    ),
    elapsed_s: feature('Seconds from start to end'),
    elevation_gain_m: feature(
      'Total climb in metres from the track altitude (5-point smoothing, 3 m hysteresis); null without a track',
    ),
    elevation_oscillation: feature(
      'Climb plus descent in metres per kilometre of track; null without a track',
    ),
    hr_drift_pct: feature(
      'Aerobic decoupling in %: second-half HR/speed over first-half HR/speed, minus one (HR alone without speed); null with fewer than 10 HR samples in either half',
    ),
    interval_count: feature(
      'Number of work blocks (fast stretches of 30 s–8 min above the median moving speed); null without speed samples',
    ),
    low_hr_ceiling_bpm: feature('The low-HR (MAF) ceiling in bpm the low_hr_fraction was computed against'),
    low_hr_fraction: feature(
      'Share of the HR-covered time at or below the low-HR ceiling (0–1); null without HR samples',
    ),
    moving_s: feature('Seconds moving (speed above 0.5 m/s); the elapsed time without speed samples'),
    pace_cv: feature(
      'Coefficient of variation (std ÷ mean) of the 30 s smoothed pace over the samples at or above 1.5 m/s (walking and stops left out); null with fewer than 30 such samples',
    ),
    rest_block_median_s: feature('Median duration in seconds of the slow blocks between two work blocks'),
    work_block_cv: feature(
      'Coefficient of variation of the work block durations; null with fewer than 2 work blocks',
    ),
    work_block_median_s: feature('Median duration in seconds of the work blocks'),
    work_rest_pace_ratio: feature(
      'Median rest pace ÷ median work pace (above 1 means the work blocks are faster); null without both',
    ),
    zone0_fraction: zoneFraction(0),
    zone1_fraction: zoneFraction(1),
    zone2_fraction: zoneFraction(2),
    zone3_fraction: zoneFraction(3),
    zone4_fraction: zoneFraction(4),
    zone5_fraction: zoneFraction(5),
  })
  .meta({
    id: 'ActivityFeatures',
    description:
      'Features computed from an activity (HR zones, low-HR share, drift, pace variability, intervals, elevation, duration); a feature the data cannot support is null',
  })

export type ActivityFeatures = z.infer<typeof activityFeaturesSchema>

export const runCategoryNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/)
  .max(64)

export const runCategorySchema = z
  .object({
    category: runCategoryNameSchema.meta({ description: 'Category name (snake_case), e.g. "low_hr"' }),
    reasons: z
      .array(z.string())
      .meta({ description: 'Why the category applies, e.g. the feature conditions that matched' }),
    rule_id: z
      .string()
      .uuid()
      .optional()
      .meta({ description: 'The deduction rule that set it; absent when set by hand' }),
  })
  .meta({
    id: 'RunCategory',
    description:
      'A category on a run activity (data.run_categories): set by a deduction rule (rule_id) or by hand. data.run_categories_excluded: string[] lists categories the user removed so rules do not re-add them.',
  })

export type RunCategory = z.infer<typeof runCategorySchema>

export const runCategoriesSchema = z.array(runCategorySchema)

export type RunCategories = z.infer<typeof runCategoriesSchema>

export const runCategoryFilterSchema = runCategoryNameSchema

export const activityFeatureOperatorSchema = z.enum(['gte', 'gt', 'lte', 'lt'])

export type ActivityFeatureOperator = z.infer<typeof activityFeatureOperatorSchema>
