# Correlation Analysis

Aurboda goes beyond simple charts by computing statistical correlations between your health metrics and everything you do -- activities, locations, screen time, tags, and more. The goal is to answer questions like "Does evening exercise affect my sleep?" or "What's the probability of a headache after a bad night?"

In the web app it is the **Analyze** page (`/correlations`), with two tabs:

- **Explore** answers "does X make a difference to Y?": pick anything you log or measure (a drink, a late coffee, an evening run, carbs) and an outcome (sleep score, HRV, a headache). It compares the days with and without it, says how big the difference is, and whether it is more than chance. How it works is described in [Correlations & exploratory analysis](../correlations.md).
- **Context** shows how your HRV, heart rate and stress look during and around each activity, place and screen-time category, compared with your baseline. It is described below.

Everything is also available over the REST API and as MCP tools, so an AI assistant such as Claude can run the same analyses when you ask it in plain language.

## Your Baseline

The foundation of correlation analysis is your personal baseline -- rolling averages of HRV (Heart Rate Variability) and resting heart rate:

- **7-day average**: Your recent state. Sensitive to short-term changes.
- **30-day average**: Your longer-term norm. More stable.
- **Trend**: Percentage change comparing the current 30-day period to the previous 30 days.

HRV baseline uses sleep-context HRV (measurements taken during sleep), which is the most consistent and comparable across days. All correlation deltas are measured against this baseline.

## The Context tab

The first tab of the Analyze page shows three tables over a configurable analysis period (14, 30, 60, or 90 days). Checkboxes for **HRV**, **Heart rate** and **Stress** (all on by default) choose which metrics the baseline cards, the tables and the impact chart show. After them comes a checkbox for every other metric you record around the clock (at least every 15 minutes for half of the day on most days), so there is data before and after a session: Garmin body battery, say, or a continuous custom metric. Metrics recorded only during workouts or sleep (often respiration rate) do not qualify. These are off by default, and up to 4 can be on. A ticked one gets its own columns in the tables, its own line (on its own scale), summary line and legend entry in the impact chart, its own baseline card (its average over the period), and an r for productivity categories. Its changes are coloured green or red only where the good direction is known (higher body battery, SpO2 and HRV; lower resting heart rate); otherwise a statistically clear change is shown plainly. Daily values such as resting heart rate or sleep scores never appear: they cannot show a change around a 30-minute session. At least one checkbox stays on.

### Correlation Tables

Each table covers a different category of data:

**Activities** -- Exercise, meditation, naps. Shows how many times each occurred and the average duration.

**Locations** -- Named places you've visited. Shows visit count.

**Productivity Categories** -- Screen time categories (e.g., "Software Development", "Social Media"). Shows the Pearson correlation coefficient (r) between the productivity score and each shown metric.

Every row displays:

| Column        | What it means                                                                            |
| ------------- | ---------------------------------------------------------------------------------------- |
| **HRV**       | Your average HRV during or around that activity (in ms)                                  |
| **Delta HRV** | Difference from your baseline. Positive (green) = better than usual                      |
| **HR**        | Your average heart rate during or around that activity (in bpm)                          |
| **Delta HR**  | Difference from baseline. Negative (green) = lower than usual, which is typically better |
| **Samples**   | Total minutes of HR/HRV data collected                                                   |

### Activity Impact Detail

Click any row to see a **before/during/after timeline** chart. This shows how your HRV and heart rate change around a specific activity across five time windows:

- **-30 min** (30 to 15 minutes before the activity)
- **-15 min** (15 minutes before to the start)
- **During** (the activity itself)
- **+15 min** (end to 15 minutes after)
- **+30 min** (15 to 30 minutes after)

The chart plots HRV (green line, left axis) and heart rate (red line, right axis) with your 30-day HRV baseline shown as a dashed reference line. This lets you see, for example, whether meditation raises your HRV during the session and whether the effect persists afterward.

The impact analysis uses the page's period (the same period selector as the tables).

The chart's heading names the activity type by its display name and links to its page.

#### Breaking down and filtering

Above the chart, two controls slice the selected row's sessions. They apply to that row only; the tables stay unfiltered.

