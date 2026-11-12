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

New users see four sections out of the box:

### Your Baseline

A card grid showing your current HRV and resting heart rate averages over 7-day and 30-day windows. Each card displays the current value, unit, and a trend arrow showing the direction of change. Resting HR uses inverse coloring (green when decreasing, since lower is generally better).

### 30-Day Summary

Opens with a **Last night** card for the most recent sleep, followed by a mix of metric cards and sparklines covering sleep score (with a mini chart of recent history), readiness score, daily steps, and weekly Zone 2 minutes. The Zone 2 card converts raw seconds into weekly minutes and shows the target range.

### Activity

A full-width activity summary card showing workouts (count and total minutes), average sleep duration (hours and nights tracked), and meditation sessions (count and total minutes) for the last 7 days.

### Explore

A grid of quick-link tiles for navigating to Timeline, Sleep, HR Zones, Correlations, Goals, and Places.

## Widget Types

### Metric Card

Displays a single metric value with an optional unit, trend indicator, and subtitle. The trend arrow is green for improvement, red for decline, and gray for no change. Supports an `inverse` mode where lower values are considered better (e.g., resting heart rate).

Values are sourced from either the HRV/HR baseline endpoint (for 7-day and 30-day averages) or the period summary (for everything else). The period summary compares the current 30-day window against the previous 30 days to calculate the trend percentage.

On a [period dashboard](#period-dashboards) the card shows the period's value and, unless the card has its own subtitle, `Previous: <value>` for the previous period (`previous_value` in the widget data); the trend arrow is the change against it.

**Configuration:** Metric name, title, optional unit, optional subtitle, optional inverse trend.

### Sparkline Card

Like a metric card, but with a small area chart underneath showing the metric's recent history. The sparkline renders a smooth curve with a filled area and a dot on the latest data point. Useful for seeing at a glance whether a metric is trending up or down.

**Configuration:** Metric name, optional title (auto-derived from metric name), lookback period (7-365 days, default 30), chart color (default blue).

### Last Night

A summary of the most recent sleep that ended within the last 36 hours, for a quick morning check-in. Shows bedtime and wake-up, the sleep score and total sleep, a stage strip (one coloured segment per stage along the night), minutes of deep, light, REM and awake, resting heart rate and overnight HRV with an arrow against their 30-day averages, and Body Battery from bedtime to wake-up with the change. The card links to the sleep's detail page. Data comes from `GET /api/latest-sleep` (MCP: `get_latest_sleep`); when no sleep was recorded it says so.

**Configuration:** Optional title (default "Last night").

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

### Correlation Impact

Shows how a specific activity, tag, or location affects your HRV. Displays three bars: "before" (baseline), "during" (the activity), and "after" (recovery), showing the average HRV in each phase. Includes an occurrence count so you can judge the statistical weight.

**Configuration:** Activity type (tag, activity, location, productivity category, or app), activity name, analysis period (default 90 days), window size in minutes before/after (default 30).

### Quick Link

A clickable navigation tile with a colored icon and label. Links to any page in Aurboda. Available icons cover Timeline, Sleep, HR Zones, Correlations, Goals, Places, Trends, and Settings.

**Configuration:** Target URL, label text, optional icon.

## Sections

Widgets are organized into sections, each with a title and a layout type:

| Section type | Layout                                                        | Best for                                                                                            |
| ------------ | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **Metrics**  | Responsive card grid (auto-fills columns, minimum 200px wide) | Metric cards, sparklines, activity summaries, record cards, activity cards, top lists, places cards |
| **Charts**   | Single column, full width                                     | Trend charts, combined charts, correlation charts                                                   |
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
- **Widgets that do not apply.** **Last night** and **Goal progress** have no meaning for a past
  period: the widget palette hides them, and existing ones show "Not available for a period".
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

The dashboard works with whatever data sources you have connected. Widgets gracefully handle missing data -- a metric card with no data simply shows no value. The more sources you connect, the more useful the dashboard becomes:

| Widget content               | Data sources                                    |
| ---------------------------- | ----------------------------------------------- |
| HRV and resting HR baselines | Oura, Garmin, or Health Connect                 |
| Sleep score                  | Oura                                            |
| Last night                   | Any sleep source; Body Battery from Garmin      |
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
