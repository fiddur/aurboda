export const activityFeaturesTables: Record<string, string> = {
  // Features computed from an activity's HR, speed and track (services/run-features.ts),
  // one row per activity. The route is not stored here: it lives in activity_routes.
  activity_features: `
    CREATE TABLE IF NOT EXISTS activity_features (
      activity_id             UUID PRIMARY KEY REFERENCES activities(id) ON DELETE CASCADE,
      elapsed_s               REAL,
      moving_s                REAL,
      zone0_fraction          REAL,
      zone1_fraction          REAL,
      zone2_fraction          REAL,
      zone3_fraction          REAL,
      zone4_fraction          REAL,
      zone5_fraction          REAL,
      low_hr_fraction         REAL,
      low_hr_ceiling_bpm      INTEGER,
      hr_drift_pct            REAL,
      pace_cv                 REAL,
      interval_count          INTEGER,
      work_block_median_s     REAL,
      rest_block_median_s     REAL,
      work_block_cv           REAL,
      work_rest_pace_ratio    REAL,
      elevation_gain_m        REAL,
      elevation_oscillation   REAL,
      duration_vs_median_90d  REAL,
      computed_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
}
