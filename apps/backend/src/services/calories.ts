/**
 * Per-minute calorie estimation from heart-rate data using a zone-METs model.
 *
 * For each per-minute HR sample, we look up METs by linear interpolation
 * between MET anchors placed at the user's calibrated HR zone boundaries
 * (resting → z1 → z2 → z3 → z4 → z5 → observed max). METs are then scaled
 * by BMR/min — lab-measured BMR (the `basal_metabolic_rate` metric) when
 * available, otherwise the Mifflin-St Jeor estimate. The per-minute total
 * is floored at BMR/min so non-active minutes still contribute true resting
 * burn.
 *
 * Why not the omnicalc/Keytel formula? Keytel is calibrated against
 * steady-state exercise (HR > ~60% HRmax) and systematically overshoots at
 * resting/light-activity HR. Replaying 14 days of intake against a
 * stable-weight user landed Keytel + lab-BMR at +21% over true burn and a
 * BMR/min-baseline variant at +92%; zone-METs landed within ~10%, anchored
 * on the user's own physiology.
 */

import type { BiologicalSex, HrZoneThresholds } from '@aurboda/api-spec'

/**
 * Maximum minutes a single HR reading can be held forward.
 * If the gap between consecutive HR samples exceeds this, minutes beyond
 * the threshold are skipped (no calorie data rather than stale data).
 */
export const MAX_HOLD_MINUTES = 5

/** MET anchors at boundaries [resting, z1, z2, z3, z4, z5, observed_max]. */
export const ZONE_METS_ANCHORS = [1, 2, 4, 6, 8.5, 11, 13] as const

export interface ZoneMetsContext {
  /** Resting HR (bpm). At and below this, METs = 1 (BMR-only). */
  resting_hr: number
  /** Custom or derived zone-start HRs in bpm: { 1, 2, 3, 4, 5 }. */
  zones: HrZoneThresholds
  /** Cached observed maximum HR (bpm). Used as the upper anchor. */
  observed_hr_max: number
}

/**
 * Compute METs at a given HR by linear interpolation between the anchors
 * [resting_hr, z1, z2, z3, z4, z5, observed_hr_max] using ZONE_METS_ANCHORS.
 * Returns 1 at and below resting_hr; 13 at and above observed_hr_max.
 */
export const computeMetsForHr = (hr: number, ctx: ZoneMetsContext): number => {
  const boundaries = [
    ctx.resting_hr,
    ctx.zones[1],
    ctx.zones[2],
    ctx.zones[3],
    ctx.zones[4],
    ctx.zones[5],
    ctx.observed_hr_max,
  ]
  if (hr <= boundaries[0]) return ZONE_METS_ANCHORS[0]
  if (hr >= boundaries[boundaries.length - 1]) return ZONE_METS_ANCHORS[ZONE_METS_ANCHORS.length - 1]
  for (let i = 0; i < boundaries.length - 1; i++) {
    if (hr < boundaries[i + 1]) {
      const span = boundaries[i + 1] - boundaries[i]
      if (span <= 0) return ZONE_METS_ANCHORS[i + 1]
      const t = (hr - boundaries[i]) / span
      return ZONE_METS_ANCHORS[i] + t * (ZONE_METS_ANCHORS[i + 1] - ZONE_METS_ANCHORS[i])
    }
  }
  return ZONE_METS_ANCHORS[ZONE_METS_ANCHORS.length - 1]
}

/**
 * Estimate BMR (kcal/day) via Mifflin-St Jeor when no lab measurement is
 * available. Caller is responsible for checking inputs (weight/height/age)
 * are sensible before invoking — this function always returns a number.
 */
export const estimateBmrMifflinStJeor = (
  weightKg: number,
  heightCm: number,
  ageYears: number,
  sex: BiologicalSex,
): number => {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * ageYears
  return sex === 'male' ? base + 5 : base - 161
}

export interface ZoneMetsCaloriesParams {
  /** Sorted HR samples: [timestamp, bpm] */
  hr_samples: [Date, number][]
  /** BMR in kcal/day (lab measurement preferred; Mifflin-St Jeor fallback). */
  bmr_kcal_per_day: number
  /** Zone-METs context (resting HR, zone thresholds, observed max). */
  zone_context: ZoneMetsContext
}