**Break down by** repeats the analysis per group of one dimension:

- **Length**: the session's length in minutes, in buckets cut at editable limits (default `15, 30, 60`: under 15 min, 15–30, 30–60, 60 min or more).
- **Time of day**: the session's local start time, in buckets cut at editable whole hours (default `0, 6, 12, 18`); the last bucket wraps round to the first, so `6, 22` gives 06–22 and 22–06.
- **Sleep in the window**: whether a sleep or nap overlaps the window before or after the session (no sleep, sleep before, sleep after, both).
- **A data field** of the activity type, for its categorical fields, such as a yoga session's name. A session with several values counts under each.

With a breakdown on, a chart draws one metric (pick it with **Chart**; stress by default) with a thick line for all sessions and one line per group, and a table lists During and Change for every shown metric, one row for all sessions and one per group. Only groups with at least 3 sessions are drawn, at most 8; the rest are in the table, greyed out. With several groups one can look clear by chance, so read small groups as hints.

**Filter sessions** opens a panel with one row of chips per dimension, each with its session count before filters. Pick chips to keep only those sessions: within a dimension any picked chip passes, and every dimension with a picked chip must pass. The heading shows how many sessions remain, e.g. "70 of 151 sessions". Changing the Length or Time of day limits clears that dimension's filter, since its buckets change. Selecting another row clears the filters and a data-field breakdown.

Sessions and their before/after windows are formed before filtering, so a window is still cut at every neighbouring session, including ones a filter leaves out.

With a long window, the after window of an evening session is mostly sleep. Filter **Sleep in the window** to **No sleep in the window** to leave those sessions out.

### Sharing a view

