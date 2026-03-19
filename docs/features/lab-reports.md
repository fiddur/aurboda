# Lab Reports

Lab Reports let you store structured measurements from body composition scans, blood work, hair mineral analyses, and other lab tests. Each measurement is automatically written through to Aurboda's metric time series, so lab values appear alongside your regular health data in trends, period summaries, and AI queries.

This feature is currently **API and MCP only** -- there is no web UI for viewing or entering lab reports. (See issue #380 for planned web UI.)

## What a Report Contains

Each report has:

- A **report type** -- a free-form label like "inbody", "blood_panel", "hair_mineral_analysis", "dexa", "lipid_panel", or any string you choose.
- A **date** -- when the lab visit or scan occurred.
- An optional **location** -- where the test was done (e.g., "Genki gym", "Trace Elements Lab").
- Optional **notes** -- context like "Fasted 12h" or "No exercise before scan".
- One or more **entries** -- individual measurements.

### Report Entries

Each entry in a report stores:

| Field                  | Description                                     | Example                                                  |
| ---------------------- | ----------------------------------------------- | -------------------------------------------------------- |
| **Metric**             | What was measured (free-form name)              | `body_fat`, `ferritin`, `calcium`                        |
| **Value**              | The numeric result                              | `18.5`, `45.0`, `97.2`                                   |
| **Unit**               | Measurement unit                                | `%`, `ng/mL`, `mg%`                                      |
| **Method**             | How it was measured (optional)                  | `bia_segmental`, `blood_draw`, `hair_analysis`           |
| **Confidence**         | Measurement reliability (optional)              | `measured`, `estimated`, `derived`                       |
| **Reference low/high** | Normal range (optional)                         | `30.0` - `400.0` for ferritin                            |
| **Flag**               | Out-of-range indicator (optional, auto-derived) | `normal`, `low`, `high`, `critical_low`, `critical_high` |

### Automatic Flag Derivation

If you provide reference ranges but no flag, the system determines it automatically:

- **Normal**: Value within the reference range.
- **Low** / **High**: Value outside the range.
- **Critical low** / **Critical high**: Value more than 50% beyond the range boundary.

You can also set flags explicitly to override the auto-derivation.

## Write-Through to Time Series

This is the key architectural feature. When you create a report, every entry is also written to Aurboda's `time_series` with source `lab_report`. This means:

- A body fat measurement from an InBody scan shows up in the same weight/body fat trend charts as data from your scale or Health Connect.
- A ferritin value from blood work is queryable alongside all your other metrics.
- The `get_latest_metric` tool can find your most recent lab value even if the blood panel is months old.

When a report is deleted, the corresponding time-series entries are cleanly removed without affecting data from other sources.

## Common Report Types

| Type                      | Typical Metrics                                        | Typical Method |
| ------------------------- | ------------------------------------------------------ | -------------- |
| **InBody scan**           | weight, body_fat, bmi, skeletal_muscle_mass, ecw_ratio | bia_segmental  |
| **Blood panel**           | ferritin, iron, b12, vitamin_d, testosterone, cortisol | blood_draw     |
| **Hair mineral analysis** | calcium, magnesium, sodium, potassium, zinc, copper    | hair_analysis  |
| **DEXA scan**             | body_fat, bone_density, lean_body_mass                 | dexa           |
| **Lipid panel**           | total_cholesterol, ldl, hdl, triglycerides             | blood_draw     |

Report types are completely free-form -- use any label that makes sense for your tests.

## API and MCP Access

### MCP Tools

| Tool                | Description                                                                         |
| ------------------- | ----------------------------------------------------------------------------------- |
| `add_report`        | Create a report with entries. All entries are written through to metrics.           |
| `get_report`        | Fetch a single report with all entries.                                             |
| `query_reports`     | List reports, optionally filtered by type and date range.                           |
| `delete_report`     | Delete a report and its write-through metric data.                                  |
| `get_latest_metric` | Get the most recent value for any metric (useful for "what was my last ferritin?"). |

### REST API

| Method   | Path           | Description                                |
| -------- | -------------- | ------------------------------------------ |
| `POST`   | `/reports`     | Create a report with entries               |
| `GET`    | `/reports`     | Query reports (filter by type, date range) |
| `GET`    | `/reports/:id` | Get a single report                        |
| `DELETE` | `/reports/:id` | Delete a report and metric data            |

## Known Limitations

- **No web UI** -- reports can only be created and viewed via the API or MCP tools. An AI assistant (via MCP) is currently the most practical way to enter lab data.
- **Reports are immutable** -- there is no update/patch endpoint. To correct an error, delete and recreate the report.
- **Metric names are free-form** -- there is no validation that a metric name in a report entry matches the system's known metrics. Custom metric names work fine but won't have labels or units configured unless you also create a custom metric definition.
- **No reference range tracking over time** -- reference ranges are stored per-entry but there's no visualization of how your values trend relative to their ranges.
