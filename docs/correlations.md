# Correlations & exploratory analysis

Aurboda's correlation engine answers two kinds of question:

1. **Does trigger X precede flare/event Y?** — for presence-only outcomes such
   as a `headache` or `migraine` metric (rows only exist on "bad" days). This is the
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
  "triggers": [{ "type": "activity", "pattern": "alcohol" }],
  "outcome": {
    "type": "event",
    "source": "metric",
    "metric": "headache",
    "threshold": { "op": "gt", "value": 0 },
    "collapse_gap_days": 3,
  },
  "lag_windows": ["24h", "48h", "7d"],
  "period_start": "2026-01-01", // regime scoping (optional)
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
    — the user's actual question ("when I get a headache, how often had I
    recently had a drink?").
  - **`base_rate`** — P(a known day is exposed), for comparison.
  - **`relative_risk`** with a 95% CI, **`risk_difference`**, and a **p-value**
    from Pearson's chi-squared (or Fisher's exact test when any expected cell < 5).

### Denominator: `known` vs `all`

The denominator is the set of days the analysis trusts as "outcome status known":

- **`known`** (default) — only days where the metric was actually logged. Correct
  for metrics that log explicit zeros (e.g. a daily Hälsa log), where a silent
  day genuinely is unknown.
- **`all`** — every day in the regime. Correct for **presence-only** metrics
  (`headache`), where you trust that within the scoped period a missing day
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

## Context analysis (Analyze → context tab)

Each row of the context tables (activities, locations, productivity categories)
answers three questions about HRV, heart rate and stress:

1. **During** (`mean_*`): what is the metric while it is going on?
2. **vs avg** (`*_delta_from_baseline`): how does that compare with the average
   over the whole period (`baseline`)?
3. **Change** (`hrv_effect`, `hr_effect`, `stress_effect`): how does the metric
   move from the `window_minutes` before to the `window_minutes` after?

The window `W` is chosen on the page with the window selector next to the period
selector: ±30 min (default), ±1 h, ±2 h, ±4 h, ±8 h, ±12 h or ±24 h. It drives
both the tables' **Change** column and the chart. It is a page setting, not a
saved one.

Clicking a row draws the before/during/after chart for the same row, and both
come from one computation (`apps/backend/src/services/correlations/impact.ts`),
so the summary lines under the chart show the same numbers as the row's
**Change** cells.

How the numbers are made:

- **5-minute bins.** Each series (`hrv_rmssd`, `heart_rate`, `stress_level`) is
  resampled to 5-minute bins aligned to the epoch; a bin is the mean of its
  samples. Everything downstream reads bins, so a densely recorded stretch (1 Hz
  heart rate during a workout) weighs the same per minute as a sparse one. The
  period average (`baseline`) is the mean over the bins inside the period.
- **Series reach past the period.** The three series are fetched from
  `start − W` to `end + W`, so the first and last sessions of the period get
  full windows. Activities, visits and productivity are still taken from the
  period only, and the baseline still uses only the bins inside it.
- **Activities as shown.** Every correlation reads activities the way the
  activity pages show them, after overrides and merges: a synced row an
  override (a manual edit or a retyping rule) replaced counts only under the
  override's type, and the same session from two sources is one activity.
- **Sessions.** Entries of the same group (one activity type, one location, one
  productivity category) that overlap or are at most 10 minutes apart are merged
  into one session, so the same session from two sources, or back-to-back
  entries, count as one occurrence. A session shorter than 5 minutes, a
  point activity (no end time) included, counts as 5 minutes, so it always
  holds one bin. Before #1589 the table used ±30 minutes around a point
  activity as its "during", so "during" values for point activities are not
  comparable with numbers from before that change.
- **Clipped windows.** Before is `[start − W, start)`, after is
  `[end, end + W)`, each clipped to the neighbouring sessions of the same group,
  so one session's "after" never reaches into the next session. A window that
  ends where a session begins leaves out the 5-minute bin that session starts
  in, since that bin holds samples from the session itself.
- **Timeline buckets.** The chart's `timeline` splits each side of the window
  into 2 buckets when `W` is under an hour and 4 otherwise (30 min → 15-minute
  buckets, 4 h → 1-hour buckets, 24 h → 6-hour buckets), clipped to the
  neighbouring sessions like the windows themselves.
- **Per-session averaging.** Every mean is the mean of per-session means, and
  `stddev` is across sessions, so a long or densely sampled session counts once.
- **The paired change.** Over the sessions with data both before and after
  (`paired_occurrences`): `before_mean`, `after_mean`, `change`
  (= `after_mean − before_mean`, the mean of per-session differences),
  `change_stddev`, and `p_value` from a paired t-test
  (`t = mean_d / (sd_d / √n)` on `n − 1` df). `p_value` is null with fewer than
  3 pairs or when every difference is the same. The web page colours a change
  only when `p_value < 0.05`.

Caveats: occurrences close in time are not independent, so the p-value is
optimistic; and a window that crosses a time of day picks up the daily rhythm
(heart rate rising in the morning, say) as well as the activity's own effect.
The longer the window, the more it does: a few hours after an evening session
is mostly sleep. The page says so whenever the window is 2 hours or more. There
is no time-of-day correction.

API:

- `GET /correlations/hrv-activities?period_days=30&context_metric=hrv_rmssd&window_minutes=30`
  and MCP `get_hrv_activities_correlation` (`window_minutes`, 10–1440, default
  30). The response echoes `window_minutes`.
- `GET /correlations/activity-impact/:activity?activity_type=activity_type&period_days=30&window_minutes=30&match=exact`
  and MCP `get_activity_impact` (`window_minutes`, `match`). `match` is
  `contains` (default: every name containing `activity`, case-insensitive) or
  `exact` (the grouping key the context table uses). `timeline` is an ordered
  array of buckets, `{ phase, start_offset_minutes, end_offset_minutes, hrv, hr,
stress }`: the before buckets oldest first, then `during`, then the after
  buckets. Offsets of before buckets are relative to the session start
  (negative, e.g. `-240 … -180`), offsets of after buckets relative to the
  session end, and `during` has both offsets `0`. So `window_minutes=240` gives
  9 buckets and `window_minutes=30` gives 5. The older `*_timeline` objects are
  kept for compatibility: their keys name the default 30-minute window, and
  `before30min`/`after30min` are the outer half of the window and
  `before15min`/`after15min` the inner half, whatever `window_minutes` is.
  `occurrences` counts merged sessions. `start` and `end` (ISO 8601 datetimes,
  given together) fix the analysed period instead of the last `period_days`
  days: `start` inclusive, `end` exclusive. One without the other, or a `start`
  not before `end`, is a 400 (an error from the MCP tool). An article's impact
  block uses this with `match=exact` and its own window.

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