The page keeps its tab and every selection in the URL, so a view can be bookmarked or shared; whoever opens the link sees the same settings over their own data. A parameter is left out while it holds its default, so plain `/correlations` is the default view, and other parameters (such as the Android app's `embed=1`) are kept.

| Parameter                         | Meaning                                                                                             |
| --------------------------------- | --------------------------------------------------------------------------------------------------- |
| `tab`                             | `context` (default) or `explore`                                                                    |
| `days`, `window`                  | Context period (14, 30, 60, 90; default 30) and before/after window in minutes (default 30)         |
| `metrics`                         | Shown metrics: `hrv`, `hr`, `stress` and up to 4 other metric names, e.g. `hr,stress,body_battery`  |
| `item`, `item_type`               | The selected row: its name and kind (`activity_type`, `location`, `productivity_category`, ...)     |
| `breakdown`                       | Break down by: `duration`, `time_of_day`, `sleep` or `field:<path>`, e.g. `field:session_name`      |
| `lengths`, `hours`                | Length limits in minutes (default `15,30,60`) and time-of-day limits in hours (default `0,6,12,18`) |
| `filter`                          | Session filters, e.g. `duration:15-30,30-60;sleep:none`; each key URL-encoded                       |
| `breakdown_metric`                | The metric the breakdown chart draws (`hrv`, `hr`, `stress` or a metric name); default stress       |
| `mode`                            | Explore mode: `event` (default) or `continuous`                                                     |
| `trigger`, `outcome`              | Explore selectors as `kind:value`, e.g. `activity:alcohol`, `nutrition:carbs`, `metric:sleep_score` |
| `outcome_source`, `outcome_value` | Event-mode outcome: `metric` or `tag`, and its name or pattern                                      |
| `lags`, `gap`, `denominator`      | Event-mode lag windows (default `24h,48h,7d`), collapse gap in days (default 3), `known` or `all`   |
| `lag_days`, `nutrition`           | Continuous-mode outcome lag in days (default 0) and `all` or `complete_only` nutrition days         |
| `start`, `end`, `explore_days`    | Explore regime: dates (YYYY-MM-DD), or the last N days (default 365)                                |

An Explore link whose trigger and outcome are filled in runs the analysis once when it opens; changing the form afterwards only updates the URL until **Run analysis** is pressed.

## Event Probability (API / MCP only)

For questions like "Does coffee increase my chance of a headache?", the event probability analysis examines whether one event (the trigger) changes the likelihood of another event (the outcome) occurring within a configurable time window.

**Example:** Trigger = "exercise" tag, Outcome = "headache" tag, Lag windows = 12h, 24h, 36h, 48h.

The analysis returns:

- **Baseline probability**: How often the outcome occurs on any given day, regardless of the trigger.
- **Per-window probability**: How often the outcome occurs within each lag window after the trigger.
- **Relative risk**: The ratio of triggered probability to baseline. Values above 1.0 mean the trigger increases the outcome likelihood; below 1.0 means it decreases it.
- **Statistical significance**: A chi-squared test with p-value indicating whether the association is statistically significant or likely due to chance.

The default analysis period is 365 days to ensure enough data points for meaningful statistics.

## Generic Correlation (API / MCP only)

The most powerful analysis tool. It supports compound triggers (multiple conditions that must all be met) and flexible outcomes.

### Compound Triggers

You can combine multiple conditions with AND logic. Each trigger can specify:

- **What to match**: An activity type, tag, productivity category, or app name (regex patterns).
- **Minimum count**: How many times the trigger must occur within the window (default: 1).
- **Window**: Rolling window in days to count occurrences (default: 1 day).

**Example:** "On days when I do both exercise AND drink coffee (at least 2 cups), how does my sleep score compare to days without?"

### Outcome Types

Three types of outcomes can be analyzed:

**Tag outcomes**: Probability of a tag occurring after the trigger. Returns probability, relative risk, and chi-squared significance.

**Metric outcomes**: How a metric (weight, HRV, sleep score, etc.) changes. Supports aggregation methods (mean, min, max, last). Returns the metric value on trigger days vs. baseline days.

**Productivity outcomes**: Time spent in a screen time category or app. Returns total and average minutes per day, compared to baseline.

### Lag Windows

Configurable time windows (e.g., 24h, 48h, 7d) determine how far after the trigger to look for outcomes. Different windows can reveal delayed effects that wouldn't be visible in a short window.

## What Data It Needs

Correlation analysis requires **HRV and heart rate data** as the baseline metric. This comes from Oura, Garmin, or Health Connect. The richer your data, the more meaningful the correlations:

| For correlating with... | You need...                                                         |
| ----------------------- | ------------------------------------------------------------------- |
| Activities              | Exercise/sleep/meditation data from Oura, Garmin, or Health Connect |
| Locations               | Place visits from OwnTracks or Home Assistant                       |
| Productivity            | Screen time data from RescueTime or ActivityWatch                   |

Minimum data requirements vary by category: activities need at least 1 occurrence, locations need 30+ minutes of overlap, and productivity categories need 10+ minutes.

## How HRV Is Collected Per Category

Different categories sample HRV from different time windows:

- **Activities**: HRV/HR data during the activity (start to end time).
- **Locations**: HRV/HR data during the visit duration.
- **Productivity**: HRV/HR data during screen time record windows.

## Statistical Methods

| Method                      | Used for                               | Description                                                                                  |
| --------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Pearson correlation (r)** | Productivity categories                | Linear correlation between productivity score and HRV, heart rate or stress. Range: -1 to 1. |
| **Delta from baseline**     | All categories                         | Simple difference between the activity's mean HRV/HR and your overall baseline.              |
| **Relative risk**           | Event probability, generic correlation | Ratio of P(outcome given trigger) to P(outcome without trigger).                             |
| **Chi-squared test**        | Event probability, generic correlation | Tests whether the trigger-outcome association is statistically significant.                  |

## Known Limitations

- Event probability and generic correlation are **API/MCP-only** -- they have no web UI. They are designed for AI-driven analysis (e.g., asking Claude "what's the probability of a headache after poor sleep?").
- The Pearson correlation coefficient requires at least 3 data points and only measures linear relationships. Non-linear associations won't be captured.
- Correlation does not imply causation. A strong correlation between two events might be caused by a third, unmeasured factor.
- Auto-sync is triggered in the background (fire-and-forget) — it never blocks correlation computation, so the analysis returns from existing data immediately. Newly synced data lands on the next request, so the first load after a stale period may reflect slightly out-of-date data.
