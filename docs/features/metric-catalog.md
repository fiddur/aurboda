# Metric catalogue

Aurboda ships a built-in, versioned catalogue of metrics for the values you get from a lab or a tape
measure rather than from a watch: lab values (lipids, glucose, blood count, vitamins, hormones, liver
and kidney markers, inflammation), circumferences and body composition. Each entry has a name, a
display name, aliases, the one unit it is stored in and the other units it accepts, each with its
conversion to the stored unit. The catalogue is data in the repository
(`apps/backend/src/catalog/metrics/`), the same on every server, and read only.

A catalogue metric is not one of your metrics until you use it. The first time you do, it is added
to your custom metrics with its name, its stored unit and its display name as the
description, and from then on it is an ordinary custom metric: you can edit, merge or delete it like
one you made yourself. The link between your metric and the catalogue is the metric's **name**.

## The groups

| Group               | Examples                                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------- |
| `lipids`            | total, LDL, HDL and non-HDL cholesterol, triglycerides, ApoB, ApoA1, Lp(a)                   |
| `glucose`           | HbA1c, fasting glucose, fasting insulin, C-peptide                                           |
| `blood_count`       | ferritin, iron, transferrin, hemoglobin, hematocrit, red and white cells, platelets, MCV     |
| `vitamins_minerals` | vitamin D, B12, folate, homocysteine, magnesium, calcium, zinc, sodium, potassium, omega-3   |
| `thyroid`           | TSH, free T4, free T3, TPO antibodies                                                        |
| `hormones`          | testosterone, SHBG, estradiol, progesterone, LH, FSH, prolactin, cortisol, DHEA-S, IGF-1     |
| `organ_function`    | ALT, AST, GGT, ALP, creatine kinase, bilirubin, albumin, creatinine, eGFR, urea, BUN         |
| `inflammation`      | CRP, ESR                                                                                     |
| `body_measurements` | waist, hip, neck, chest, upper arm, thigh and calf circumference (left and right where kept) |
| `body_composition`  | skeletal muscle mass, visceral fat, BMI, ECW ratio, phase angle, bone mineral density        |

`GET /metric-catalog` (`list_metric_catalog`) lists every entry. Names are snake_case
(`ldl_cholesterol`); aliases are the other names a lab prints (`LDL`, `LDL-C`). A name, display
name or alias is matched ignoring case and punctuation. No catalogue name or alias is the name of a
built-in metric such as `weight` or `body_fat`.

## Adoption on first use

A catalogue metric becomes one of your custom metrics the first time it is written, through any of
these:

- **Adding a value** with `POST /metrics` (`add_metric`) or `POST /metrics/bulk`
  (`add_metrics_bulk`), with its name, display name or an alias as `metric`.
- **A lab report entry** (`POST /reports`, `PATCH /reports/:id`, `add_report`, `update_report`)
  whose `metric` is its name, display name or an alias.
- **The Add data form** in the web app, where the metric picker lists the catalogue metrics not in
  use yet under "More built-in metrics".

The value is stored under the catalogue name: `ldl` is written as `ldl_cholesterol`. A write that is
refused (see below) adds nothing.

**Your own metric wins.** If you already have a custom metric with the catalogue name, it is used as
it is, in its own unit, and nothing about it changes. A custom metric of yours named like an alias
(`ldl`) is yours too: a write to `ldl` goes to it, not to the catalogue. MCP `add_custom_metric`
refuses to create such an alias-named metric with a pointer to the built-in one, unless given
`separate_metric: true`.

## Units and conversion

Each entry is stored in one unit (`unit`) and lists the other units it accepts (`units`), each with
a `factor` and, for HbA1c only, an `offset`:

```
stored = (value + offset) * factor
value  = stored / factor - offset
```

A write may say which unit its value is in (`unit` on `add_metric`, each bulk item, and every report
entry). When the unit is one the metric accepts, the value is converted to the unit the metric is
stored in, or to the unit of your own metric of that name when it is another accepted unit, and
rounded to 6 significant digits. Left out, the value is taken to be in the metric's unit.

- LDL cholesterol 100 mg/dL is stored as 2.586 mmol/L (factor 0.02586).
- HbA1c 6.5 % is stored as 47.5 mmol/mol (the IFCC/NGSP master equation: factor 10.929, offset −2.15).
- A waist of 34 in is stored as 86.36 cm.

Units are compared after a few spelling rules: case and spaces do not matter, `µ` (micro sign),
`μ` (Greek mu), `mcg` and a `u` before `g`, `mol`, `IU`, `kat` or `L` are the same (`ug/L`,
`umol/L`), `percent` is `%`, and `celsius` is `°C`. `U/L` stays units per litre. Other spellings of
the stored unit are listed per entry (`mU/L` for `mIU/L`, `x10^9/L` for `10^9/L`).

## What is refused

- A unit a catalogue metric does not accept:
  `Unit "mmol/L" is not accepted for "ferritin", which is stored in µg/L. Accepted units: µg/L, ng/mL.`
- On `add_metric` and the bulk add, a unit that differs from the unit of a built-in or custom metric
  the catalogue does not know: `Unit "lb" does not match "weight", which is stored in kg.`
- In a lab report, two entries of the same catalogue metric (`"ldl" and "ldl_cholesterol" are the
same metric`).

A refused report entry refuses the whole report, before anything is written. A report entry of a
metric the catalogue does not know is written as it always was, whatever its unit.

## Lab reports keep what was printed

A [lab report](lab-reports.md) entry keeps the value and unit as the lab printed them. When the
value was converted for the metric series, the entry also carries `stored_value` and `stored_unit`,
the value in the series. Reference ranges and the derived flag stay in the printed unit:

```json
{
  "metric": "ldl_cholesterol",
  "value": 100,
  "unit": "mg/dL",
  "reference_low": 0,
  "reference_high": 130,
  "flag": "normal",
  "stored_value": 2.586,
  "stored_unit": "mmol/L"
}
```

## API and MCP

- `GET /metric-catalog?q=` -- The catalogue's version, its groups and its entries in file order,
  each with `in_use` (whether you already have a metric of that name) and, when in use,
  `in_use_unit` (the unit of your metric, which may differ from the catalogue's). `q` keeps the
  entries where every word is the start of a word of the name, display name or an alias.
- `POST /metrics`, `POST /metrics/bulk` -- `metric` may be a catalogue name or alias; `unit` is
  optional.
- MCP `list_metric_catalog` (`q`) -- the same as `GET /metric-catalog`. `add_metric` and
  `add_metrics_bulk` take `unit`; `add_custom_metric` takes `separate_metric`.

Adoption itself has no endpoint or tool of its own; it happens through the writes above.

## Versioning

The catalogue has a `version` (`2026.11.1`). A new version only affects metrics adopted after it: a
metric you already have is yours, and a later catalogue change never rewrites it.

## Left out

- **Insulin in pmol/L** is not an accepted unit: published conversion factors disagree (6.945 and
  6.0 pmol/L per µIU/mL).
- **LOINC codes** are not part of the catalogue.
- **Reference ranges** are not part of the catalogue: they differ per lab, and a report entry
  carries its own.
- Reads (`query_metrics`, `get_latest_metric`, charts) take the metric name only, not an alias,
  and existing series are never converted.
- The catalogue in the Android Add tab.

See [`NOTICE.md`](../../apps/backend/src/catalog/metrics/NOTICE.md) for where the factors come from.
