# Dashboard

The Dashboard is the home page for logged-in users. It presents your key health metrics, trends, and navigation links as a customizable grid of widgets organized into sections. Every user starts with a sensible default layout, but can rearrange, add, or remove widgets to surface what matters most to them.

## Get started guide

Above the widgets, a new account sees a **Get started** checklist of five steps, each ticked off as
soon as Aurboda sees it happen:

| Step                                | Done when                                                             |
| ----------------------------------- | --------------------------------------------------------------------- |
| Install the Android app             | Health Connect records arrived in the last 30 days                    |
| Connect your watch or ring          | Garmin, Oura or Strava is connected                                   |
| Track time at your computer         | ActivityWatch desktop screen time arrived in the last 7 days          |
| Follow a friend or join a challenge | You follow someone or take part in a challenge                        |
| Ask your data questions             | You press **Mark as done** (Aurboda cannot see your AI assistant ask) |

The computer step carries the [one-line ActivityWatch installer](../activitywatch.md#quick-install)
inline. The guide disappears once all five are done, or for good with **Hide this guide**. The
dismissal and the steps marked done by hand are user settings, so REST
(`PATCH /api/user/settings`) and MCP (`update_user_settings`) read and set them too:
`onboarding_dismissed_at` (an ISO date-time; `null` shows the guide again) and
`onboarding_manual_done` (step ids: `android_app`, `wearable`, `computer_time`, `social`,
`ask_ai`). While the guide shows, it makes a few small requests; once it is hidden, none.

## Default Layout

New users see five sections out of the box:

### Today

A full-width **Latest activities** card titled "Activities": up to five of today's activities, newest
first (see [Latest Activities](#latest-activities)).

### Your Baseline

A card grid showing your current HRV and resting heart rate averages over 7-day and 30-day windows. Each card displays the current value, unit, and a trend arrow showing the direction of change, coloured by whether the change is better or worse (see [Trend direction](#trend-direction)).

### 30-Day Summary

Opens with a **Last night** card for the most recent sleep, followed by a mix of metric cards and sparklines covering sleep score (with a mini chart of recent history), readiness score, daily steps, and weekly Zone 2 minutes. The Zone 2 card converts raw seconds into weekly minutes and shows the target range.

### Activity

A full-width activity summary card showing workouts (count and total minutes), average sleep duration (hours and nights tracked), and meditation sessions (count and total minutes) for the last 7 days.

### Explore

A grid of quick-link tiles for navigating to Timeline, Sleep, HR Zones, Correlations, Goals, and Places.

## Widget Types

### Metric Card

Displays a single metric value with an optional unit, trend indicator, and subtitle. The trend arrow is coloured by the metric's [trend direction](#trend-direction); the card's `trend_inverse: true` overrides it with "lower is better".

Values are sourced from either the HRV/HR baseline endpoint (for 7-day and 30-day averages) or the period summary (for everything else). The period summary compares the current 30-day window against the previous 30 days to calculate the trend percentage. Averages of heart rate, stress, body battery, respiration and SpO2 are [time-weighted](../data-storage.md#time-weighted-averages), so the hours of a recorded activity, sampled once a second, weigh no more than any other hour.

On a [period dashboard](#period-dashboards) the card shows the period's value and, unless the card has its own subtitle, `Previous: <value>` for the previous period (`previous_value` in the widget data); the trend arrow is the change against it.

**Configuration:** Metric name, title, optional unit, optional subtitle, optional inverse trend.

### Sparkline Card

Like a metric card, but with a small area chart underneath showing the metric's recent history. The sparkline renders a smooth curve with a filled area and a dot on the latest data point. Useful for seeing at a glance whether a metric is trending up or down.

**Configuration:** Metric name, optional title (auto-derived from metric name), lookback period (7-365 days, default 30), chart color (default blue).

### Last Night

A summary of the most recent sleep that ended within the last 36 hours, for a quick morning check-in. Shows bedtime and wake-up, the sleep score and total sleep, a stage strip (one coloured segment per stage along the night), minutes of deep, light, REM and awake, resting heart rate and overnight HRV with an arrow against their 30-day averages, and Body Battery from bedtime to wake-up with the change. The card links to the sleep's detail page. Data comes from `GET /api/latest-sleep` (MCP: `get_latest_sleep`); when no sleep was recorded it says so.

**Configuration:** Optional title (default "Last night").

### Sleep Debt

The sleep you owe against the sleep need you set in Settings: the debt after the last night, its severity (none, mild, moderate, severe) and a sparkline of the last two weeks. See [Sleep debt](./sleep.md#sleep-debt) for how it is computed. Data comes from `GET /api/sleep-debt` (MCP: `get_sleep_debt`); with no night recorded in the last six weeks it says so.

**Configuration:** Optional title (default "Sleep debt").

### Activity Summary

Shows workout, sleep, and meditation statistics for a configurable recent period. Each category displays as a colored sub-card with an icon, a primary value (count or average), and a secondary detail line (total minutes or nights tracked). Individual categories can be toggled off. Each category is the roll-up of the `exercise`, `meditation` or `sleep` activity type with its subtypes (so naps count as sleep), the same figures an [activity card](#activity-card) of that type shows for the same window; a hidden category is not queried.

**Configuration:** Lookback period (1-30 days, default 7), toggle for each category (workouts, sleep, meditation).

### Trend Chart

A full-width EMA (Exponential Moving Average) trend chart for any tag or metric. Shows a smoothed trend line over time with the current rate displayed. Useful for tracking things like supplement intake frequency, weight changes, or exercise patterns over weeks or months.

**Configuration:** Source type (tag or metric), pattern (tag regex or metric name), half-life (default 15 days), lookback period (default 90 days) or a fixed start date (`since`, see below), display period (daily/weekly/monthly), aggregation method (count/sum/mean).

A trend chart can instead show a **measure's decaying best** (an activity type's `measure`, with `filter_field` and `filter_value` for one exercise): the running best that decays with the half-life (default 120 days) between sessions. Display period and aggregation do not apply, and the title defaults to the exercise and measure, e.g. "Squat · Best e1RM". Add one from an exercise's Trend chart menu or from the Chart Explorer's **Trend (best)**.

### Bar Chart

A full-width bar chart of bucketed values (`GET /chart-data`) for an activity type, metric or screentime category, optionally broken down into one stacked series per value of a categorical field.

**Configuration:** Source type, pattern, bucket size, lookback period, aggregation (count/sum/mean/max), optional breakdown fields. For an activity type with list items (strength sets), `measure` charts that measure of each session instead of its duration or count, `filter_field`/`filter_value` (e.g. `sets.exercise` = `Bench Press`) take it over one exercise's items, and a `sets.exercise` breakdown gives one series per exercise (see [Activity Types: Exercises and measures](activity-types.md#exercises-and-measures)).

A trend or bar chart can have a fixed start instead of a rolling lookback: `since` (`YYYY-MM-DD`) charts from that date up to today and wins over `lookback_days`. Bars start at the date's midnight and a trend looks back the whole days from the date to today, in the viewer's timezone on your own board and in the owner's timezone on a shared one. The Chart Explorer's **Since…** range saves it this way. A period dashboard's window still overrides it, as it does every lookback.

### Combined Chart

Bars and one or more trend lines drawn over one time axis and one y scale, like an exercise's
weekly best e1RM with its decaying best over it. Add one from an exercise page's chart menu
(**Add to dashboard** when the line is drawn), from a charts section's add-widget dialog, or through the
API or MCP. The dialog adds a starter chart (weekly `coffee` counts with their weekly trend over 90
days); it has no form for the layers.

**Configuration:** optional `title` (default "Combined chart"), `lookback_days` shared by every
layer, and `layers`, a list of typed layers drawn in order:

- `{ "kind": "bars", ... }` takes a bar chart's source fields (`source_type`, `pattern`,
  `bucket_size`, `aggregation`, `measure`, `filter_field`, `filter_value`, `tag_definition_id`);
- `{ "kind": "trend", ... }` takes a trend chart's source fields (`source_type`, `pattern`,
  `half_life_days`, `aggregation`, `display_period`, `missing_days`, `measure`, `filter_field`,
  `filter_value`, `tag_definition_id`) and an optional line `color`.

A layer has no title, lookback or breakdown of its own. For now a combined chart has exactly one
`bars` layer and one to three `trend` layers; that rule may be relaxed as more layer kinds are
added. The first trend line without a `color` takes the usual line colour, later ones the
breakdown palette. On a shared dashboard a layer that cannot be resolved is drawn without data
while the others still show.

```json
{
  "type": "combined_chart",
  "config": {
    "lookback_days": 365,
    "layers": [
      {
        "kind": "bars",
        "source_type": "activity_type",
        "pattern": "strength_training",
        "bucket_size": "1w",
        "aggregation": "max",
        "measure": "e1rm",
        "filter_field": "sets.exercise",
        "filter_value": "Bench Press"
      },
      {
        "kind": "trend",
        "source_type": "activity_type",
        "pattern": "strength_training",
        "half_life_days": 120,
        "measure": "e1rm",
        "filter_field": "sets.exercise",
        "filter_value": "Bench Press"
      }
    ]
  }
}
```

### Record Card

The best value of one activity measure with the date it was first reached and, for e1RM and max
weight, the set behind it, e.g. "Bench Press · Best e1RM: 39.5 kg, 21 Dec 2025 · 7×32 kg". On your
own dashboard the date links to that session. Add one from the ⋮ menu on an exercise page's record
card, from a metrics section's add-widget dialog (activity type, record measure and an optional
exercise), or through the API or MCP; it is placed in a metrics section.

**Configuration:** `source_type` (`activity_type`), `pattern` (the activity type), `measure` (one of
the record measures `e1rm`, `max_weight`, `max_time`, `max_reps`), optional `filter_field` +
`filter_value` (both or neither, e.g. `sets.exercise` = `Bench Press`), optional `lookback_days`
(all time when absent) and optional `title` (default "<value or type> · <measure>"). Data comes
from `GET /activity-types/:name/records` (MCP: `get_activity_records`).

### Activity Card

One activity type (its subtypes included) rolled up over the card's window: the number of sessions as
the headline, then the total time and, where the sessions carry a distance, the total distance and
either the best pace (min/km) or the average speed (km/h). For `sleep` it also shows the average
night, the best night and the average minutes of REM, deep and light sleep over the nights that have
stages. On a period dashboard the sessions, time, distance and average night carry a change against
the previous period. Add one from a metrics section's add-widget dialog (activity type, title, an
optional exercise and pace or speed), from the ⋮ menu on an exercise page's record card ("Add
activity card"), or through the API or MCP. Activity types other than the built-in `exercise` and
`sleep` are your own, so add a card per type you want to follow -- running, cycling, a gym visit type.

**Configuration:** `pattern` (the activity type), optional `filter_field` + `filter_value` (both or
neither: a data field, or an item path such as `sets.exercise`), optional `lookback_days` (default 30;
a period dashboard uses its period), optional `speed_display` (`pace` or `speed`; default `pace` for
types whose name contains `run`, `walk` or `hik`, else `speed`) and optional `title` (default the
type's display name). Data comes from `GET /activity-types/:name/summary?start&end` (MCP:
`get_activity_type_summary`).

### Top List Card

One source's total over the card's window as the headline, with its change against the previous
period on a period dashboard, then its top entries: music plays by artist, album or track
(`1,760 plays`, `506 artists`), screen time by app (`151 h`, `4.9 h/day`, `38 apps`; categories
excluded from screen time are left out) or visits by place (`55 visits`, `12 places`). Add one from a
metrics section's add-widget dialog (source, plays from, limit, title) or through the API or MCP.

**Configuration:** `source` (`media_artist`, `media_album`, `media_track`, `screentime_app` or
`place`), optional `media_source` for a `media_*` source (`lastfm` for Last.fm scrobbles only,
`mpris` for the MPRIS logger only; all plays when absent, see
[Querying media](../media.md#querying)), `limit` (1--10, default 3; a place list shows at most 5), optional `lookback_days` (default
30; a period dashboard uses its period) and optional `title` (default "Top artists", "Top albums",
"Top tracks", "Top apps" or "Top places"). Data comes from `GET /media/plays/top` (MCP:
`query_top_media`), `GET /productivity/top-apps` (`query_top_apps`) and
`GET /locations/places-summary` (`get_places_summary`).

### Places Card

Where the nights of the card's window were spent: one row per named place with its nights, then the
nights elsewhere (at a place that is not a named location) and the nights without location data, then
the number of distinct named places, with changes against the previous period on a period dashboard
(the nights per place, the nights elsewhere and the distinct places). Below them, the five named places
with the most nights and the hours spent at each. A night goes to the place the user was at 03:00 the
next morning, a phone at rest included (see [Places summary](places.md#places-summary)).

**Configuration:** optional `lookback_days` (default 30; a period dashboard uses its period) and
optional `title` (default "Places"). The schema still accepts `home_location`, which the editor no
longer offers. Data comes from `GET /locations/places-summary` (MCP: `get_places_summary`).

### Day Overview

One day at a glance on a single time axis, like a watch app's day chart: the first metric as thin
bars per 5 minutes (stress coloured by its band: rest, low, medium, high; any other metric in the
accent colour), the second as a line with a soft area on its own scale (Body Battery 0–100), sleep
and naps shaded behind the plot, and the other activities of the Timeline's Activity lane as round
icons along the axis at their start time (icons that would overlap collapse into one "+N" bubble;
hover one for the names and times). The header shows the window's dates, the latest value of the
line metric and the average of the bar metric. The whole card links to the [Timeline](./timeline.md)
at that range. With nothing recorded in the window it says so ("No data for the last 24 hours").

**Configuration:** `window`, one of `rolling_24h` (the 24 hours up to now, default), `yesterday` or
`today` (local days); `metrics`, one or two metric names (default `stress_level`, `body_battery`):
the first drawn as bars, the second as the line; optional `title` (default "Last 24 hours",
"Yesterday" or "Today"); optional `visible_to_visitors` (default false), whether visitors of a
shared dashboard see the card. Your own card reads the bucketed metrics (`GET /metrics/bucketed`,
5-minute buckets) and the activities (`GET /activities`) of the window; it has no endpoint of its own.

The editor offers it on every rolling dashboard, the home one and the others. It does not follow a
period dashboard's period, so a period dashboard's editor does not offer it, and on a period
dashboard it resolves to no data.

Visitors see it only when you turn on **Show to visitors** (`visible_to_visitors: true`); it is off
by default, so a day overview you had before, for example on a copy of the home dashboard, stays
private. The editor of every dashboard but the home one shows the switch with a warning: visitors of
the dashboard then see the whole day hour by hour, the two metrics in 5-minute steps, when you slept
and napped, and the name and start time of every activity. The switch is in the add dialog and, in
edit mode, on the card itself, so a day overview already on the dashboard can be turned on too. With
the switch off, the card on a dashboard other than home carries the note "Only you see this card". For visitors the server
resolves the card from the stored config alone, in your timezone: the axis span, the two metrics per
5-minute bucket, sleep and naps clipped to the span (labelled with the type's name) and the
activities of the Timeline's Activity lane that start in it (their title, else the type's name, with
the type's icon and colour). The visitor's card shows hours and dates in your timezone and does not
link to the Timeline.

### Latest Activities

What you have logged, as a list like Garmin Connect's "Today's Activity": one row per activity,
newest first, with a round icon in the type's colour (its emoji or image, else the label's initial),
the activity's title (else the type's name), a line of figures under it and the start time at the
right. The figures line starts with the type's name when the row shows a title, then up to three of
duration, distance, pace (running, walking and hiking types) or speed, the number of sets, average
heart rate and calories, whichever the activity has, followed by the values of the type's
**Show in summary** data fields the activity has (a supplement's `Zinc · mg`), with their units. The time is just the clock time for today,
"Yesterday 18:30" for yesterday and "16 Nov 18:30" before that. Each row links to the activity's
detail page. With nothing to list it says so ("Nothing logged today", "No activities in the last
30 days"), and the home card's empty "today" state links to **Add** ("Log an activity").

**Configuration:** `window`, `today` (every activity that overlaps today in your timezone, default:
one that started before midnight and ended after it, or is still running, is listed too) or `latest` (the most
recent ones looking back `lookback_days`, default 30, at most 365); `limit`, 1 to 20 (default 5);
optional `types` and `exclude_types` (activity type names, each with its subtypes); optional
`manual_only`; optional `title` (default "Today" with `window: today`, else "Latest activities");
optional `visible_to_visitors` (default false).

- **Which activities.** Without `types`, the card lists the types a [day overview](#day-overview)
  draws as icons: types shown on the timeline whose display category is an activity one (sleep and
  rest, exercise, meditation, wellness), minus sleep, naps and the sleep subtypes. So screen time,
  music scrobbles, calendar events, location visits and the "other"-category tags stay out. With
  `types`, exactly those types and their subtypes are listed, whatever their category or timeline
  setting, so `types: ['sleep']` or `['coffee']` works. `exclude_types` (with subtypes) is taken out
  in both cases. In the editor, the activity types are chips with a picker to add one; none chosen
  means the default selection.
- **Merged once.** A cross-source duplicate shows once, as on the Timeline; its link goes to the
  merged activity (`merged:<id>`).
- **Manual only.** `manual_only: true` (the editor's **Only activities logged by hand**) keeps only
  activities logged in Aurboda itself, an uploaded FIT file included; an edit of a synced activity
  (an override) and a merge that includes a synced activity do not count.
- **Period dashboards.** The card applies to a period: it lists the latest `limit` activities that
  overlap the shown period and ignores `window` and `lookback_days` (the editor hides both there).
- **Visitors.** Like the day overview, visitors of a shared dashboard see the card only when you turn
  on **Show to visitors**, with the warning that they then see each listed activity's name, start
  time and duration, and its distance, sets, average heart rate and calories where it has them, and
  its type's summary fields. A visitor's rows carry no activity id and do not link. With the switch on, sharing a period of the
  dashboard to your feed carries the same rows in the post. Your own reads of a dashboard's data
  always answer the card, with the ids.
- **API.** The card reads `GET /activities/recent` (query `limit`, `window`, `lookback_days`,
  `types` and `exclude_types` comma-separated, `manual_only`, `tz`: the timezone "today" is cut in,
  your setting when absent); MCP: `get_recent_activities`. On a period dashboard, and for visitors,
  it is resolved with the rest of the dashboard's data.

### Correlation Impact

Shows how a specific activity, tag, or location affects your HRV. Displays three bars: "before" (baseline), "during" (the activity), and "after" (recovery), showing the average HRV in each phase. Includes an occurrence count so you can judge the statistical weight.

**Configuration:** Activity type (tag, activity, location, productivity category, app, or meal sensitivity), activity name, analysis period (default 90 days), window size in minutes before/after (default 30). For `meal_sensitivity` the activity is the sensitivity flag's id, and the editor offers a select of your flags; the card's default title names the flag ("Meals with gluten impact"), resolved when the card is read, so renaming the flag renames the card. A shared dashboard's resolved data carries the name as `activity_label`.

### Quick Link

A clickable navigation tile with a colored icon and label. Links to any page in Aurboda. Available icons cover Timeline, Sleep, HR Zones, Correlations, Goals, Places, Trends, and Settings.

**Configuration:** Target URL, label text, optional icon.

## Trend direction

Every trend indicator -- on metric, sparkline, activity, top list and places cards, the **Last night**
card and the [Sleep page](sleep.md) -- colours a change by whether it is an improvement, not by
whether it went up: green for better, red for worse, grey for a change that is neither. The word goes
with the colour as the indicator's label ("12.0% lower, better"), so the colour is not the only cue.

The direction belongs to the metric (`metricBetterDirections` in `@aurboda/api-spec`):

- **Higher is better:** HRV, sleep score and the sleep contributor scores (efficiency, latency,
  restfulness, timing, deep, REM, total), readiness and steps.
- **Lower is better:** resting heart rate, stress and body fat.
- **Neutral:** every other built-in metric (weight, for one), and counts of activities, places and
  top-list entries.

A custom metric has the same setting, `better: 'higher' | 'lower' | 'neutral'` (default neutral), in
its form under Settings → Custom Metrics and on its metric page, in `POST`/`PATCH /metrics/custom`
and in the `add_custom_metric` / `update_custom_metric` MCP tools. A visitor of a shared dashboard
sees built-in metrics with their direction and custom metrics as neutral.

## Sections

Widgets are organized into sections, each with a title and a layout type:

| Section type | Layout                                                        | Best for                                                                                            |
| ------------ | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **Metrics**  | Responsive card grid (auto-fills columns, minimum 200px wide) | Metric cards, sparklines, activity summaries, record cards, activity cards, top lists, places cards |
| **Charts**   | Single column, full width                                     | Trend charts, combined charts, correlation charts, day overviews, latest activities                 |
| **Links**    | Responsive grid of smaller tiles (minimum 140px wide)         | Quick-link navigation                                                                               |

Sections are collapsible -- click the section header to toggle between expanded and collapsed. On wide screens, multiple sections can appear side by side. In edit mode each section header has up and down arrows to reorder the sections.

## Descriptive text

While editing a dashboard you can add optional prose (both fields are plain text
and optional, so existing dashboards are unaffected):

- A **dashboard description** shown under the title. For a [shared dashboard](./sharing.md)
  this also feeds the link-preview / `og:description`, so a pasted link reads well.
- A **per-section intro** rendered above that section's widgets, so the page reads
  as a narrative rather than just a wall of charts.

## Period dashboards

A dashboard is either **rolling** (the default: every widget has its own lookback ending now) or a
**calendar-period** dashboard with a granularity of **week**, **month** or **year**. A period
dashboard shows one finished period -- October 2026, ISO week 44 of 2026, the year 2025 -- and every
widget renders against that one window, ignoring the lookbacks in its configuration.

- **The setting.** In edit mode, the **Period** select above the description switches the dashboard
  between Rolling, Weekly, Monthly and Yearly. It is stored in the config as
  `period: { granularity: 'week' | 'month' | 'year' }`; absent means rolling.
- **Period keys.** A period is named by a key: `2026-10` (month), `2026-W44` (ISO week, Monday
  start, in the ISO week-year) or `2026` (year). Its bounds are calendar days in your timezone
  (the device timezone in your settings; UTC when unset), the end exclusive.
- **Finished periods only.** The dashboard opens on the latest finished period. A switcher above the
  widgets steps back and forth between finished periods; the next button stops at the latest one.
  A chosen period is kept in the URL as `?period=2026-09`, so it survives a reload and can be linked;
  the latest period has no parameter.
  Asking for a period that has not ended (or a malformed one) is a 400.
- **Previous-period deltas.** Figures compare with the previous calendar period of the same kind
  (September for October, the previous ISO week, the previous year) -- not an equal-length rolling
  window. Metric and sparkline cards carry `previous_value` and a `trend_percent` against it; the
  activity summary carries `previous_count`, `previous_total_minutes` and `previous_avg_hours`; an
  activity card carries `previous_count`, `previous_total_minutes`, `previous_distance_km` and
  `previous_sleep_avg_minutes`; a top list carries `previous_total`; a places card carries
  `previous_nights_by_place`, `previous_nights_elsewhere`, `previous_nights_away`,
  `previous_distinct_places` and `previous_visits`; HR zones carry
  `previous_avg_seconds`.
- **Loaded once.** A finished period's figures only change when the dashboard's config does (saving
  it reloads them), so the web app does not refetch a period dashboard when its tab regains focus
  or the network comes back. The last few answers are kept in the tab's `sessionStorage`, so a tab
  the browser discarded in the background reopens without waiting for the server — an answer for
  "the latest period" only on the day it was fetched — and the scroll position per dashboard and
  period is restored with it. Logging out clears them.
- **Baselines.** The 7- and 30-day HRV and resting HR baseline cards become the period average of
  `hrv_rmssd` and `resting_heart_rate`.
- **Widgets that do not apply.** **Last night**, **Sleep debt** and **Goal progress** have no meaning for a past
  period: the widget palette hides them, and existing ones show "Not available for a period".
  **Latest activities** does apply: it lists the latest activities that overlap the period.
- **API.** `GET /dashboard/data?period=2026-10` (the home dashboard) and
  `GET /shared-dashboards/:id/data?period=2026-10` (a shared one) return `period`, `window`
  (`start`/`end`, ISO) and `widget_data`; without `period` they answer the latest finished one, and
  for a rolling dashboard `period` and `window` are null. MCP: `get_dashboard_data`.
- **Published.** What visitors of an unlisted or public period dashboard see is its period lock —
  the latest finished period (the default), one fixed period, or every finished period from a chosen
  one on — set on the Dashboards page; see
  [Sharing → Period locks](./sharing.md#period-locks).
- **Sharing a period to the feed.** The **Share to feed** button right of the period switcher
  (on the home dashboard and on your own dashboards) posts the period shown to your
  [feed](feed.md#feed-posts). The post keeps a snapshot of the dashboard's config as it was at
  share time, so editing the dashboard later never changes it, and its figures are resolved from
  that snapshot for that period whenever the post is read. It links the dashboard's public page
  only when the dashboard is unlisted or public and you leave **Link** checked; the home
  dashboard is never linked. Only a finished period can be shared. REST:
  `POST /feed/dashboards` (`/preview` for the preview); MCP: `share_dashboard_period`,
  `preview_dashboard_period_share`.

## Editing the Dashboard

Click the pencil icon next to the "Dashboard" title to enter edit mode.

### In edit mode, you can:

- **Add a widget**: Click the "+ Add Widget" placeholder in any section. A dialog opens showing the widget types compatible with that section. Select a type, configure it (e.g., pick a metric, set a lookback period), and confirm.
- **Remove a widget**: Click the X button on any widget.
- **Move widgets**: On a desktop (a mouse or trackpad), grab a widget by its grip handle and drop it
  where it should go: an accent bar shows whether it lands before or after the card under the pointer
  (beside it in a multi-column grid, above or below it in a single column), and a dashed outline marks
  a section it would be added to the end of. Widgets can be dropped into another section, including an
  empty one, but not into a collapsed one. The up/down arrows on each widget move it one step within
  its section, and are the way to reorder on touch devices, where the grip is hidden.
- **Add a section**: Click "Add Section" at the bottom. Give it a title and choose a type (Metrics, Charts, or Links).
- **Rename a section**: Click the pencil icon next to a section title, edit the title inline, and press Enter (or click away) to save. Press Escape to cancel.
- **Delete a section**: Click the trash icon next to a section title. Confirms before deleting the section and all its widgets.
- **Reset to defaults**: Click "Reset to Default" to restore the original 4-section layout. Your customizations will be lost.

Every change saves immediately -- there is no separate "Save" button. Click "Done Editing" to exit edit mode.

### Updating a chart from the chart explorer

Every chart widget links to the [Chart Explorer](./trends.md) (`/chart`), carrying an
identifier for the exact board widget it came from. On the chart page you can tweak the
source, lookback, aggregation, or chart type, then click **"Update Chart in _&lt;board&gt;_ /
_&lt;section&gt;_"** at the bottom to replace that widget in place with the new configuration
(and optionally give it a new title). On save you are taken straight back to that
dashboard. This works for both your home dashboard and any shared dashboard you own.

Chart widgets preserve a **breakdown** (splitting an activity type into series by a
categorical field, e.g. by partner or intensity): the breakdown is saved with the
widget and rendered as multiple coloured series with a legend, both on your own
dashboards and on public shared boards.

When adding or updating a chart on a board, you can **mask** individual breakdown
fields for public viewers: in the Add-to-dashboard / Update-chart form, tick the
fields to hide under "Mask on public boards". Masked field values are replaced with
stable positional labels (A, B, C…) — the breakdown structure and volumes still show,
but the real values (e.g. partner names) never leave the server for a public viewer.
You always see the real values on your own live view.

### Metric Picker

When adding a Metric Card or Sparkline Card, the metric picker shows a searchable dropdown of all available metrics grouped into "Built-in" (HRV, resting HR, sleep score, steps, zones, weight, etc.) and "Custom" (any user-defined metrics). You can filter by typing, and both the friendly label and the raw metric key are shown.

## What Data It Needs

The dashboard works with whatever data sources you have connected. The more sources you connect, the more useful the dashboard becomes.

**Cards waiting for data.** Outside edit mode, the home dashboard and your own period dashboards leave out every card whose source has never delivered anything, so a new account does not open on a wall of `No data`. One line under the last section says how many cards are waiting, with a link to **Data sources**; a card appears by itself once its source sends something. Edit mode shows every card, as before. "Never delivered" is per card: no sample of the metric at all for a metric card, sparkline, HR zones (heart rate) or a metric chart; no activity of the type or one of its subtypes for an activity card, record card, the activity summary (its shown categories), **Last night** (`sleep`) or an activity-type chart. The baseline cards read `hrv_rmssd` and `resting_heart_rate`, and Zone 2 reads `heart_rate`. A card is hidden only when none of its sources has ever delivered: one with data, just none in the current window, still shows `No data`. Tag charts, top lists, places, correlations, goals, latest activities and quick links are always shown. A section left with no card goes too. Shared and public dashboards, and your own rolling dashboards other than home, show every card.

The dashboard asks this in one request for all its metrics and activity types: `GET /dashboard/data-presence?metrics=hrv_rmssd,steps&activity_types=exercise,sleep` answers `{ metrics: { hrv_rmssd: true, steps: false }, activity_types: { … } }`, and MCP has the same as `get_data_presence`.

| Widget content               | Data sources                                    |
| ---------------------------- | ----------------------------------------------- |
| HRV and resting HR baselines | Oura, Garmin, or Health Connect                 |
| Sleep score                  | Oura                                            |
| Last night                   | Any sleep source; Body Battery from Garmin      |
| Sleep debt                   | Any sleep source                                |
| Readiness score              | Oura                                            |
| Steps                        | Garmin or Health Connect                        |
| Zone 2 minutes               | Any source providing HR during exercise         |
| Activity summary             | Any activity source                             |
| Trend charts                 | Depends on what you're trending (tags, metrics) |
| Correlation impact           | HRV data + the activity/tag you're analyzing    |

## Dashboards page and presets

Besides the home dashboard you can have any number of others, each with its own
config. **Dashboards** (`/dashboards`, in the sidebar's Sharing section, and the
**All dashboards** link next to the home dashboard's title) lists the home dashboard
first and then every other one, with its visibility, a View link and, unless it is
private, Copy link. Each one opens and is edited at `/u/<you>/<slug>`.

A new dashboard starts from a preset (the name is prefilled from it until you type
your own) and is **private**:

- **Blank** — no sections.
- **Copy of home** — your home dashboard's current layout.
- **Month in data** — a monthly [period dashboard](#period-dashboards): one finished
  month, compared with the month before. **Body**: a sleep score sparkline, a Sleep
  activity card (average and best night, stages) and cards for steps per day, HRV,
  resting HR, weight and body fat. **Training**: the activity summary, HR zones
  (without targets), a Workouts activity card (`exercise`: sessions, time, distance)
  and workouts per week (a count of `exercise` activities in weekly bars). **Life**:
  Music (a top list of artists), Screen time (a top list of apps) and Places (nights
  home and away, distinct places, the most visited). The preset has no per-sport
  card, since sport types are your own: add an activity card per type (running,
  cycling, a gym visit type) from the editor.

The presets are defined once in `@aurboda/api-spec` (`dashboardPresetConfigs`; `home`
is resolved from your settings on the server), and `POST /shared-dashboards` and the
MCP `create_shared_dashboard` tool take one as `preset` instead of a `config`.

## Sharing

A dashboard other than home can also be shared under your public namespace
(`/u/<username>/<slug>`), either publicly listed or unlisted-by-link. See
[Sharing & Public Pages](./sharing.md) for the visibility model, URLs, and the
backend security guarantee that limits a viewer to exactly the data the dashboard's
widgets render.

## Known Limitations

- On touch devices widgets can only be reordered within a section, with the arrow buttons;
  moving one to another section needs a mouse or trackpad.
- The dashboard layout is managed through the web UI only; MCP can read its data
  (`get_dashboard_data`) but not edit the home dashboard.
- Sparkline cards fetch up to 365 days of time-series data, which may be slow for very high-frequency metrics like heart rate. Use metric cards for those.
