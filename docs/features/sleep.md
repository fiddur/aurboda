# Sleep Analysis

Aurboda provides dedicated sleep tracking and analysis. The Sleep page shows your sleep quality trends over configurable periods, while the sleep detail view gives you a full breakdown of individual sessions including a hypnogram, Oura scores, and HR/HRV overlays.

## The Sleep Page

The page at `/sleep` shows your sleep quality and sleep debt over a selectable period (7, 14, 30, 60, or 90 days).

### Overview Stats

Four cards at the top show key metrics with trend arrows comparing to the previous period, coloured green when the change is better and red when it is worse (see [Trend direction](dashboard.md#trend-direction)):

- **Sleep Score** -- Overall quality (from Oura), averaged over the period.
- **Duration** -- Average hours of actual sleep per night (excluding awake time).
- **Efficiency** -- Time asleep vs. time in bed (percentage).
- **Latency** -- Oura's latency score: how quickly you fell asleep (a score, higher is better).

### Sleep Score Trend

A line chart showing your nightly sleep score over time with a dashed average line. The chart uses a blue gradient fill and shows individual data points.

### Sleep Duration Bars

A bar chart showing hours of sleep per night, color-coded:

- **Green** (7-9 hours) -- optimal range, highlighted as a target zone band.
- **Yellow** (6-7 or 9+ hours) -- caution range.
- **Red** (under 6 hours) -- insufficient sleep.

A dashed average line shows your overall average.

### Sleep Debt

The sleep you owe against your sleep need -- see [Sleep debt](#sleep-debt) below. The section shows the debt after the last night of the period, its severity, your sleep need, and a bar per date colored by severity, with a dashed line at one night's need. A faded bar is a date with no night recorded.

### Sleep Components

Five Oura sleep sub-scores (when available): Total Score, Deep Sleep, REM Sleep, Restfulness, and Timing. Each shows the period average with a trend percentage.

## Sleep Detail View

Clicking a sleep session (from the Timeline, Data Browser, or elsewhere) opens a detailed view showing:

### Hypnogram

A colored chart showing your progression through sleep stages over the night:

- **Awake** (amber, top)
- **REM** (purple)
- **Light** (light blue)
- **Deep** (indigo, bottom)

Heart rate (red), HRV (teal), stress and Body Battery can be overlaid on the hypnogram. Each stage is also drawn as a faint band of its colour across the chart's full height, so every metric can be read against the stage it happened in. Hovering shows exact values at any point in time.

A sleep or a nap has no HR Zones section: a night is almost all rest, which says nothing.

### Sleep Metrics

When connected to Oura: Sleep Score, Efficiency, Restfulness, Deep Score, and REM Score displayed as metric cards.

Time fields show "In Bed" (total time in bed), "Asleep" (actual sleep time excluding awake periods), and average HRV during the session.

### Additional Context

- **Music** playing during the session (via Last.fm).
- **Sleep location** -- the place where you slept, determined by finding the location visit with the longest overlap during the sleep window.
- **Source records** -- if the sleep was merged from multiple sources (e.g., Oura + Health Connect), shows each source with links.
- **Notes** -- attach comments to any sleep session.

## Primary vs. Evening Sleep

The daily summary distinguishes two sleep slots:

- **Primary sleep**: The session you woke up from on a given date. This is the session Oura's sleep score evaluates.
- **Evening sleep**: The session that started in the evening and continues into the next day.

Sleep dates use the **wake-up convention**: a session starting at 11pm on March 7 and ending at 7am on March 8 has a sleep date of March 8.

## Sleep Debt

Sleep debt is judged against a sleep need **you set**: `sleep_need_minutes` in your settings (Settings → Sleep on the web, entered in hours; `update_user_settings` over MCP; `PATCH /api/user/settings`). It defaults to 480 minutes (8 hours) and takes 180–720; null resets it to the default.

Each date, in your timezone, moves the debt by one step of an exponential-decay model:

```
debt = max(0, debt × 0.85 + need − slept)
```

- **slept** is the total sleep of the `sleep` sessions that end on that date, counted as the Sleep page counts them (asleep time from the stages or Oura's total when known, else time in bed), from whatever source delivered the session; overlapping sessions from several sources count once.
- **Naps** (the `nap` activity type and its subtypes) longer than 20 minutes add half their length to the date they end on. A nap on a date without a night does not count.
- **A date with no night recorded** only decays the debt (× 0.85); it is not counted as a night without sleep. **Today** without a night yet keeps yesterday's debt unchanged, without the decay, since its night may simply not have synced; this holds for the Sleep page, the API, the daily summary and the widget.
- 15 % of the debt fades every day, and the debt never goes below zero: sleep cannot be banked.

**Severity** is the debt as a share of one night's need: **none** under 10 %, **mild** under 50 %, **moderate** under 100 %, **severe** from one full night.

The debt is **computed on request, not stored**: the series starts four weeks before the asked range from no debt, so the decay has settled by the first date shown. A changed sleep need or a session that arrives late simply gives a new series, and history is always judged against the current sleep need.

Where it shows:

- The **Sleep page** (above).
- The **Sleep debt** dashboard widget ([Dashboard](./dashboard.md#sleep-debt)).
- The **daily summary** (`get_daily_summary`, `GET /api/daily-summary`) as `sleep_debt`: the debt after that date's night, null when no night was recorded in the four weeks up to it.
- `GET /api/sleep-debt?start=YYYY-MM-DD&end=YYYY-MM-DD&tz=…` and the MCP tool `get_sleep_debt`, which return `sleep_need_minutes`, the `debt_minutes` and `severity` after the last date, and one entry per date (`date`, `debt_minutes`, `severity`, `slept_minutes`, null for a date without a night). Both dates are optional: the range defaults to the two weeks up to today, and may span at most 366 days.

## What Data It Needs

| Feature                     | Data source                                      |
| --------------------------- | ------------------------------------------------ |
| Sleep sessions              | Oura, Garmin, or Health Connect                  |
| Sleep stages (hypnogram)    | Health Connect (via Oura/Garmin or watch)        |
| Sleep scores and components | Oura (primary source), Garmin (sleep score only) |
| HR/HRV during sleep         | Oura, Garmin, or Health Connect                  |
| Sleep location              | OwnTracks or Home Assistant                      |

The Sleep page works with any sleep source, but Oura provides the richest data (scores, sub-components, stages).

## Known Limitations

- Sleep components (deep, REM, restfulness, timing) are **Oura-specific**. They don't appear for Garmin-only or Health Connect-only users.
- The **sleep need** is the one you set; Aurboda does not estimate it from your recovery data. Sleep debt does not look at sleep stages (no separate deep or REM debt).
- Sleep duration uses the calculated "asleep" time when available (excluding awake periods). When stage data is missing, it falls back to total time in bed.
- There is no sleep **timing consistency** analysis (e.g., tracking bedtime regularity over time), though the Oura "Timing" sub-score partially covers this.
