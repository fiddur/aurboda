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

| Field                  | Description                                      | Example                                                  |
| ---------------------- | ------------------------------------------------ | -------------------------------------------------------- |
| **Metric**             | What was measured (a name, or a catalogue alias) | `body_fat`, `ferritin`, `LDL`                            |
| **Value**              | The numeric result, as printed                   | `18.5`, `45.0`, `97.2`                                   |
| **Unit**               | Measurement unit, as printed                     | `%`, `ng/mL`, `mg/dL`                                    |
| **Method**             | How it was measured (optional)                   | `bia_segmental`, `blood_draw`, `hair_analysis`           |
| **Confidence**         | Measurement reliability (optional)               | `measured`, `estimated`, `derived`                       |
| **Reference low/high** | Normal range (optional)                          | `30.0` - `400.0` for ferritin                            |
| **Flag**               | Out-of-range indicator (optional, auto-derived)  | `normal`, `low`, `high`, `critical_low`, `critical_high` |

### Automatic Flag Derivation

If you provide reference ranges but no flag, the system determines it automatically:

- **Normal**: Value within the reference range.
- **Low** / **High**: Value outside the range.
- **Critical low** / **Critical high**: Value more than 50% beyond the range boundary.

You can also set flags explicitly to override the auto-derivation.

### Catalogue metrics and unit conversion

An entry whose metric is a name, display name or alias from the built-in
[metric catalogue](metric-catalog.md) resolves to the catalogue metric: `LDL` is stored as
`ldl_cholesterol`, which is added to your custom metrics the first time it is used. The entry's
value is converted to the unit the metric is stored in (your own metric's unit when you already have
one of that name), and the entry keeps the value and unit as printed. When they differ, the entry
also carries:

| Field            | Description                               | Example  |
| ---------------- | ----------------------------------------- | -------- |
| **stored_value** | The value as written to the metric series | `2.586`  |
| **stored_unit**  | The unit the value is stored in           | `mmol/L` |

Reference ranges and the flag stay in the printed unit. An entry with a unit the catalogue metric
does not accept, or two entries of the same catalogue metric, refuse the whole report with a 400
and nothing is written. Entries of metrics the catalogue does not know are written as given.

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
| **Hair mineral analysis** | hair_calcium, hair_magnesium, hair_zinc, hair_copper   | hair_analysis  |
| **DEXA scan**             | body_fat, bone_density, lean_body_mass                 | dexa           |
| **Lipid panel**           | total_cholesterol, ldl, hdl, triglycerides             | blood_draw     |

Report types are completely free-form -- use any label that makes sense for your tests.

The catalogue's mineral metrics (`calcium`, `magnesium`, `zinc`, ...) are blood values. A hair or urine value in
another unit (`mg%`) is refused under those names: give it a name of its own, such as `hair_calcium`.

## API and MCP Access

### MCP Tools

| Tool                | Description                                                                         |
| ------------------- | ----------------------------------------------------------------------------------- |
| `add_report`        | Create a report with entries. All entries are written through to metrics.           |
| `get_report`        | Fetch a single report with all entries.                                             |
| `query_reports`     | List reports, optionally filtered by type and date range.                           |
| `update_report`     | Change a report's metadata and/or replace all its entries.                          |
| `delete_report`     | Delete a report and its write-through metric data.                                  |
| `get_latest_metric` | Get the most recent value for any metric (useful for "what was my last ferritin?"). |

### REST API

| Method   | Path           | Description                                |
| -------- | -------------- | ------------------------------------------ |
| `POST`   | `/reports`     | Create a report with entries               |
| `GET`    | `/reports`     | Query reports (filter by type, date range) |
| `GET`    | `/reports/:id` | Get a single report                        |
| `PATCH`  | `/reports/:id` | Update metadata and/or replace entries     |
| `DELETE` | `/reports/:id` | Delete a report and metric data            |

## Known Limitations

- **No web UI** -- reports can only be created and viewed via the API or MCP tools. An AI assistant (via MCP) is currently the most practical way to enter lab data.
- **Metric names outside the catalogue are free-form** -- a name that is neither a built-in metric, one of your custom metrics nor in the [metric catalogue](metric-catalog.md) is written as given, without a label or a unit check, unless you also create a custom metric definition. The unit of an entry for a built-in or custom metric the catalogue does not know is not checked either.
- **No reference range tracking over time** -- reference ranges are stored per-entry but there's no visualization of how your values trend relative to their ranges.
