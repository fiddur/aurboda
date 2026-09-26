# Custom Activity Types

Aurboda comes with five built-in activity types: **sleep**, **exercise**, **meditation**, **nap**, and **rest**. You can define additional custom types to represent any activity you track -- sauna, driving, yoga, coding, vocal training, etc.

## Creating Custom Types

Custom activity types can be created via the REST API, MCP tools, or deduction rules. Each type has:

| Field              | Description                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `name`             | Snake_case identifier (e.g., `sauna`, `hot_bath`, `yin_yoga`)                                                            |
| `display_name`     | Human-readable name shown on the timeline                                                                                |
| `display_category` | Groups types for timeline toggles: `sleep_rest`, `exercise`, `meditation`, `wellness`, `productivity`, `travel`, `other` |
| `color`            | Hex color for timeline rendering (e.g., `#ef4444`)                                                                       |
| `icon`             | Optional emoji or icon identifier                                                                                        |
| `show_on_timeline` | Whether activities of this type appear on the timeline (default: true)                                                   |

Built-in types cannot be deleted but their display metadata (color, icon, display_name, show_on_timeline) can be updated.

## Display Categories

Display categories control how activity types are grouped in the timeline:

- **sleep_rest** -- Sleep, nap, rest
- **exercise** -- Workouts, running, weightlifting, etc.
- **meditation** -- Meditation, breathwork
- **wellness** -- Sauna, hot bath, massage, etc.
- **productivity** -- Coding, standup computer, meetings, etc.
- **travel** -- Driving, commuting, etc.
- **other** -- Anything else

## Data Schema and Categorical Fields

A type can carry a `data_schema` describing the fields of its activities' `data` (name, type,
label, unit). A field marked **categorical** (`is_categorical`) holds a small set of repeating
values -- a yoga video's `session_name`, a run's kind (`maffetone`, `intervals`), a partner. The
Chart Explorer can break charts down by these fields, and the sessions overview below groups by
them.

## Sessions Overview

The activity type page (`/activity-type/<name>`) lists the type's sessions (descendant types
included) with their length, average and maximum heart rate, minutes in HR zone 3 or higher, a
box plot of the heart-rate samples and the zone mix. All box plots on a page share one bpm axis,
so rows compare at a glance.

- **By a categorical field** (the default when the type has one): one row per value, e.g. per
  yoga video -- times done, last done, median length with its range, median average HR, highest
  HR, zone 3+ minutes per session, and a box plot of every sample of those sessions pooled.
  Sort by recency, count, length, average HR, zone 3+ time or name to pick the next session by
  length and effort. Expanding a row lists its sessions. Sessions without a value form the last
  row.
- **All sessions**: one sortable table.

The period defaults to a year; the zone and HR figures are computed in SQL per session window,
so a long period costs one query rather than loading the whole span's time-series.

On an activity's detail page:

- **Previous/next**: links to the neighbouring activities of the same type (also on the ← and →
  keys), skipping the other sources of a merged session, and a second row per categorical value
  the activity has (e.g. the previous/next time the same yoga video was done).
- **Other sessions with the same value**: for each categorical value, every session sharing it,
  this one highlighted, with a one-line summary, once it has been done at least twice.

HR avg/max come from the source's own summary (Garmin's `average_hr`/`max_hr`) when present,
else from the samples. HR zones in activity lists are computed for every exercise-like type:
the generic `exercise`, the Health Connect exercise subtypes (`yoga`, `running`, ...), and custom
types in the `exercise` display category.

## API

- `GET /activity-types` -- List all definitions
- `POST /activity-types` -- Create a custom type
- `PATCH /activity-types/:name` -- Update display metadata
- `DELETE /activity-types/:name` -- Delete a custom type (built-ins protected)
- `GET /activity-types/:name/sessions` -- Sessions with HR summaries; `start`/`end` (default all
  time), `group_by=<field>` for groups, `filter_field` + `filter_value` for one value (`(none)`
  for sessions without one)
- `GET /activities/:id/neighbors` -- Previous and next activity of the same type; `same_field`
  to keep to the same value of a data field

MCP tools: `list_activity_types`, `add_activity_type`, `update_activity_type`, `delete_activity_type`, `query_activity_sessions`, `get_activity_neighbors`.

## Garmin Meditation Recognition

Garmin activities with typeKey `meditation` or `breathwork` are automatically imported as `meditation` activity type instead of generic `exercise`. Previously imported meditation activities can be corrected by changing their activity type via the API or MCP `update_activity` tool.
