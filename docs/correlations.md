# Correlations & exploratory analysis

Aurboda's correlation engine answers two kinds of question:

1. **Does trigger X precede flare/event Y?** — for presence-only outcomes such
   as `back_pain` or `fissure_pain` (rows only exist on "bad" days). This is the
   **event-outcome** mode.
2. **How does a daily quantity relate to another?** — e.g. "how does carb intake
   affect my sleep score?". This is the **continuous** mode.

Both are reachable from the **Analyze → Explore** page in the web app, the REST
API, and the MCP tools. All analysis is bucketed by **UTC calendar day**.

## Selectors

A _selector_ names any data dimension and resolves to event days, a daily value
series, and the set of days where its status is _known_:

| kind                                         | resolves from                                          | known days                                       |
| -------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------ |
| `tag` / `activity`                           | activities matched by `activity_type` (regex)          | every day in range (absence = no event)          |
| `metric`                                     | `time_series` entries (avg/sum per day)                | days with ≥1 entry (incl. explicit 0s)           |
| `nutrition`                                  | per-day meal totals (calories/protein/carbs/fat/fiber) | days with a meal **or** marked meal-log-complete |
| `productivity_category` / `productivity_app` | productivity minutes matched by category/app           | every day in range                               |

`GET /correlations/selectors` (MCP: `list_correlation_selectors`) lists the
available metrics, tags, activity types, nutrients and productivity categories.

`tag` and `activity` both match `activity_type` by regex and behave identically —
tags were long ago merged into activities. The API still accepts both for
backward compatibility, but the web picker only offers **activity / tag** (one
option) to avoid the confusing duplicate; it autocompletes from every
`activity_type`, including former tags.

## Event-outcome mode

Surfaced through `get_generic_correlation` / `POST /correlations/generic` with an
`event` outcome:

```jsonc
{
  "triggers": [{ "type": "tag", "pattern": "ejaculation" }],
  "outcome": {
    "type": "event",
    "source": "metric",
    "metric": "back_pain",
    "threshold": { "op": "gt", "value": 0 },
    "collapse_gap_days": 3,
  },
  "lag_windows": ["24h", "48h", "7d"],
  "period_start": "2019-09-28", // regime scoping (optional)
  "denominator": "all", // see below
}
```

How it works:

- **Onset-collapsing.** Consecutive outcome days no more than `collapse_gap_days`
  apart (default 3) collapse into a single _onset_, so a 6-day flare counts once
  instead of six times.
- **Exposure.** A known day is _exposed_ when a trigger occurred within the lag
  window ending on that day (e.g. `48h` = the day itself plus the day before).
- **Effect.** Over the known-day denominator, the engine builds a 2×2 table of
  {onset, non-onset} × {exposed, unexposed} and reports, per lag window:
  - **`reverse_conditional`** — P(recent trigger | onset). _This is the headline_
    — the user's actual question ("when my back flares, how often had I recently
    leaked?").
  - **`base_rate`** — P(a known day is exposed), for comparison.
  - **`relative_risk`** with a 95% CI, **`risk_difference`**, and a **p-value**
    from Pearson's chi-squared (or Fisher's exact test when any expected cell < 5).

### Denominator: `known` vs `all`

The denominator is the set of days the analysis trusts as "outcome status known":

- **`known`** (default) — only days where the metric was actually logged. Correct
  for metrics that log explicit zeros (e.g. a daily Hälsa log), where a silent
  day genuinely is unknown.
- **`all`** — every day in the regime. Correct for **presence-only** metrics
  (`back_pain`), where you trust that within the scoped period a missing day
  means "no flare". Pair this with `period_start`/`period_end` to bound the
  regime to a behavioural era.

> The same trigger can be noise in one regime and significant in another, and the
> effect can swing purely from denominator and period choices. Choose the
> denominator that matches how the outcome was logged, and scope the regime to a
> period where that assumption holds.

## Continuous mode

Surfaced through `get_metric_correlation` / `POST /correlations/continuous`:

```jsonc
{
  "trigger": { "kind": "nutrition", "nutrient": "carbs" },
  "outcome": { "kind": "metric", "metric": "sleep_score" },
  "lag_days": 1, // outcome measured 1 day after the trigger
  "period_days": 180,
}
```

