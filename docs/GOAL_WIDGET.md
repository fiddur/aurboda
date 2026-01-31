# Goals Feature

This document describes the goals functionality for tracking health metrics
against user-defined targets.

## Overview

Users can set targets for any metric in the system. Goals have:
- A **metric** (e.g., `hr_zone_2_sec`, `steps`, `distance`)
- An optional **minimum** target value
- An optional **maximum** target value (at least one of min/max required)
- A configurable **window duration** (default: `7d` - 7 days rolling)

Progress is calculated as a rolling window from today backwards.

## Goal Examples

| Metric | Min | Max | Meaning |
|--------|-----|-----|---------|
| HR Zone 2 | 150 min | - | At least 150 minutes per week |
| HR Zone 5 | 5 min | 10 min | Between 5-10 minutes per week |
| Steps | 70,000 | - | At least 70,000 steps per week |

## Default Goals

New users receive these default goals based on Huberman/Galpin recommendations
(using default 7-day window):

1. **Zone 2 cardio**: minimum 150 minutes (no max)
2. **Zone 5 cardio**: minimum 5 minutes, maximum 10 minutes
3. **Steps**: minimum 70,000 steps (~10k/day)

## Window Duration Format

The window duration uses standard duration notation:

| Unit | Meaning | Example |
|------|---------|---------|
| `s` | seconds | `3600s` = 1 hour |
| `m` | minutes | `30m` = 30 minutes |
| `h` | hours | `24h` = 1 day |
| `d` | days | `7d` = 1 week |
| `w` | weeks | `2w` = 2 weeks |
| `M` | months | `1M` = 1 month |

Default is `7d` (7 days rolling window).

An info icon (ⓘ) is displayed next to the duration field with a tooltip explaining
these units.

## Data Model

### Goal Structure

```typescript
interface WeeklyGoal {
  id: string              // UUID for identification
  metric: string          // Valid metric name (e.g., 'hr_zone_2_sec', 'steps')
  min?: number            // Minimum target (at least one of min/max required)
  max?: number            // Maximum target
  window: string          // Duration string, default '7d'
}
```

### Storage

Goals are stored in the `user_settings` JSONB field:

```json
{
  "birthDate": "1990-01-15",
  "hrZoneStart": { "1": 90, "2": 108, "3": 126, "4": 144, "5": 162 },
  "goals": [
    { "id": "uuid-1", "metric": "hr_zone_2_sec", "min": 9000, "window": "7d" },
    { "id": "uuid-2", "metric": "hr_zone_5_sec", "min": 300, "max": 600, "window": "7d" },
    { "id": "uuid-3", "metric": "steps", "min": 70000, "window": "7d" }
  ]
}
```

Note: HR zone times are stored in seconds internally, displayed as minutes to user.

## Progress Calculation

### Rolling Window

Progress is calculated over a rolling window ending at the current moment:
- For a `7d` window: from `now - 7 days` to `now`
- Uses the existing `getPeriodSummary` query with sum aggregation

### "Losing Tomorrow" Calculation

Shows how much value will "drop off" when the oldest day exits the window.

For a 7-day window on January 15th:
- Current window: Jan 9 - Jan 15
- Tomorrow's window: Jan 10 - Jan 16
- "Losing tomorrow": Sum of Jan 9th values for that metric

This helps users understand if they need to exercise more to maintain their target.

## UI Components

### Web Settings Page

Located in the Settings page with other user preferences.

#### Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ Weekly Goals                                          [+ Add]   │
├─────────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Metric: [Zone 2 ▼]  Min: [150] min  Max: [   ]  Window: [7d]│ │ │ │                                                         [🗑] │ │
│ └─────────────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Metric: [Zone 5 ▼]  Min: [5  ] min  Max: [10 ]  Window: [7d]│ │
│ │                                                         [🗑] │ │
│ └─────────────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Metric: [Steps  ▼]  Min: [70000]    Max: [   ]  Window: [7d]│ │
│ │                                                         [🗑] │ │
│ └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                                          Saved 2 seconds ago
```

#### Behavior

- **Inline editing**: Each field saves on blur (no separate save button)
- **Save indicator**: Shows "Saving..." during save, then "Saved <timestamp>"
- **Add button**: Opens a new row with metric dropdown
- **Delete button**: Trash icon removes the goal (with confirmation)
- **Validation**: At least one of min/max required, values must be positive
- **Unit display**: Shows the unit for the selected metric (e.g., "min", "steps")

### Web Goals Page

A dedicated page showing current progress toward all goals.

#### Layout (matches widget display)

```
┌─────────────────────────────────────────────────────────────────┐
│ Goals                                                           │
├─────────────────────────────────────────────────────────────────┤
│ Zone 2          (-1h 54 min tomorrow)              4 h 12 min   │
│ [████████████████████████████░░░░░░░░░░░░░░░░░░░░]             │
│                              ▲ min                              │
├─────────────────────────────────────────────────────────────────┤
│ Zone 5                  (-2 min tomorrow)              7 min    │
│ [████████████████████████████████████████|░░░░░░░]             │
│                              ▲ min       ▲ max                  │
├─────────────────────────────────────────────────────────────────┤
│ Steps             (-8,432 steps tomorrow)            72,145     │
│ [██████████████████████████████████████████████████████████████]│
│ [████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░]│
│                                                     ▲ min       │
└─────────────────────────────────────────────────────────────────┘
```

### Android Widget

Displays goals with progress bars, stacked vertically.

#### Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ Zone 2          (-1h 54 min tomorrow)              4 h 12 min   │
│ [████████████████████████████░░░░░░░░░░░░░░░░░░░░]             │
│ Zone 5                  (-2 min tomorrow)              7 min    │
│ [████████████████████████████████████████|░░░░░░░]             │
│ Steps             (-8,432 steps tomorrow)            72,145     │
│ [██████████████████████████████████████████████████████████████]│
│ [████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░]│
└─────────────────────────────────────────────────────────────────┘
```

