/**
 * Lab + report table SQL. The legacy `lab_results` flat table is kept for
 * historical data; new entries land in `reports` + `report_entries`.
 */
export const reportsTables: Record<string, string> = {
  // Lab results / blood work (legacy flat table — superseded by reports + report_entries)
  lab_results: `
    CREATE TABLE IF NOT EXISTS lab_results (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      test_date       DATE NOT NULL,
      test_name       VARCHAR(100) NOT NULL,
      test_category   VARCHAR(50),
      value           DOUBLE PRECISION NOT NULL,
      unit            VARCHAR(30) NOT NULL,
      reference_low   DOUBLE PRECISION,
      reference_high  DOUBLE PRECISION,
      flag            VARCHAR(10),
      lab_name        VARCHAR(100),
      notes           TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,

  lab_results_indexes: `
    CREATE INDEX IF NOT EXISTS idx_lab_results_date ON lab_results (test_date DESC);
    CREATE INDEX IF NOT EXISTS idx_lab_results_test ON lab_results (test_name, test_date DESC);
    CREATE INDEX IF NOT EXISTS idx_lab_results_category ON lab_results (test_category, test_date DESC)
  `,

  report_entries: `
    CREATE TABLE IF NOT EXISTS report_entries (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      report_id       UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
      metric          VARCHAR(100) NOT NULL,
      value           DOUBLE PRECISION,
      unit            VARCHAR(30),
      method          VARCHAR(50),
      confidence      VARCHAR(20),
      reference_low   DOUBLE PRECISION,
      reference_high  DOUBLE PRECISION,
      flag            VARCHAR(20)
    )
  `,
  report_entries_indexes: `
    CREATE INDEX IF NOT EXISTS idx_report_entries_report ON report_entries (report_id);
    CREATE INDEX IF NOT EXISTS idx_report_entries_metric ON report_entries (metric)
  `,

  // Structured lab reports (InBody, blood panels, hair mineral analysis, etc.)
  reports: `
    CREATE TABLE IF NOT EXISTS reports (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      report_type     VARCHAR(100) NOT NULL,
      report_date     TIMESTAMPTZ NOT NULL,
      location        VARCHAR(255),
      notes           TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  reports_indexes: `
    CREATE INDEX IF NOT EXISTS idx_reports_date ON reports (report_date DESC);
    CREATE INDEX IF NOT EXISTS idx_reports_type ON reports (report_type, report_date DESC)
  `,
}
