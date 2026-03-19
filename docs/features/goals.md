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

## "Losing Tomorrow"

This is a key concept. Since goals use a rolling window, the oldest day's data drops off each day. "Losing tomorrow" tells you how much will be lost.

**Example:** You have a 7-day steps goal. Your rolling total is 72,000 steps. The oldest day in the window (7 days ago) contributed 12,000 steps. You'll see `(-12,000 tomorrow)`. This means your rolling total will drop to ~60,000 tomorrow unless new activity makes up the difference.

This helps you plan: if you're close to your target and tomorrow's loss is large, you know you need to be active today.

## Configuring Goals

Goals are configured under **Data Sources > Aurboda (Web/API)** in the web UI.

For each goal you can set:

| Field      | Description                                                                                                                       |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Metric** | Dropdown of all available metrics (60+ options)                                                                                   |
| **Min**    | Minimum target. For time-based metrics (HR zones), enter in minutes (stored as seconds internally)                                |
| **Max**    | Maximum target. Same display conversion. At least one of min or max required.                                                     |
| **Window** | Rolling window duration. Default `7d`. Supports: `s` (seconds), `m` (minutes), `h` (hours), `d` (days), `w` (weeks), `M` (months) |

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

- Goals only support **sum** aggregation over the window. There's no way to set a goal based on an average (e.g., "average sleep score above 80").
- HR zone metrics are **computed on-the-fly**, not stored. This means goals for zone minutes depend on having exercise sessions with heart rate data.
- The "losing tomorrow" calculation uses calendar day boundaries for day-based windows. For time-based windows (`h`, `m`, `s`), it uses exact time offsets.
- There is no notification system -- you must check the Goals page, Dashboard, or Android widget to see your progress. (See issue #383 for planned notifications.)
