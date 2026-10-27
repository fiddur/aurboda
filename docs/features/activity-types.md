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

A field's `type` is `string`, `number`, `boolean` or `list`. A **list** field holds an array of
objects -- a strength session's sets, a rehab session's exercises -- each shaped by the field's
`item_fields`. Item fields are scalar only (`string`, `number`, `boolean`), so nesting stops at
one level, and `required`, `enum_values`, `unit` and `label` apply to them as to top-level
fields. Writes are validated against the schema: a list value must be an array of objects, and an
error names the item, e.g. `Required field "sets[1].exercise" is missing`. Keys a schema does not
declare are accepted, at the top level and on list items alike. A list field cannot be
categorical (an item field can, see [Exercises and measures](#exercises-and-measures)), and is not offered as a deduction-rule condition, an auto-share condition or a chart
breakdown, which all work on scalar values.

The built-in `strength_training` type carries a `sets` list field:

```json
{
  "fields": [
    {
      "name": "sets",
      "type": "list",
      "label": "Sets",
      "item_fields": [
        { "name": "exercise", "type": "string", "required": true, "is_categorical": true },
        { "name": "weight", "type": "number", "unit": "kg" },
        { "name": "reps", "type": "number" },
        { "name": "time", "type": "number", "unit": "s" }
      ]
    }
  ]
}
```

`sets` itself is optional, since watch-only strength sessions (Garmin, Health Connect) have none;
`time` is for holds such as planks. [Gravl](../gravl.md) writes sets in this shape. The schema is
seeded on new databases and filled in on existing ones when the type has no schema yet; a schema
still exactly an earlier built-in version (before `exercise` was marked categorical) is upgraded
in place. Any other schema counts as edited and is kept: the built-in schema can be extended (e.g. with `set_type` or `rpe` item fields) on
the type's page or with `update_activity_type`. Clearing it entirely does not stick, though: a
`strength_training` type without a schema gets `sets` back on the next deploy, so to drop a field
edit the schema rather than remove it. The Android Add tab is native and skips list fields until it
has a row editor ([#1316](https://github.com/fiddur/aurboda/issues/1316)); sets are entered on the
web pages.

## Exercises and measures

A list field's items can be grouped by an item field marked categorical -- a strength session's
sets by their `exercise`. Such a value is addressed by an **item path**, `<list field>.<item
field>`, e.g. `sets.exercise`. Strength sets are the running example below, but nothing is
specific to the `strength_training` type: any type whose list items use these field names gets
the same measures.

Measures are computed by convention on the item field names, over the **working** items only: an
item whose `set_type` is `warmup` (any case) is shown but never counted. `weight`, `reps` and
`time` count when they are numbers above zero.

| Measure      | Over the working items                                    |
| ------------ | --------------------------------------------------------- |
| `volume`     | Σ weight × reps, over items with both (kg)                |
| `e1rm`       | Best Epley estimate weight × (1 + reps / 30), one decimal |
| `max_weight` | Heaviest weight (kg)                                      |
| `set_count`  | Number of working items                                   |
| `max_time`   | Longest time (s), e.g. a plank hold                       |
| `total_reps` | Σ reps, over items with reps (weighted or not)            |
| `max_reps`   | Most reps in one item, e.g. a set of push-ups             |

A measure no item contributes to is absent rather than 0: a bodyweight set (reps only) counts in
`set_count`, `total_reps` and `max_reps` and nothing else. Item values compare trimmed and
case-insensitively, so `Bench Press` and ` bench press` are one exercise, shown as spelled in the
most recent session. A **record** is a session whose `e1rm`, `max_weight`, `max_time` or
`max_reps` for a value is strictly higher than in every earlier session with that value; the first
session with a value sets its records.

Everything is computed on read from `data`: nothing is stored, so editing a set or a schema
takes effect at once.

Where item paths are accepted:

- `GET /activity-types/:name/sessions` -- every session carries `measures` over its first list
  field. `group_by=sets.exercise` gives one group per exercise, a session in every group it has
  a set for (sessions without one in the no-value group), each group with its members' measures
  for that exercise combined (volume, set count and total reps summed, the rest at their
  maximum).
  `filter_field=sets.exercise&filter_value=Bench Press` keeps the sessions with that exercise,
  each with its matching `items`, their `measures` and the `records` it set, judged against all
  earlier sessions even when `start` cuts them off.
- `GET /activity-types/:name/field-values?field=sets.exercise` -- the exercises used, counted
  per session.
- `GET /activities/:id/item-history?field=sets.exercise` -- one activity (plain or `merged:` id)
  with its items grouped by exercise in order of first appearance: per exercise the items,
  measures, records and the previous session with that exercise (its id, start, items and
  measures), plus `totals` over the whole session. Its records are judged among the sessions of
  the activity's own type (and its descendants), while a sessions query judges them among the
  sessions of the type queried, so a query on a parent type such as `exercise` can mark
  different records.

The MCP tools mirror them: `query_activity_sessions` and `list_activity_field_values` take an
item path for `group_by` / `filter_field` / `field`, and `get_activity_item_history` is the
item-history endpoint.

Measures can be charted and set as goals too. `GET /chart-data` (and `query_chart_data`, and the
dashboard's bar chart) with `source_type=activity_type` and `measure=<measure>` aggregates each
session's measure per bucket instead of its duration or count: `aggregation=max` gives the best
session in the bucket, `sum` the total, `mean` the average and `count` the sessions having the
measure. `filter_field=sets.exercise&filter_value=Bench Press` takes the measure over that
exercise's sets only (sessions without it drop out), and `breakdown_fields=sets.exercise` gives
one series per exercise, spelled as in the latest session; a scalar breakdown field splits by
the session's value as usual. Highest Bench Press e1RM per week:
`source_type=activity_type&pattern=strength_training&measure=e1rm&aggregation=max&bucket_size=1w&filter_field=sets.exercise&filter_value=Bench Press`.
A goal on a measure, such as "Bench Press e1RM at least 100 kg over 30 days", is a
[measure goal](goals.md#measure-goals).

On the web, the type page has an exercises table (one row per exercise with its combined
measures), each exercise has its own page at `/activity-type/<name>/item/sets.exercise/<value>`
listing the sessions with it, and an activity's page has an exercises section comparing each
exercise with last time, with record badges.

### Merging values and aliases

Apps spell the same exercise differently (Gravl's `Dumbbell Bicep Curl` is another app's
`Dumbbell Curl`). Merging one item value into another rewrites every item with the source value
(trimmed, case-insensitive) to the target value, in the type's sessions and those of its
descendant types; soft-deleted activities are left alone. The source then becomes an **alias** of
the target. An alias belongs to the item path (`sets.exercise`), not to an activity type, and
applies to every later write that carries it, from any source: a Gravl import, an
`add_activity` / `update_activity` or the REST equivalents. Such an item is stored with the
target value. Aliases that pointed at the source follow it to the target, so chains stay one
step long, and an alias spelled like the target is dropped, since the target is a value again.

A source that differs from the target only in case or whitespace (`dumbbell curl` into
`Dumbbell Curl`) only unifies the spelling: the items are rewritten and no alias is stored.

Deleting an alias stops the mapping for later writes; the data the merge rewrote stays as it is.

- `POST /activity-types/:name/item-values/merge` -- body `{ field, source, target }`; answers
  with `activities_updated` and the `alias` kept (`null` for a spelling-only merge)
- `GET /activity-types/:name/item-values/aliases?field=sets.exercise` -- the aliases of the item
  path
- `DELETE /activity-types/:name/item-values/aliases/:id` -- delete one alias

The MCP twins are `merge_item_values`, `list_item_value_aliases` and `delete_item_value_alias`.

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

The period defaults to 90 days. Zone seconds and heart-rate histograms are computed in SQL,
with one index range scan per session window. Box plots come from the histograms, and a group's
box plot adds up its sessions' histograms, so the samples are read only once.

On an activity's detail page:

- **Previous/next**: links to the neighbouring activities of the same type (also on the ← and →
  keys), skipping the other sources of a merged session, and a second row per categorical value
  the activity has (e.g. the previous/next time the same yoga video was done). The type row also
  links to the timeline, showing the 24 hours centred on the activity.
- **Summary table**: the type's data fields, time, duration, location, then the source's
  summary metrics (HR, calories with the active part, steps when walked, Body Battery before and
  after, elevation, power). When the activity has a categorical value shared by at least three
  sessions that have an Avg HR, Avg HR adds what is typical for it, e.g.
  `125 bpm · typically 118 (12 Yin yoga)`: the median of those sessions' average heart rates and
  how many there are (the group's `avg_hr_count`), from the first categorical field with a value
  (`GET /activity-types/:name/sessions?group_by=<field>`). An empty categorical field shows as a
  row with **Set…**, which opens the editor on that field; a deleted activity leaves such rows
  out. When editing, a categorical text field suggests the values already used on the type
  (`GET /activity-types/:name/field-values`), so a repeat is picked rather than retyped.
- **Garmin**: an activity with a `garmin_activity_id` has **Re-sync Garmin Detail** and **Open
  in Garmin Connect**, which opens the activity on connect.garmin.com in a new tab.
- **Source data**: the rest of the source's `data` -- what neither the fields nor the summary
  show -- folded away at the bottom.
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
- `GET /activity-types/:name/sessions` -- Sessions with HR summaries and list-item measures;
  `start`/`end` (default all time), `group_by=<field>` for groups, `filter_field` +
  `filter_value` for one value (`(none)` for sessions without one); both fields also take an
  item path such as `sets.exercise`
- `GET /activity-types/:name/field-values?field=<field>` -- The values a data field (or an item
  path) has taken across the type and its subtypes, most recently used first, with counts
- `GET /activities/:id/neighbors` -- Previous and next activity of the same type; `same_field`
  to keep to the same value of a data field
- `GET /activities/:id/item-history?field=<item path>` -- The activity's list items grouped by
  an item value, with measures, records and the previous session per value
- `POST /activity-types/:name/item-values/merge` -- Merge one item value into another and keep
  the source as an alias (see [Merging values and aliases](#merging-values-and-aliases))
- `GET /activity-types/:name/item-values/aliases?field=<item path>` -- The aliases of an item
  path
- `DELETE /activity-types/:name/item-values/aliases/:id` -- Delete an alias

MCP tools: `list_activity_types`, `add_activity_type`, `update_activity_type`, `delete_activity_type`, `query_activity_sessions`, `list_activity_field_values`, `get_activity_neighbors`, `get_activity_item_history`, `merge_item_values`, `list_item_value_aliases`, `delete_item_value_alias`.

## Garmin Meditation Recognition

Garmin activities with typeKey `meditation` or `breathwork` are automatically imported as `meditation` activity type instead of generic `exercise`. Previously imported meditation activities can be corrected by changing their activity type via the API or MCP `update_activity` tool.
