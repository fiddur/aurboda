/**
 * Time-series and metric-domain table SQL: normalized time series, custom
 * metric definitions, and the raw_records sink.
 */
export const metricsTables: Record<string, string> = {
  // Normalized time-series metrics for fast charting queries
  time_series: `
    CREATE TABLE IF NOT EXISTS time_series (
      time            TIMESTAMPTZ NOT NULL,
      metric          VARCHAR(50) NOT NULL,
      value           DOUBLE PRECISION NOT NULL,
      unit            VARCHAR(20) NOT NULL,
      source          VARCHAR(50) NOT NULL,
      deleted_at      TIMESTAMPTZ,
      PRIMARY KEY (time, metric, source)
    )
  `,
  time_series_indexes: `
    CREATE INDEX IF NOT EXISTS idx_time_series_metric_time ON time_series (metric, time DESC);
    CREATE INDEX IF NOT EXISTS idx_time_series_metric_source_time ON time_series (metric, source, time DESC)
  `,

  // User-defined custom metric types (extracted from user_settings JSONB)
  custom_metrics: `
    CREATE TABLE IF NOT EXISTS custom_metrics (
      id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name                     VARCHAR(100) NOT NULL UNIQUE,
      unit                     VARCHAR(30) NOT NULL,
      description              TEXT,
      min_value                DOUBLE PRECISION,
      max_value                DOUBLE PRECISION,
      include_in_daily_summary BOOLEAN NOT NULL DEFAULT FALSE,
      created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  custom_metrics_indexes: `
    CREATE INDEX IF NOT EXISTS idx_custom_metrics_name ON custom_metrics (name)
  `,

  // Raw data sink - stores all incoming data in original form
  raw_records: `
    CREATE TABLE IF NOT EXISTS raw_records (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      source          VARCHAR(50) NOT NULL,
      record_type     VARCHAR(100) NOT NULL,
      external_id     VARCHAR(255),
      recorded_at     TIMESTAMPTZ NOT NULL,
      received_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      data            JSONB NOT NULL,
      CONSTRAINT unique_source_record UNIQUE (source, record_type, external_id)
    )
  `,
  raw_records_indexes: `
    CREATE INDEX IF NOT EXISTS idx_raw_records_source_time ON raw_records (source, recorded_at);
    CREATE INDEX IF NOT EXISTS idx_raw_records_type_time ON raw_records (record_type, recorded_at);
    CREATE INDEX IF NOT EXISTS idx_raw_records_data ON raw_records USING GIN (data)
  `,
}
