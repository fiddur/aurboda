# Goals

Goals let you set targets for any metric and track your progress over a rolling time window. The Goals page shows at a glance whether you're on track, how much you've accumulated, and how much will drop off the window tomorrow. An Android home screen widget keeps your progress visible without opening the app.

## How Goals Work

Each goal has:

- A **metric** -- any metric in the system (HR zone minutes, steps, distance, calories, sleep score, etc.).
- A **minimum** and/or **maximum** target value (at least one required).
- A **window** -- a rolling time period (default: 7 days).

Progress is the sum of the metric over the rolling window. For a 7-day window, that's today plus the 6 previous days.

### Examples

| Goal             | Metric    | Min     | Max    | Window | Meaning                                         |
| ---------------- | --------- | ------- | ------ | ------ | ----------------------------------------------- |
| Zone 2 cardio    | HR Zone 2 | 150 min | --     | 7d     | At least 150 minutes of aerobic cardio per week |
| Zone 5 intensity | HR Zone 5 | 5 min   | 10 min | 7d     | 5-10 minutes of max-effort work per week        |
| Weekly steps     | Steps     | 70,000  | --     | 7d     | At least 70,000 steps per week (~10k/day)       |

### Measure Goals

A measure goal tracks a measure of an activity type's list items — a strength session's sets — instead of a metric. The measures are the ones the sessions view shows (see [Activity Types: Exercises and measures](activity-types.md#exercises-and-measures)): `e1rm` (best estimated one-rep max, kg), `max_weight` (kg), `max_time` (longest hold, s), `volume` (Σ weight × reps, kg) and `set_count`. Warmup sets never count.

Each measure goal has:

- An **activity type** whose sessions are measured (its sub-types included), e.g. `strength_training`.
- Optionally an **exercise filter**: an item path and value, e.g. `sets.exercise` = `Bench Press`. Only that exercise's sets are measured (compared trimmed and case-insensitively), and sessions without it don't count. Without one, every working set of the session counts.
- A **measure**.
- An **aggregation**: `max` (the default) takes the best session in the window — right for `e1rm`, `max_weight` and `max_time`; `sum` totals the window — right for `volume` and `set_count`.
- A **minimum** and/or **maximum**, and a **window** (default `30d`), as for metric goals.

Example: **Bench Press e1RM ≥ 100 kg over 30 days** — activity type `strength_training`, filter `sets.exercise` = `Bench Press`, measure `e1rm`, aggregation `max`, min 100, window `30d`. It is met while some Bench Press session in the last 30 days has an estimated one-rep max of at least 100 kg.

A measure goal's progress is 0 when no session in the window has the measure. The Goals page and the widget title it by the exercise (or the activity type's name) and the measure, e.g. "Bench Press Best e1RM".

## Default Goals

New users start with three defaults based on the Huberman/Galpin exercise science recommendations:

1. **Zone 2 cardio**: minimum 150 minutes per week
2. **Zone 5 intensity**: 5-10 minutes per week
3. **Steps**: minimum 70,000 per week

These apply until you configure your own goals. Setting an empty goal list removes all defaults.

## The Goals Page

The page at `/goals` shows a progress bar for each configured goal. Each displays:

- **Metric name** (human-friendly label, e.g., "Zone 2" instead of the raw metric name)
- **Current value** vs. target (e.g., "2h 15m / 2h 30m")
- **Progress bar** with color coding:
  - **Gray** -- below the minimum target
  - **Green** -- met (min-only) or in range (between min and max)
  - **Red** -- over the maximum target
- **Min/Max markers** on the bar showing where the thresholds fall
- **"Losing tomorrow"** indicator (explained below)
- **Window info** (e.g., "Rolling 7d window from today")

The page auto-refreshes every 60 seconds.

## History

Click (or tap, or focus and press Enter) a goal on the Goals page to open its history under it; click it again to close. The open goal and range live in the URL (`/goals?history=<id>&range=90d`), so the view can be linked and survives a reload.

A range switch picks how far back to look:

| Range       | Shows                                       |
| ----------- | ------------------------------------------- |
| **30 days** | One bar (or point) per day                  |
| **90 days** | One bar (or point) per day                  |
| **1 year**  | One bar per month: the days on target in it |

- **A day's value** is the goal as it stood at the end of that day: for a metric goal, the sum over the goal's window ending that day (a `7d` goal's bar for 12 October covers 6-12 October); for a measure goal, the rolling sum or the rolling max (the best session in the window ending that day, 0 when there is none); for a trend goal, the EMA value for that day. Days are calendar days in the user's device timezone (`device_timezone`, auto-detected by the Android app; UTC when unset), like the progress bar, so a day-based window starts at local midnight in that zone. Trend goals' days remain UTC days. Time-based windows (`h`, `m`, `s`) are rounded up to whole days, so a `36h` goal looks back 2 days.
- **On target** means at or above the minimum (if there is one) and not above the maximum (if there is one); exactly the maximum is still on target. Bars are gray below target, green on target, red over. A green band marks the target range, with dashed lines at the min and max.
- **The summary** reads e.g. "On target 12 of 30 days · 3 over", and for the daily ranges adds today's status so far.
- **Today** is drawn faded (or as a hollow point for trend goals) and is not counted in the summary or the monthly bars, because the day is not over.
- **Monthly bars** show the days on target in green against a gray bar of all days counted that month. The current month is faded because it is still running.
- **Trend goals** draw the EMA as a line, with a point per day coloured by status.
- **The current target applies to every day.** Changing a goal's min or max re-colours its whole history; past targets are not kept.

The same data is available over the API as `GET /goals/{id}/history?bucket=day|month&lookback_days=N` (`lookback_days` completed days before today, 1-730, default 30; today is always included as partial) and through the MCP tool `get_goal_history`.

## "Losing Tomorrow"

This is a key concept. Since goals use a rolling window, the oldest day's data drops off each day. "Losing tomorrow" tells you how much will be lost.

**Example:** You have a 7-day steps goal. Your rolling total is 72,000 steps. The oldest day in the window (7 days ago) contributed 12,000 steps. You'll see `(-12,000 tomorrow)`. This means your rolling total will drop to ~60,000 tomorrow unless new activity makes up the difference.

This helps you plan: if you're close to your target and tomorrow's loss is large, you know you need to be active today.

For a `sum` measure goal it reads the same way: the oldest day's volume or sets. For a `max` measure goal it is how far the best falls when the oldest day leaves the window: if your 100 kg e1RM was only lifted on that day and the best later session is 95 kg, it shows `(-5 kg tomorrow)`; if a later session also reached 100 kg, nothing is lost; if no later session has the measure, all of it is.

## Configuring Goals

Goals are configured under **Data Sources > Aurboda (Web/API)** in the web UI.

For each goal you can set:

| Field      | Description                                                                                                                       |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Metric** | Dropdown of all available metrics (60+ options)                                                                                   |
| **Min**    | Minimum target. For time-based metrics (HR zones), enter in minutes (stored as seconds internally)                                |
| **Max**    | Maximum target. Same display conversion. At least one of min or max required.                                                     |
| **Window** | Rolling window duration. Default `7d`. Supports: `s` (seconds), `m` (minutes), `h` (hours), `d` (days), `w` (weeks), `M` (months) |

A **measure goal** instead sets the activity type, an optional exercise filter (`filter_field` such as `sets.exercise` and `filter_value` such as `Bench Press`, given together), the measure, the aggregation (`max` or `sum`) and the window (default `30d`); min and max are in the measure's unit (kg, s, or a count). Over the API it is a goal with `goal_type: "measure"`.

Goals can be **drag-reordered** -- the order determines how they appear on the Goals page and in the Android widget. Changes save automatically.

### Window Types

- **Day-based** (`d`, `w`, `M`): Aligned to calendar day boundaries. `7d` = today + 6 previous full days.
- **Time-based** (`h`, `m`, `s`): Exact rolling offset. `24h` at noon means yesterday noon through now.

## Android Widget

The Android home screen widget shows the same goal progress as the web page. Each goal appears as a row with the metric label, current value, progress bar, and "losing tomorrow" amount. The widget:

- Updates after each background sync (every 15 minutes)
- Uses the same color coding (gray/green/red)
- Respects the drag order from the web settings
- Tapping opens the app

## What Data It Needs

Goals work with any metric in the system. The metric must have data within the rolling window for progress to appear. Common metric sources:

| Metric type     | Typical source                                                |
| --------------- | ------------------------------------------------------------- |
| HR Zone minutes | Computed from exercise HR data (Oura, Garmin, Health Connect) |
| Steps           | Garmin, Health Connect                                        |
| Distance        | Health Connect                                                |
| Calories        | Computed from HR data or Health Connect                       |
| Sleep score     | Oura                                                          |
| Weight          | Manual entry, Health Connect                                  |

## Known Limitations

- Metric goals only support **sum** aggregation over the window, and measure goals **sum** or **max**. There's no way to set a goal based on an average (e.g., "average sleep score above 80").
- HR zone metrics are **computed on-the-fly**, not stored. This means goals for zone minutes depend on having exercise sessions with heart rate data.
- The "losing tomorrow" calculation uses calendar day boundaries for day-based windows. For time-based windows (`h`, `m`, `s`), it uses exact time offsets.
- There is no notification system -- you must check the Goals page, Dashboard, or Android widget to see your progress. (See issue #383 for planned notifications.)