#### Widget Sizing

- Users with more goals should use a larger widget size
- Minimum size: 4x2 (fits ~2 goals comfortably)
- Recommended: 4x3 for 3 goals, 4x4 for 4+ goals

## Progress Bar Visualization

### Bar Types

#### Min-only goals (e.g., Steps min 70,000)
- Bar fills from left to right
- 100% = min value reached
- Color changes when min is reached (e.g., gray → green)

```
Progress: 50,000 / 70,000 min
[███████████████████████████████████░░░░░░░░░░░░░░░░]
                                                    ▲ min (100%)
```

#### Max-only goals
- Bar fills from left to right
- 100% = max value
- Color changes when approaching max (e.g., green → yellow → red)

```
Progress: 7 / 10 max
[██████████████████████████████████████████░░░░░░░░░]
                                                    ▲ max (100%)
```

#### Min-max goals (e.g., Zone 5 min 5, max 10)
- Bar fills from left to right
- Vertical marker at min position
- 100% = max value
- Color: gray until min, green between min-max, red beyond max

```
Progress: 7 / min 5, max 10
[████████████████████|███████████████████░░░░░░░░░░░]
                     ▲ min (50%)                    ▲ max (100%)
```

### Overflow Display

When progress exceeds the target (for min-only) or max (for min-max goals),
the bar shows overflow by starting a second row:

```
Progress: 85,000 / 70,000 min (121%)
[██████████████████████████████████████████████████] 100%
[████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░]  21%
```

The second row:
- Starts from the left
- Uses a slightly different shade or offset to indicate overflow
- Shows the overflow percentage (amount over 100%)

For goals with both min and max, exceeding max is shown in red:

```
Progress: 15 / min 5, max 10 (150% of max)
[████████████████████|██████████████████████████████] 100%
[██████████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░]  50% (over)
              ↑ red color indicates exceeding max
```

## API Endpoints

### Get Goals (included in settings response)

```
GET /user/settings
```

Response includes:
```json
{
  "goals": [
    { "id": "...", "metric": "hr_zone_2_sec", "min": 9000, "window": "7d" },
    ...
  ]
}
```

### Update Goals

```
PATCH /user/settings
{
  "goals": [
    { "id": "...", "metric": "hr_zone_2_sec", "min": 9000, "window": "7d" },
    ...
  ]
}
```

Set to `null` to reset to defaults, or `[]` to clear all goals.

### Get Goal Progress

Uses existing period summary endpoint:

```
GET /period-summary?start=<7d-ago>&end=<now>&metrics=hr_zone_2_sec,hr_zone_5_sec,steps
```

Response includes sum values for calculating progress.

### Get "Losing Tomorrow" Values

Separate query for the oldest day in the window:

```
GET /period-summary?start=<oldest-day-start>&end=<oldest-day-end>&metrics=...
```

Or a new dedicated endpoint:

```
GET /goals/progress
```

Response:
```json
{
  "goals": [
    {
      "id": "...",
      "metric": "hr_zone_2_sec",
      "min": 9000,
      "max": null,
      "window": "7d",
      "current": 15120,
      "losingTomorrow": 6840,
      "unit": "seconds",
      "displayUnit": "minutes"
    }
  ]
}
```

## MCP Tools

### get_user_settings

Existing tool, extended to include `goals` in response.

### update_user_settings

Existing tool, extended to accept `goals` parameter.

### get_goal_progress (new)

Returns current progress for all goals with losing-tomorrow calculations.

## Implementation Notes

### Metric Units

| Metric | Storage Unit | Display Unit | Conversion |
|--------|--------------|--------------|------------|
| hr_zone_*_sec | seconds | minutes | ÷ 60 |
| steps | steps | steps | none |
| distance | meters | km/miles | ÷ 1000 |
| weight | kg | kg/lbs | varies |

### Aggregation

- HR zone times: **SUM** over the window
- Steps: **SUM** over the window
- Distance: **SUM** over the window
- Heart rate: **AVG** over the window (less common for goals)
- Weight: **LATEST** value (not typical for weekly goals)

### Timezone Handling

- All calculations use UTC
- "Tomorrow" means the next UTC day boundary
- Widget should display times in user's local timezone

### Performance

- Goal progress can be calculated from existing period-summary queries
- "Losing tomorrow" requires one additional query per goal (or batched)
- Consider caching progress calculations with short TTL (1-5 minutes)