export interface ZoneMetsCaloriePoint {
  /** Start of the minute bucket */
  time: Date
  /** End of the minute bucket (time + 60s) */
  end_time: Date
  /** Total kcal burned this minute (BMR-floored: max(BMR/min, METs * BMR/min)). */
  kcal_total: number
  /** Active kcal this minute (kcal_total - BMR/min). Zero at and below rest. */
  kcal_active: number
  /** METs value used. */
  mets: number
}

/**
 * Compute per-minute total + active calories from HR samples using the
 * zone-METs model. Returns only minutes covered by HR data (within
 * MAX_HOLD_MINUTES of a sample). Callers are responsible for filling
 * uncovered minutes with BMR/min if a full-day series is desired.
 */
export const computeCaloriesPerMinuteZoneMets = (params: ZoneMetsCaloriesParams): ZoneMetsCaloriePoint[] => {
  const { hr_samples, bmr_kcal_per_day, zone_context } = params
  if (hr_samples.length === 0) return []

  const bmrPerMin = bmr_kcal_per_day / 1440

  // Walk from the first sample's minute up to MAX_HOLD_MINUTES past the last
  // sample's minute. The maxHoldMs guard inside the loop drops minutes whose
  // most-recent sample is stale, so single-sample and multi-sample inputs
  // share the same hold-forward semantics.
  const firstTime = hr_samples[0][0].getTime()
  const lastTime = hr_samples[hr_samples.length - 1][0].getTime()

  const startMinute = Math.floor(firstTime / 60_000) * 60_000
  const endMinute = Math.floor(lastTime / 60_000) * 60_000 + (MAX_HOLD_MINUTES - 1) * 60_000

  const results: ZoneMetsCaloriePoint[] = []
  const maxHoldMs = MAX_HOLD_MINUTES * 60_000
  let sampleIdx = 0

  for (let minuteMs = startMinute; minuteMs <= endMinute; minuteMs += 60_000) {
    const bucketStart = minuteMs
    const bucketEnd = minuteMs + 60_000

    while (sampleIdx < hr_samples.length - 1 && hr_samples[sampleIdx + 1][0].getTime() <= bucketStart) {
      sampleIdx++
    }

    const hrValues: number[] = []
    const lastSampleTime = hr_samples[sampleIdx][0].getTime()
    if (lastSampleTime <= bucketStart && bucketStart - lastSampleTime < maxHoldMs) {
      hrValues.push(hr_samples[sampleIdx][1])
    }
    for (let i = sampleIdx; i < hr_samples.length; i++) {
      const t = hr_samples[i][0].getTime()
      if (t > bucketStart && t < bucketEnd) hrValues.push(hr_samples[i][1])
      if (t >= bucketEnd) break
    }
    if (hrValues.length === 0) continue

    const avgHr = hrValues.reduce((a, b) => a + b, 0) / hrValues.length
    const mets = computeMetsForHr(avgHr, zone_context)
    const totalKcal = Math.max(bmrPerMin, mets * bmrPerMin)
    const activeKcal = totalKcal - bmrPerMin

    results.push({
      end_time: new Date(bucketEnd),
      kcal_active: activeKcal,
      kcal_total: totalKcal,
      mets,
      time: new Date(bucketStart),
    })
  }

  return results
}

/**
 * Derive default HR zone thresholds from observed_hr_max using percentages
 * of HRR (Heart Rate Reserve) over resting HR. Used when the user hasn't
 * customised their zones in settings.
 *
 * Anchors: 50%, 60%, 70%, 80%, 90% of HRR above resting HR.
 */
export const defaultHrZoneThresholds = (restingHr: number, observedMax: number): HrZoneThresholds => {
  const hrr = observedMax - restingHr
  return {
    1: Math.round(restingHr + 0.5 * hrr),
    2: Math.round(restingHr + 0.6 * hrr),
    3: Math.round(restingHr + 0.7 * hrr),
    4: Math.round(restingHr + 0.8 * hrr),
    5: Math.round(restingHr + 0.9 * hrr),
  }
}