It aligns the two daily series on days where **both** sides are known (a missing
value on a known day defaults to 0, e.g. a meal-log-complete day with no carbs),
optionally shifting the outcome forward by `lag_days`, and returns Pearson
(`pearson`, with a two-sided `pearson_p`) and Spearman coefficients plus the
aligned series for plotting. The web UI draws a scatter with a regression-line
overlay, axis labels with units, and the `r / ρ / n / p` annotation; for a binary
trigger it switches to a present-vs-absent **box plot** (a scatter would collapse
to two vertical lines). The event-onset table is accompanied by a per-lag
**relative-risk chart** with 95% CI whiskers and an RR=1 reference line.

### Binary/presence trigger — `group_comparison`

A Pearson r on a **binary or presence** trigger (e.g. `hot_bath` → `sleep_score`,
where the trigger is 0/1 each day) is misleading — every point sits at x=0 or
x=1. So the response also includes a `group_comparison` that answers the question
users actually mean, _"how much does X change Y?"_, by splitting the outcome into
the days the trigger was **present** (value > 0) vs **absent** (value 0):

- `mean_with` / `mean_without` and their `difference`;
- `cohens_d` (pooled effect size);
- a `welch` two-sample t-test (`t`, `df`, `p_value`);
- a `mann_whitney` U test (`u`, `p_value`, `rank_biserial` effect size);
- `n_with` / `n_without`, and `trigger_is_binary` (true when every aligned
  trigger value is exactly 0 or 1).

`group_comparison` is `null` when there is no split to compare (the trigger is
present on every aligned day or on none). The web UI makes the group comparison
the **headline** when `trigger_is_binary` (and flags the correlation coefficient
as misleading there), and otherwise shows it beside the correlation along with a
plain-language strength verdict and a small-sample caution.

### Nutrition completeness

Nutrition days come in two flavours: **nutrition-complete** days (at least one
meal with a real logged value for the nutrient being correlated) and
**flag-only** days (a meal logged with no macros, which sums to 0 and otherwise
reads as a noisy zero). Completeness is keyed per-nutrient — a day that logged
calories but never tracked fiber is complete for `calories` but not for `fiber`.
When either side of a continuous correlation is a `nutrition` selector:

- the response always reports `n_complete` — of the `n` aligned pairs, how many
  are nutrition-complete on every nutrition side (null when no side is
  nutrition), so the UI can show "n=104 (47 with full nutrition)";
- `nutrition_completeness: "complete_only"` (request body, default `"all"`)
  drops the flag-only pairs entirely so they don't dilute the correlation.

Completeness is independent of the event-mode `denominator` knob (which governs
known-vs-all days for presence-only _outcomes_).

## HRV context

`get_hrv_activities_correlation` / `GET /correlations/hrv-activities` summarises
the autonomic context (mean HRV, heart rate and stress, with baseline deltas)
around each activity, location and productivity category, and correlates the
productivity score against an autonomic metric.

That metric is selectable via `context_metric` — `hrv_rmssd` (default),
`heart_rate` or `stress_level`. Not everyone records continuous HRV throughout
the day, so heart rate or stress (which are denser) keep the productivity
`correlation_coefficient` meaningful. The chosen metric is echoed back as
`context_metric`; all three means stay in the response regardless. The web
"HRV context" tab exposes this as a **Context** dropdown.

## Statistics notes

- Chi-squared p-values are exact for 1 degree of freedom (`erfc(√(χ²/2))`). A
  previous approximation (`exp(-0.5·χ²)`) was inaccurate and has been replaced.
- Fisher's exact test (two-sided) is used automatically for small expected cell
  counts.
- Relative-risk CIs use the Wald log-RR standard error; they are omitted when an
  outcome cell count is zero.
- The Welch t-test p-value uses the two-sided Student-t distribution
  (`I_{df/(df+t²)}(df/2, ½)` via the regularized incomplete beta); Mann–Whitney
  U uses a tie-corrected normal approximation. Both are omitted (`null`) when a
  group has fewer than two values or no variance.
- `pearson_p` is the two-sided significance of the Pearson r via the t-transform
  `t = r·√((n−2)/(1−r²))` on `n−2` df; null with fewer than 3 pairs, 0 for a
  perfect correlation.

## Performance

Analysis is day-level with linear exposure sweeps, so multi-year regimes
(2000+ days) run without timing out.

External data syncs (Oura, RescueTime, calendars) are triggered
**fire-and-forget** before the analysis rather than awaited — a first or stale
sync makes live HTTP calls that can take many seconds, long enough to blow the
request timeout regardless of how small the analysis window is. The triggering
request therefore reads from data already in the database (so it may miss the
most recent few minutes); the sync warms the data for the next request. This is
the same pattern the rest of the query layer uses.
