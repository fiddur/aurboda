# Trends (EMA)

Trends use Exponential Moving Average (EMA) smoothing to show how things change over time. Instead of noisy day-to-day fluctuations, you see a smooth curve that reveals the underlying pattern -- whether your coffee intake is creeping up, your weight is trending down, or your screen time is shifting.

The Trends page lets you configure and save multiple trend cards. Trends also appear automatically on Tag Meta pages, Metric Meta pages, Screentime Category Detail pages, and as Dashboard widgets.

## What Is EMA?

EMA is a weighted average where recent data counts more than old data. The **half-life** controls how quickly old data fades:

| Half-life   | Label      | Behavior                                                                                       |
| ----------- | ---------- | ---------------------------------------------------------------------------------------------- |
| **7 days**  | Quick      | Responds fast to changes. A week of new behavior dominates. Good for daily habits like coffee. |
| **15 days** | Responsive | Balanced default. Smooths out noise but reflects changes within ~2 weeks.                      |
| **30 days** | Stable     | Very smooth line. Short-term spikes are flattened. Good for slow-moving things like weight.    |

After one half-life, old data has 50% weight. After two half-lives, 25%. After three, 12.5%. So a 15-day half-life means data from 45 days ago has essentially no influence.

## Three Source Types

### Tags

Tracks how frequently tags matching a pattern occur. The pattern is a regex, so you can combine multiple tags: `pain_killer|painkiller|ibuprofen` matches any of those.

The trend value represents occurrences per display period (e.g., "3.5 per month").

### Metrics

Tracks the smoothed value of any numeric metric (weight, HRV, sleep score, steps, etc.). Three aggregation modes:

- **Average**: Shows the typical daily value, smoothed. Useful for things like weight or resting heart rate where you want to see the central tendency. The unit is the metric's own (e.g. "kg"). This is the default for metric trends.
- **Sum**: Shows the total per display period, smoothed. Useful for things like steps or a dose where you want to see "steps per week" or "mg per month."
- **Count**: Shows how many samples were logged per display period, smoothed -- "doses per month." Days without samples always count as zero.

#### Metric kind

Every metric is either a **level** or an **amount**:

- A **level** (weight, waist, resting HR) is a state you measure now and then. A day without a sample means "not measured", so it is left out of the EMA and does not drag the line toward zero.
- An **amount** (steps, calories, a dose) is something that adds up. A day without a sample means zero, so it enters the EMA as 0 and the line falls toward zero when nothing is logged. That includes the days before the metric's first-ever sample, so a newly started amount metric reads low for a few half-lives (activity-type trends behave the same).

Built-in amount metrics are steps, distance, floors climbed, calories (active, basal, total), the HR-zone seconds and TRIMP (training and activity impulse); every other built-in metric is a level. Custom metrics choose their kind in their definition (**Kind**: Level -- average, or Amount -- sum; `aggregation: 'avg' | 'sum'` in the API and the `add_custom_metric` / `update_custom_metric` MCP tools). Custom metrics default to Level. The kind also decides whether bucketed bar charts total a custom metric per bucket.

The **Missing days** option overrides the kind for one trend: **Auto (by metric kind)**, **Count as zero** or **Skip** (`missing_days: 'zero' | 'skip'` in the API, the `get_trend` MCP tool, chart URLs and dashboard trend widgets). The trend result echoes the value it used as `missing_days`.

Before Count was real for metrics, a metric trend saved with **Count** rendered as **Average** (and the Chart page saved Count by default). Existing metric trend goals and dashboard trend widgets saved as Count were therefore rewritten to Average by a one-off migration, so they keep showing what they showed before.

### Screentime Categories

Tracks hours spent in a screentime category per day, summed from its screen time activity spans. Includes all subcategories -- trending "Work" includes time in "Work > Programming", "Work > Meetings", etc.

The trend value is shown as "hours per day" (or per week/month).

## Measure Trends (Decaying Best)

An activity type with list items -- a strength session's sets -- can also be trended on a **measure** of those items (`e1rm`, `max_weight`, `max_time`, `max_reps`, `volume`, `set_count`, `total_reps`; see [Activity Types: Exercises and measures](activity-types.md#exercises-and-measures)). Instead of an EMA, the trend is the **decaying best**: a running best that decays with the half-life between sessions and is lifted back by any session that beats the decayed value. One weak session never pulls it down; a long break lets it fade.

Each UTC day's value is the higher of that day's best session and the previous day's value decayed by `2^(-1 / half-life)`. The line starts at the first session -- days before it have no point -- and runs to today, decayed to today. Like the EMA sources, sessions up to three half-lives before the lookback are read first, so an older best still carries into the chart. Values are rounded to one decimal.

Parameters (`GET /trends`, the `get_trend` MCP tool):

- `source_type: 'activity_type'` and `pattern`: the activity type (its sub-types included).
- `measure`: the measure to trend. Without it, an activity-type trend is the usual EMA rate.
- `filter_field` / `filter_value`: one exercise, e.g. `sets.exercise` = `Squat`. Only that exercise's sets are measured and sessions without it do not count. Without them, every working set counts.
- `half_life_days` and `lookback_days` as for any trend. The API default half-life is 15 days; the web app uses **120 days** for measure trends, which suits a strength best.

