# Metric catalogue: sources

`metric-catalog.json` is written by hand. See
[docs/features/metric-catalog.md](../../../../../docs/features/metric-catalog.md).

The list of metrics, their names, groups and aliases are Aurboda's own.

The conversion factors follow from the molar masses of the substances and the definitions of the
units. They were compared with the SI conversion tables of the AMA Manual of Style and of Labcorp,
and the catalogue tests recompute the molar-mass factors and check them within 0.5 %.

- HbA1c converts between NGSP (%) and IFCC (mmol/mol) with the IFCC/NGSP master equation.
- Prolactin uses 21.2 mIU/L per µg/L (WHO 3rd International Standard 84/500).
- Insulin in pmol/L is not converted, because the published factors disagree (6.945 and 6.0).
- `blood_urea_nitrogen` is kept apart from `urea`, because the same unit, mg/dL, means a different
  amount for the two: BUN counts the nitrogen only.
