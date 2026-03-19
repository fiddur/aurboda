# Correlation Analysis

Aurboda goes beyond simple charts by computing statistical correlations between your health metrics and everything you do -- activities, locations, screen time, tags, and more. The goal is to answer questions like "Does evening exercise affect my sleep?" or "What's the probability of a headache after a bad night?"

The feature has three layers: a visual Correlations page for browsing, an API for programmatic access, and MCP tools that let AI assistants run sophisticated analyses on your data.

## Your Baseline

The foundation of correlation analysis is your personal baseline -- rolling averages of HRV (Heart Rate Variability) and resting heart rate:

- **7-day average**: Your recent state. Sensitive to short-term changes.
- **30-day average**: Your longer-term norm. More stable.
- **Trend**: Percentage change comparing the current 30-day period to the previous 30 days.

HRV baseline uses sleep-context HRV (measurements taken during sleep), which is the most consistent and comparable across days. All correlation deltas are measured against this baseline.

## The Correlations Page

The web page at `/correlations` shows four correlation tables with a configurable analysis period (14, 30, 60, or 90 days).

### Correlation Tables

Each table covers a different category of data:

**Activities** -- Exercise, meditation, naps. Shows how many times each occurred and the average duration.

**Locations** -- Named places you've visited. Shows visit count.

**Productivity Categories** -- Screen time categories (e.g., "Software Development", "Social Media"). Shows the Pearson correlation coefficient (r) between the productivity score and your HRV.

**Tags** -- Manual tags, Oura tags, calendar events, auto-tags. Shows occurrence count.

Every row displays:

| Column | What it means |
|---|---|
| **HRV** | Your average HRV during or around that activity (in ms) |
| **Delta HRV** | Difference from your baseline. Positive (green) = better than usual |
| **HR** | Your average heart rate during or around that activity (in bpm) |
| **Delta HR** | Difference from baseline. Negative (green) = lower than usual, which is typically better |
| **Samples** | Total minutes of HR/HRV data collected |

### Activity Impact Detail

Click any row to see a **before/during/after timeline** chart. This shows how your HRV and heart rate change around a specific activity across five time windows:

- **-30 min** (30 to 15 minutes before the activity)
- **-15 min** (15 minutes before to the start)
- **During** (the activity itself)
- **+15 min** (end to 15 minutes after)
- **+30 min** (15 to 30 minutes after)

The chart plots HRV (green line, left axis) and heart rate (red line, right axis) with your 30-day HRV baseline shown as a dashed reference line. This lets you see, for example, whether meditation raises your HRV during the session and whether the effect persists afterward.

The impact analysis always uses a 90-day lookback for statistical reliability, regardless of the period selector on the main page.

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

| For correlating with... | You need... |
|---|---|
| Activities | Exercise/sleep/meditation data from Oura, Garmin, or Health Connect |
| Locations | Place visits from OwnTracks |
| Productivity | Screen time data from RescueTime or ActivityWatch |
| Tags | Any tags -- manual, Oura, calendar imports, Last.fm auto-tags |

Minimum data requirements vary by category: activities need at least 1 occurrence, tags need at least 2, locations need 30+ minutes of overlap, and productivity categories need 10+ minutes.

## How HRV Is Collected Per Category

Different categories sample HRV from different time windows:

- **Activities**: HRV/HR data during the activity (start to end time).
- **Locations**: HRV/HR data during the visit duration.
- **Productivity**: HRV/HR data during screen time record windows.
- **Tags**: HRV/HR from 30 minutes before the tag start through the tag end. For point-in-time tags (no end time), the window extends 30 minutes after the start. This captures the physiological context around the event, not just during it.

## Statistical Methods

| Method | Used for | Description |
|---|---|---|
| **Pearson correlation (r)** | Productivity categories | Measures linear correlation between productivity score and HRV. Range: -1 to 1. |
| **Delta from baseline** | All categories | Simple difference between the activity's mean HRV/HR and your overall baseline. |
| **Relative risk** | Event probability, generic correlation | Ratio of P(outcome given trigger) to P(outcome without trigger). |
| **Chi-squared test** | Event probability, generic correlation | Tests whether the trigger-outcome association is statistically significant. |

## Known Limitations

- Event probability and generic correlation are **API/MCP-only** -- they have no web UI. They are designed for AI-driven analysis (e.g., asking Claude "what's the probability of a headache after poor sleep?").
- The Pearson correlation coefficient requires at least 3 data points and only measures linear relationships. Non-linear associations won't be captured.
- Correlation does not imply causation. A strong correlation between two events might be caused by a third, unmeasured factor.
- Tag correlations look at a 30-minute window before the tag, which means the HRV/HR values reflect your state leading into the tagged event, not necessarily caused by it.
- Auto-sync is triggered before correlation computation, which may add a brief delay on the first load.
