# Dashboard

The Dashboard is the home page for logged-in users. It presents your key health metrics, trends, and navigation links as a customizable grid of widgets organized into sections. Every user starts with a sensible default layout, but can rearrange, add, or remove widgets to surface what matters most to them.

## Default Layout

New users see four sections out of the box:

### Your Baseline

A card grid showing your current HRV and resting heart rate averages over 7-day and 30-day windows. Each card displays the current value, unit, and a trend arrow showing the direction of change. Resting HR uses inverse coloring (green when decreasing, since lower is generally better).

### 30-Day Summary

A mix of metric cards and sparklines covering sleep score (with a mini chart of recent history), readiness score, daily steps, and weekly Zone 2 minutes. The Zone 2 card converts raw seconds into weekly minutes and shows the target range.

### Activity

A full-width activity summary card showing workouts (count and total minutes), average sleep duration (hours and nights tracked), and meditation sessions (count and total minutes) for the last 7 days.

### Explore

A grid of quick-link tiles for navigating to Timeline, Sleep, HR Zones, Correlations, Goals, and Places.

## Widget Types

### Metric Card

Displays a single metric value with an optional unit, trend indicator, and subtitle. The trend arrow is green for improvement, red for decline, and gray for no change. Supports an `inverse` mode where lower values are considered better (e.g., resting heart rate).

Values are sourced from either the HRV/HR baseline endpoint (for 7-day and 30-day averages) or the period summary (for everything else). The period summary compares the current 30-day window against the previous 30 days to calculate the trend percentage.

**Configuration:** Metric name, title, optional unit, optional subtitle, optional inverse trend.

### Sparkline Card

Like a metric card, but with a small area chart underneath showing the metric's recent history. The sparkline renders a smooth curve with a filled area and a dot on the latest data point. Useful for seeing at a glance whether a metric is trending up or down.

**Configuration:** Metric name, optional title (auto-derived from metric name), lookback period (7-365 days, default 30), chart color (default blue).

### Activity Summary

Shows workout, sleep, and meditation statistics for a configurable recent period. Each category displays as a colored sub-card with an icon, a primary value (count or average), and a secondary detail line (total minutes or nights tracked). Individual categories can be toggled off.

**Configuration:** Lookback period (1-30 days, default 7), toggle for each category (workouts, sleep, meditation).

### Trend Chart

A full-width EMA (Exponential Moving Average) trend chart for any tag or metric. Shows a smoothed trend line over time with the current rate displayed. Useful for tracking things like supplement intake frequency, weight changes, or exercise patterns over weeks or months.

**Configuration:** Source type (tag or metric), pattern (tag regex or metric name), half-life (default 15 days), lookback period (default 90 days), display period (daily/weekly/monthly), aggregation method (count/sum/mean).

### Correlation Impact

Shows how a specific activity, tag, or location affects your HRV. Displays three bars: "before" (baseline), "during" (the activity), and "after" (recovery), showing the average HRV in each phase. Includes an occurrence count so you can judge the statistical weight.

**Configuration:** Activity type (tag, activity, location, productivity category, or app), activity name, analysis period (default 90 days), window size in minutes before/after (default 30).

### Quick Link

A clickable navigation tile with a colored icon and label. Links to any page in Aurboda. Available icons cover Timeline, Sleep, HR Zones, Correlations, Goals, Places, Trends, and Settings.

**Configuration:** Target URL, label text, optional icon.

## Sections

Widgets are organized into sections, each with a title and a layout type:

| Section type | Layout | Best for |
|---|---|---|
| **Metrics** | Responsive card grid (auto-fills columns, minimum 200px wide) | Metric cards, sparklines, activity summaries |
| **Charts** | Single column, full width | Trend charts, correlation charts |
| **Links** | Responsive grid of smaller tiles (minimum 140px wide) | Quick-link navigation |

Sections are collapsible -- click the section header to toggle between expanded and collapsed. On wide screens, multiple sections can appear side by side.

## Editing the Dashboard

Click the pencil icon next to the "Dashboard" title to enter edit mode.

### In edit mode, you can:

- **Add a widget**: Click the "+ Add Widget" placeholder in any section. A dialog opens showing the widget types compatible with that section. Select a type, configure it (e.g., pick a metric, set a lookback period), and confirm.
- **Remove a widget**: Click the X button on any widget.
- **Reorder widgets**: Use the up/down arrows on each widget to move it within its section.
- **Add a section**: Click "Add Section" at the bottom. Give it a title and choose a type (Metrics, Charts, or Links).
- **Delete a section**: Click the trash icon next to a section title. Confirms before deleting the section and all its widgets.
- **Reset to defaults**: Click "Reset to Default" to restore the original 4-section layout. Your customizations will be lost.

Every change saves immediately -- there is no separate "Save" button. Click "Done Editing" to exit edit mode.

### Metric Picker

When adding a Metric Card or Sparkline Card, the metric picker shows a searchable dropdown of all available metrics grouped into "Built-in" (HRV, resting HR, sleep score, steps, zones, weight, etc.) and "Custom" (any user-defined metrics). You can filter by typing, and both the friendly label and the raw metric key are shown.

## What Data It Needs

The dashboard works with whatever data sources you have connected. Widgets gracefully handle missing data -- a metric card with no data simply shows no value. The more sources you connect, the more useful the dashboard becomes:

| Widget content | Data sources |
|---|---|
| HRV and resting HR baselines | Oura, Garmin, or Health Connect |
| Sleep score | Oura |
| Readiness score | Oura |
| Steps | Garmin or Health Connect |
| Zone 2 minutes | Any source providing HR during exercise |
| Activity summary | Any activity source |
| Trend charts | Depends on what you're trending (tags, metrics) |
| Correlation impact | HRV data + the activity/tag you're analyzing |

## Known Limitations

- Widgets cannot be moved between sections -- only reordered within a section.
- There is no drag-and-drop; reordering uses up/down arrow buttons.
- The dashboard is not available via MCP tools -- it is managed through the web UI only.
- Sparkline cards fetch up to 365 days of time-series data, which may be slow for very high-frequency metrics like heart rate. Use metric cards for those.
