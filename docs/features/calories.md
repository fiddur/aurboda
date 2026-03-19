# Active Calorie Computation

Active calories represent energy expenditure above resting metabolic rate. Aurboda computes per-minute active calories from heart rate data using a published formula, and supplements gaps in HR coverage with data from Health Connect's daily aggregate.

## Data Sources

| Source                   | DB `source` value          | Granularity     | Used in queries?      | Description                                                                                                 |
| ------------------------ | -------------------------- | --------------- | --------------------- | ----------------------------------------------------------------------------------------------------------- |
| HR-based computation     | `aurboda`                  | Per-minute      | Yes                   | Computed from heart rate data using the Omnicalculator HR-to-calories formula                               |
| Gap-fill                 | `aurboda_gap_fill`         | Per-minute      | Yes                   | Residual from HC aggregate distributed across minutes without HR coverage                                   |
| Health Connect records   | `health_connect`           | Arbitrary spans | No (filtered out)     | Raw `ActiveCaloriesBurnedRecord` from phone apps; stored but excluded from queries to avoid double-counting |
| Health Connect aggregate | `health_connect_aggregate` | Daily           | No (used by gap-fill) | Deduplicated daily total from the phone's Health Connect layer                                              |
| Garmin daily summary     | `garmin`                   | Daily           | No (filtered out)     | Single daily value from Garmin; stored but excluded from queries                                            |

### Source Filtering

Queries for `calories_active` only return data from `aurboda` and `aurboda_gap_fill` sources. This is controlled by the `aurbodaOnlyMetrics` / `aurbodaOnlySources` constants in `packages/api-spec/src/schemas/common.ts`. The filtering prevents double-counting since raw Health Connect records, Garmin data, and the HC aggregate would overlap with aurboda's computed values.

## HR-Based Computation

### Formula

