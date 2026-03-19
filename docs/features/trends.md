# Trends (EMA)

Trends use Exponential Moving Average (EMA) smoothing to show how things change over time. Instead of noisy day-to-day fluctuations, you see a smooth curve that reveals the underlying pattern -- whether your coffee intake is creeping up, your weight is trending down, or your screen time is shifting.

The Trends page lets you configure and save multiple trend cards. Trends also appear automatically on Tag Meta pages, Metric Meta pages, Screentime Category Detail pages, and as Dashboard widgets.

## What Is EMA?

EMA is a weighted average where recent data counts more than old data. The **half-life** controls how quickly old data fades:

| Half-life | Label | Behavior |
|---|---|---|
| **7 days** | Quick | Responds fast to changes. A week of new behavior dominates. Good for daily habits like coffee. |
| **15 days** | Responsive | Balanced default. Smooths out noise but reflects changes within ~2 weeks. |
| **30 days** | Stable | Very smooth line. Short-term spikes are flattened. Good for slow-moving things like weight. |

After one half-life, old data has 50% weight. After two half-lives, 25%. After three, 12.5%. So a 15-day half-life means data from 45 days ago has essentially no influence.

## Three Source Types

### Tags

Tracks how frequently tags matching a pattern occur. The pattern is a regex, so you can combine multiple tags: `pain_killer|painkiller|ibuprofen` matches any of those.

The trend value represents occurrences per display period (e.g., "3.5 per month").

### Metrics

Tracks the smoothed value of any numeric metric (weight, HRV, sleep score, steps, etc.). Two aggregation modes:

- **Average**: Shows the typical daily value, smoothed. Useful for things like weight or resting heart rate where you want to see the central tendency.
- **Sum**: Shows the total per display period, smoothed. Useful for things like steps where you want to see "steps per week."

### Screentime Categories

Tracks hours spent in a productivity category per day. Includes all subcategories -- trending "Work" includes time in "Work > Programming", "Work > Meetings", etc.

The trend value is shown as "hours per day" (or per week/month).

## Configuration Options

When adding or editing a trend, you can configure:

| Option | Choices | What it does |
|---|---|---|
| **Name** | Free text | Display name for the trend card. Defaults to the pattern if blank. |
| **Source type** | Tag, Metric, Screentime Category | What data to trend. |
| **Pattern** | Tag picker (multi-select), Metric picker, or Category picker | What to match. Tags support regex with multiple selections joined by `\|`. |
| **Half-life** | 7 (Quick), 15 (Responsive), 30 (Stable) | How quickly old data fades. See table above. |
| **Lookback** | 30 days to 5 years, or All time | How far back the chart extends. |
| **Display as** | Per day, Per week, Per month | Rate normalization. Same data, different scale. |
| **Aggregation** | Average, Sum (metrics only) | Whether to average or total daily metric values. |

## The Trends Page

The `/trends` page shows a grid of your saved trend cards. Each card displays:

- The trend **name** and current EMA **value** with units.
- The **pattern** being matched.
- An interactive **chart** showing the trend over time. Hover to see exact values at any date.
- **Edit** and **Remove** buttons.

### Default Presets

New users start with three presets:

| Name | Type | Pattern | Half-life | Display |
|---|---|---|---|---|
| Painkillers | Tag | `pain_killer\|painkiller\|ibuprofen` | 15 days | Per month |
| Coffee | Tag | `coffee` | 7 days | Per day |
| Weight | Metric | `weight` | 14 days | Per day |

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

## What Data It Needs

Trends work with whatever data you have:

| Source type | Needs |
|---|---|
| Tags | Any tags -- manual, Oura, calendar imports, Last.fm auto-tags |
| Metrics | Time series data from any source (Oura, Garmin, Health Connect, manual) |
| Screentime | Productivity data from RescueTime or ActivityWatch |

The more historical data you have, the more useful long lookback periods become. A 30-day lookback with only 10 days of data will look sparse.

## Known Limitations

- Saved trends are stored in **browser local storage**, not on the server. Switching browsers or devices gives you the defaults.
- For tags and screentime categories, days with no matching data count as zero, which pulls the trend line down. For metrics, missing days are excluded from the average (they don't dilute the value).
- The EMA computation window is capped at 90 days for performance, even with longer lookback periods. This means each point on the chart looks at most 90 days into the past, though the chart itself can display years of history.
- Dashboard trend widgets currently only support tags and metrics, not screentime categories.