`display_period`, `aggregation`, `breakdown_fields` and `missing_days` do not apply. The result has `aggregation: 'max'`, the measure's unit as `display_unit` (`kg`, `s`, `reps`, or empty for a set count), and echoes `measure`, `filter_field` and `filter_value`.

It is the trend shown on an exercise's page (`/activity-type/strength_training/item/sets.exercise/Squat`), and is available in the Chart Explorer (a Trend with a measure), as a dashboard trend widget (`measure`, `filter_field`, `filter_value` in the widget config) and as a [trend goal](goals.md#trend-goals).

## Configuration Options

When adding or editing a trend, you can configure:

| Option           | Choices                                                          | What it does                                                                               |
| ---------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **Name**         | Free text                                                        | Display name for the trend card. Defaults to the pattern if blank.                         |
| **Source type**  | Tag, Metric, Screentime Category                                 | What data to trend.                                                                        |
| **Pattern**      | Tag picker (multi-select), Metric picker, or Category picker     | What to match. Tags support regex with multiple selections joined by `\|`.                 |
| **Half-life**    | 7 (Quick), 15 (Responsive), 30 (Stable)                          | How quickly old data fades. See table above.                                               |
| **Lookback**     | 30 days to 5 years, or All time                                  | How far back the chart extends.                                                            |
| **Display as**   | Per day, Per week, Per month                                     | Rate normalization. Same data, different scale.                                            |
| **Aggregation**  | Metrics: Average, Sum, Count. Activity types: Sum (hours), Count | Whether to average, total or count daily values.                                           |
| **Missing days** | Auto (by metric kind), Count as zero, Skip (metric trends only)  | Whether a day without samples counts as 0 or is left out. See [Metric kind](#metric-kind). |

## The Trends Page

The `/trends` page shows a grid of your saved trend cards. Each card displays:

- The trend **name** and current EMA **value** with units.
- The **pattern** being matched.
- An interactive **chart** showing the trend over time. Hover to see exact values at any date.
- **Edit** and **Remove** buttons.

### Default Presets

New users start with three presets:

| Name        | Type   | Pattern                              | Half-life | Display   |
| ----------- | ------ | ------------------------------------ | --------- | --------- |
| Painkillers | Tag    | `pain_killer\|painkiller\|ibuprofen` | 15 days   | Per month |
| Coffee      | Tag    | `coffee`                             | 7 days    | Per day   |
| Weight      | Metric | `weight`                             | 14 days   | Per day   |

You can add, edit, or remove trends freely. The "Reset" button restores the defaults.

Saved trends are stored in your browser's local storage. They are not synced between browsers or devices.

## Trends Elsewhere in the App

### Tag Meta Pages

Every tag's overview page (`/tag/:tagKey`) shows a trend section with a mini chart of that tag's frequency over time. Uses a 15-day half-life and monthly display by default, with an adjustable lookback period.

### Metric Meta Pages

Every metric's overview page (`/metric/:metricName`) shows a trend section with a mini chart of that metric's smoothed value. Uses a 15-day half-life and daily display by default, with an adjustable lookback period.

### Screentime Category Detail

Each category detail page shows a "Time trend" section with a mini chart of hours spent in that category. Uses the category's own color for the chart.

### Dashboard

Trend charts can be added as widgets on the Dashboard. Configure the source type (tag or metric), pattern, and display period directly in the dashboard editor.

### Chart Explorer

The Chart Explorer (`/chart`) charts any activity type or metric as a trend or as bars. For an activity type with list items (a strength session's sets), a **measure** such as an exercise's e1RM charts as bars or, with **Trend (best)**, as its decaying best: a running best of the measure that decays with a half-life between sessions and is lifted by any session that beats it. Its half-life choices are 30, 60, 120 (the default), 240 days and 1 year; display period and aggregation do not apply. The URL carries it as `chart_type=trend&measure=e1rm&half_life_days=120`, with `filter_field` and `filter_value` for one exercise.

### Chart menu

Charts in the Chart Explorer and on an exercise's page have a ⋮ menu with **Open in Chart Explorer** (not shown in the explorer itself), **Add to dashboard** and **Set a goal**. Set a goal opens the Goals page with a new goal prefilled from the chart (a trend goal for a trend, a measure goal for a measure's bars), so only the target is left to type.

## What Data It Needs

Trends work with whatever data you have:

| Source type | Needs                                                                   |
| ----------- | ----------------------------------------------------------------------- |
| Tags        | Any tags -- manual, Oura, calendar imports, Last.fm auto-tags           |
| Metrics     | Time series data from any source (Oura, Garmin, Health Connect, manual) |
| Screentime  | Screen time spans from RescueTime or ActivityWatch                      |

The more historical data you have, the more useful long lookback periods become. A 30-day lookback with only 10 days of data will look sparse.

## Known Limitations

- Saved trends are stored in **browser local storage**, not on the server. Switching browsers or devices gives you the defaults.
- For tags and screentime categories, days with no matching data count as zero, which pulls the trend line down. For metrics it depends on the [metric kind](#metric-kind): amounts count missing days as zero, levels leave them out, and the Missing days option overrides either.
- The EMA computation window is capped at 90 days for performance, even with longer lookback periods. This means each point on the chart looks at most 90 days into the past, though the chart itself can display years of history.
- Dashboard trend widgets currently only support tags and metrics, not screentime categories.