Uses the [Omnicalculator HR-to-calories formula](https://www.omnicalculator.com/sports/calories-burned-by-heart-rate):

- **Men:** `CB = T * (0.634*H + 0.404*V + 0.394*W + 0.271*A - 95.7735) / 4.184`
- **Women:** `CB = T * (0.45*H + 0.380*V + 0.103*W + 0.274*A - 59.3954) / 4.184`

Where: H = heart rate (bpm), V = VO2 max (mL/kg/min), W = weight (kg), A = age (years), T = 1 minute.

### Required Inputs

Gathered from user settings and recent time-series data:

| Input      | Source                                              | Lookback       |
| ---------- | --------------------------------------------------- | -------------- |
| Sex        | User settings (`sex`)                               | N/A (required) |
| Birth date | User settings (`birth_date`)                        | N/A (required) |
| Weight     | `weight` metric                                     | 90 days        |
| VO2 max    | `vo2_max` metric, or population fallback by sex/age | 730 days       |
| Resting HR | `resting_heart_rate` metric, defaults to 60 bpm     | 90 days        |

If sex, birth date, or weight are missing, computation is skipped entirely.

### Baseline Subtraction

The formula computes **total** caloric burn including BMR. To isolate active-only calories:

1. A baseline HR is computed as `resting_hr * 1.2` (the `BASELINE_HR_MULTIPLIER`)
2. The formula is evaluated at this baseline HR to get `baselineKcal` per minute
3. For each minute: `active_kcal = max(0, total_formula_output - baselineKcal)`

This naturally produces 0 active calories when HR is at or below the baseline (sleep, rest). The 1.2x multiplier was empirically validated: during actual sleep stages, HR stays at or below `resting_hr * 1.2`.

### Hold-Last-Value Interpolation

For sparse HR data (e.g., Oura's 5-minute intervals), the last HR reading is held forward for up to `MAX_HOLD_MINUTES = 5` minutes. Beyond that gap, minutes are skipped entirely (no stale data).

### Computation Triggers

Calorie computation is triggered automatically when HR data is ingested:

- **Health Connect sync** (`POST /sync/health-connect/HeartRateRecord`) -- triggered in `sync-router.ts`
- **Oura sync** (sleep and session data types contain HR samples) -- triggered in `oura-sync.ts`
- **Manual recompute** (`recalculate_calories` MCP tool or API) -- force-recomputes from all HR data

### Incremental vs Force Computation

- **Incremental** (default): Checks for existing `aurboda` calorie points in the time range and skips already-computed minutes. Only computes new minutes from fresh HR data.
- **Force** (`recalculate_calories`): Deletes all existing `aurboda` and `aurboda_gap_fill` calorie points, then recomputes from scratch. Processes in daily chunks to avoid memory issues.

## Gap-Fill

### Motivation

HR-based computation only covers minutes where heart rate data exists. Some periods may have no HR coverage (wrist off, no HR monitor worn, phone-only activity tracking). The Health Connect daily aggregate captures activity from all phone apps (step-based calorie estimates, etc.) and provides a deduplicated daily total.

Gap-fill distributes the "residual" -- calories captured by the phone but not by HR computation -- across minutes without HR coverage.

### Algorithm

For each calendar day:

1. Read the HC daily aggregate for `calories_active` (source `health_connect_aggregate`)
2. Read existing HR-computed calorie points (source `aurboda`) for the day
3. Compute: `residual = hc_aggregate - sum(aurboda_points)`
4. If `residual > 0`: distribute it evenly across gap minutes (minutes with no `aurboda` point)
5. Store gap-fill points with source `aurboda_gap_fill`

If the HR-based sum already exceeds the HC aggregate, no gap-fill is produced. This means the daily total naturally reflects `max(hc_aggregate, hr_based_sum)`.

### Day Boundaries and Timezone

The Android app aggregates daily calories using the device's local timezone. The backend stores the aggregate with the timezone from the payload, converting the local date to the correct UTC timestamp.

Gap-fill uses the timezone from user settings (updated from the latest aggregate) to determine day boundaries, ensuring alignment between the aggregate's coverage window and the gap-fill distribution.

### Idempotent Re-runs

Gap-fill deletes existing `aurboda_gap_fill` points for the day before recomputing. This makes re-runs safe and prevents stale gap-fill from accumulating.

### HR Computation Cleans Up Gap-Fill

When new HR data arrives and calories are computed for previously gap-filled minutes, the stale gap-fill points for those minutes are deleted before the HR-computed values are inserted. This ensures HR-derived values always take precedence over gap-fill estimates.

## Outbound Sync

Only HR-computed calories (source `aurboda`) are synced back to Health Connect as `ActiveCaloriesBurnedRecord`. Gap-fill points are NOT synced back since they originate from the phone's aggregate data and writing them back would cause double-counting.

## Daily Totals and Goals

Goals for `calories_active` use `getDailyAggregateValue()` which reads from `cumulativeSources` (`health_connect_aggregate` or `aurboda`). This typically returns the HC aggregate value.

The timeline's 1-day bucket view sums all `aurboda` + `aurboda_gap_fill` per-minute points, which after gap-fill should equal `max(hc_aggregate, hr_based_sum)`.

## Known Limitations

- **Goals vs timeline inconsistency**: Goals may show the HC aggregate value while the timeline shows the (potentially higher) HR-based sum. In practice, the HC aggregate is rarely lower than the HR computation since it includes contributions from all phone apps.
- **Per-source calorie trust**: Currently, aurboda always recalculates from HR data regardless of whether the originating device (e.g., Withings Scanwatch 2) already computed accurate per-minute calories. A future setting could allow trusting a specific source's calorie values directly.

## Key Files

| File                                               | Purpose                                                      |
| -------------------------------------------------- | ------------------------------------------------------------ |
| `apps/backend/src/services/calories.ts`            | Core formulas, gap-fill algorithm, constants                 |
| `apps/backend/src/services/calorie-computation.ts` | Orchestration: gather inputs, compute, store, sync, gap-fill |
| `apps/backend/src/db/time-series.ts`               | DB read/write, source filtering                              |
| `apps/backend/src/db/cumulative-query.ts`          | Split queries by cumulative/aurbodaOnly/nonCumulative        |
| `packages/api-spec/src/schemas/common.ts`          | Metric types, source constants, aurbodaOnlyMetrics           |
