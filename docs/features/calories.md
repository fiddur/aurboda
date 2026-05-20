# Calorie Computation

Aurboda computes per-minute total and active calorie burn from heart-rate data using a zone-METs model anchored on the user's calibrated HR zones and lab-measured (or formula-estimated) BMR. Both `calories_total` and `calories_active` are written per-minute with source `aurboda`, and aurboda is the authoritative source for these metrics — Health Connect / Garmin daily aggregates are excluded from queries to avoid double-counting against the per-minute series.

## Zone-METs Model

For each minute of HR data:

1. Look up METs at the average HR by linear interpolation between anchors placed at the user's HR zone boundaries:

   | Boundary HR (bpm)   | METs |
   | ------------------- | ---- |
   | ≤ `resting_hr`      | 1.0  |
   | `hr_zone_start[1]`  | 2.0  |
   | `hr_zone_start[2]`  | 4.0  |
   | `hr_zone_start[3]`  | 6.0  |
   | `hr_zone_start[4]`  | 8.5  |
   | `hr_zone_start[5]`  | 11.0 |
   | ≥ `observed_hr_max` | 13.0 |

2. Convert METs to kcal/min by scaling against BMR/min: `kcal_total = max(BMR/min, METs × BMR/min)`. The `max` clamps very low HR readings to the BMR floor — at and below `resting_hr`, the user still burns BMR.

3. `kcal_active = kcal_total − BMR/min`. Zero at rest, ramps with intensity.

### Why not Keytel?

Earlier versions used the [Omnicalculator/Keytel HR formula](https://www.omnicalculator.com/sports/calories-burned-by-heart-rate). That formula was empirically calibrated against steady-state exercise data (HR > ~60 % HRmax) and systematically overshoots at resting and light-activity HR — its implicit BMR is higher than reality for most users. Replaying 14 days of intake against a stable-weight user, Keytel + lab BMR + a `resting_hr × 1.2` baseline landed +21 % over intake; replacing that baseline with `BMR/min` (the "physiologically clean" variant) made it +92 %; the zone-METs model landed within +10 %. Zone-METs is anchored on the user's actual physiology rather than a population-fitted exercise formula, so it generalises better to all-day wear.

## BMR Resolution

Priority order:

1. **Lab measurement** — most recent `basal_metabolic_rate` metric within 2 years (e.g. from an InBody scan).
2. **Mifflin-St Jeor estimate** — `10·weight + 6.25·height − 5·age + 5` (males) / `− 161` (females). Requires the `height` metric (looked back up to 10 years).

If neither is available, computation is skipped with `skipped_reason: 'no BMR and no height for fallback'`. The response includes `bmr_source: 'lab' | 'mifflin_st_jeor'` so callers can distinguish.

## Other Required Inputs

| Input               | Source                                                                  | Lookback             |
| ------------------- | ----------------------------------------------------------------------- | -------------------- |
| Sex                 | `sex` user setting                                                      | required             |
| Birth date          | `birth_date` user setting                                               | required (for age)   |
| Weight              | `weight` metric                                                         | 90 days              |
| Height              | `height` metric (for BMR fallback only)                                 | 10 years             |
| Resting HR          | `resting_heart_rate` metric (else 60 bpm)                               | 90 days              |
| HR zone boundaries  | `hr_zone_start` setting (else age-based, then HRR-derived fallback)     | live                 |
| Observed HR max     | `settings.training_load.observed_hr_max` (else `220 − age`)             | live                 |

If the resolved zone-1 start lands at or below the resting HR (user has not set zones and the age-based default is too low for them), zones are re-derived from HRR percentages (50/60/70/80/90 % of `observed_hr_max − resting_hr` above resting).

## Hold-Last-Value Interpolation

For sparse HR data (e.g. Oura's 5-minute intervals), the last HR reading is held forward up to `MAX_HOLD_MINUTES = 5`. Beyond that gap, minutes get no per-minute HR data (and fall back to the BMR floor).

## Full-Day BMR Floor

Because aurboda is the only source counted for `calories_total`, the computation must produce a per-minute row for every minute of every affected day — otherwise daily sums would be missing BMR for the hours without HR coverage.

`computeAndStoreCalories(user, start, end)` therefore expands `[start, end]` to local-day boundaries before any work, fetches HR for the expanded range, computes zone-METs minutes from HR, then walks every minute in the range:

- HR-covered minutes get METs-scaled `calories_total` + `calories_active`.
- Minutes without HR coverage get `calories_total = BMR/min` and no `calories_active` row.

DST is handled via `getLocalDayStart` (re-anchored each chunk iteration to local midnight, not by a constant 24 h step).

## Storage

Both metrics are stored in `time_series` with `source = 'aurboda'`. The `cumulativeSources` filter in `packages/api-spec/src/schemas/common.ts` listed `calories_active` and now also `calories_total` in `aurbodaOnlyMetrics` — so all bucketed/stats/daily-aggregate queries for these metrics use only aurboda's per-minute data. Any rows from `source = 'garmin'` (written by `apps/backend/src/integrations/garmin/process.ts` from the Garmin Connect daily summary) or `source = 'health_connect_aggregate'` (written from the phone's HC aggregate) are stored but filtered out at query time. See [docs/garmin.md](../garmin.md) for the Garmin-direct caveat.

## Triggers

Calorie computation runs in three places:

| Trigger                                                      | Range passed by caller     | Effective range after day-expansion |
| ------------------------------------------------------------ | -------------------------- | ----------------------------------- |
| Health Connect HR sync (`POST /sync/health-connect/...`)     | HR-batch window (≈ minutes) | The whole local day(s) it overlaps |
| Oura sync (sleep / session HR samples)                       | Sample range               | Whole local day(s)                  |
| Manual recompute (`recalculate_calories` MCP tool or REST)   | User-provided, or full     | Whole local day(s)                  |

Each call is authoritative for the day(s) it touches: it deletes any prior aurboda rows in the expanded range and re-writes from scratch. There is no incremental "skip already-computed minutes" optimisation any more — the operation is fast enough at one day at a time and avoids the partial-day inconsistency the prior incremental path could create.

## Outbound Sync to Health Connect

Per-minute `calories_active` rows (HR-derived only — minutes that fell back to the BMR floor have no active row) are queued for outbound sync to Health Connect as `ActiveCaloriesBurnedRecord`, so other phone apps see the same active-calorie estimate Aurboda uses. `calories_total` is not synced back — Health Connect derives its own total from `Active + Basal`.

## Migration

After deploy, run a full recompute via the MCP tool `recalculate_calories` (or `POST /api/metrics/recalculate-calories` with empty body). It walks every day with HR data, deletes prior `aurboda` / `aurboda_gap_fill` rows for both metrics, and writes the new per-minute series. Older days without HR data are left untouched.

## Key Files

| File                                                  | Purpose                                                       |
| ----------------------------------------------------- | ------------------------------------------------------------- |
| `apps/backend/src/services/calories.ts`               | Zone-METs formula, BMR estimator, MAX_HOLD_MINUTES, types     |
| `apps/backend/src/services/calorie-computation.ts`    | Orchestration: BMR/zones resolution, day-aligned recompute    |
| `apps/backend/src/db/time-series.ts`                  | DB read/write, source filtering for aurbodaOnly metrics       |
| `apps/backend/src/db/cumulative-query.ts`             | Routes cumulative metrics to the aurbodaOnly source filter    |
| `packages/api-spec/src/schemas/common.ts`             | `aurbodaOnlyMetrics`, `aurbodaOnlySources`, `cumulativeMetrics` |
