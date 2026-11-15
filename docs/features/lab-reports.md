# Lab Reports

Lab Reports let you store structured measurements from body composition scans, blood work, hair mineral analyses, and other lab tests. Each measurement is automatically written through to Aurboda's metric time series, so lab values appear alongside your regular health data in trends, period summaries, and AI queries.

Reports can be listed, viewed and added on the web at `/reports` (also in the Android app, which embeds that page), imported from a spreadsheet (see [Import from a spreadsheet](#import-from-a-spreadsheet)), and managed through the REST API and the MCP tools.

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

## Import from a spreadsheet

Results kept in a spreadsheet (Google Sheets, Excel, Numbers) can be imported in one go. On the web,
**Reports → Import from spreadsheet** (`/reports/import`) takes three steps: paste the table copied from
the spreadsheet (or choose a `.csv`, `.tsv` or `.txt` file), choose what each column holds, then check the
preview and create the reports. The same import is `POST /reports/import` and the `import_reports` MCP
tool, which take the table as text.

### Layouts

**One row per result** (`layout: "long"`): a date column, a test-name column and a value column, with
optional unit and reference columns.

```text
Datum       Analys    Resultat  Enhet  Referens
2026-03-01  Hb        145       g/L    117-153
2026-03-01  Ferritin  40        µg/L
2026-06-15  Hb        139       g/L    117-153
```

**One row per test, one column per date** (`layout: "wide"`): a test-name column, optional unit and
reference columns, and a column per date with the date in its header. Without `date_columns`, every other
column whose header reads as a date is a date column. Empty cells are skipped.

```text
Analys    Enhet  Referens  1/3-26  15.6.2026
Hb        g/L    117-153   145     139
Ferritin  µg/L             40
```

The mapping gives column indexes counted from 0: `metric`, and for a long sheet `date` and `value`, and
optionally `unit`, `reference_low`, `reference_high` and `reference_range` (one column holding the whole
range). `has_header` (default true) says whether the first row holds names, and `date_order` (`dmy`, the
default, or `mdy`) how to read an ambiguous date. The web page guesses the columns from their names in
English or Swedish (date/datum, test/analys/komponent, value/resultat/värde, unit/enhet,
reference/referens, low/high/min/max), and starts the next import from the mapping used last, which is
kept in the user settings as `report_import_mapping`.

### Parsing rules

- **Separator**: tab (a paste from a spreadsheet), semicolon (Swedish CSV exports) or comma, detected
  from the text. Quoted fields may hold separators, quotes and line breaks. A UTF-8 BOM is ignored.
- **Dates**: `2026-03-01`, `2026/03/01`, `2026.03.01`, `1/3/2026`, `1.3.2026`, `1/3 2026`, `1/3-26`,
  `01-03-2026`; a two-digit year is 20xx. When one part is over 12 it is the day, otherwise
  `date_order` decides. Month names are not read.
- **Numbers**: decimal comma or point; spaces as thousands separators; `1.234,5` and `1,234.5` both read
  as 1234.5. A value with a comparison sign (`<0,2`) or text is an error on that row, not imported.
- **Reference range**: `3,5-5,0` gives low and high, `< 5` the high bound, `> 1,0` the low bound;
  anything else is ignored. Separate low and high columns win over the range column.
- **Units**: without a unit column, a result is taken to be in the unit its metric is stored in; a test
  that is not in the catalogue and has no unit is an error.
- Rows without a test name are skipped; the header row repeated further down is an error.

### What gets created

Results are grouped by date, one report per date with the given report type, location and notes, each
result resolved and converted exactly as in `POST /reports`. Reports are dated at midnight of that day in
your time zone.

- A result is **already imported** (`exists`, skipped) when you have a report on that date, of any type,
  with the same metric (after catalogue resolution, so `Hb` matches `hemoglobin`). Importing the same sheet
  twice changes nothing, and importing it again after adding a column of results adds just those.
- New results for a date that already has a report of the same type are added to that report;
  otherwise a new report is created.
- A date whose report would be refused (a unit the metric does not accept, the same catalogue metric
  twice) is an error on all its rows; the other dates still import. Rows with errors never stop the rest.
- `dry_run: true` returns the preview and writes nothing. The response lists each result with its status
  (`new`, `exists`, `error`, `skipped`), errors first, and a summary (`reports_new`, `reports_updated`,
  `entries_new`, `entries_existing`, `errors`); a real run also returns the ids of the reports it created
  or added to.

### Limits

At most 500 000 characters and 5000 rows per import; a larger table is refused with a 400, as is a table
that cannot be read at all (no rows, or a wide sheet without a date header). The response lists at most
2000 rows (`rows_truncated` says when it was cut), while the summary counts them all. Excel `.xlsx` files
and Google Sheets links are not read: copy the cells, or export a CSV.

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
| `import_reports`    | Import results from a spreadsheet table given as text (see above).                  |
| `get_latest_metric` | Get the most recent value for any metric (useful for "what was my last ferritin?"). |

### REST API

| Method   | Path              | Description                                |
| -------- | ----------------- | ------------------------------------------ |
| `POST`   | `/reports`        | Create a report with entries               |
| `GET`    | `/reports`        | Query reports (filter by type, date range) |
| `GET`    | `/reports/:id`    | Get a single report                        |
| `PATCH`  | `/reports/:id`    | Update metadata and/or replace entries     |
| `DELETE` | `/reports/:id`    | Delete a report and metric data            |
| `POST`   | `/reports/import` | Import results from a spreadsheet table    |

## Known Limitations

- **Metric names outside the catalogue are free-form** -- a name that is neither a built-in metric, one of your custom metrics nor in the [metric catalogue](metric-catalog.md) is written as given, without a label or a unit check, unless you also create a custom metric definition. The unit of an entry for a built-in or custom metric the catalogue does not know is not checked either.
- **No reference range tracking over time** -- reference ranges are stored per-entry but there's no visualization of how your values trend relative to their ranges.
