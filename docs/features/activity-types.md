# Custom Activity Types

Your watch and ring record sleep and workouts, but not the coffee at four, the painkiller, the
headache or the sauna. In Aurboda you log those yourself, as activities of types you make up: add a
type once (**Types** in the sidebar, then **+ Add Type**, where matching
built-in types are offered too), then log it from **+ Add** in the sidebar
or by right-clicking (or long-pressing) a moment on the [timeline](./timeline.md). What you log is
private unless you share it, shows on the timeline next to everything else, and can be compared
with your sleep, heart rate and training on the [Analyze page](./correlations.md).

Aurboda comes with built-in activity types: the core types **sleep**, **exercise**, **meditation**, **nap** and **rest**, and every Health Connect exercise type. On top of those, a [catalogue of types](activity-type-catalog.md) for things logged by hand (caffeine, medication, symptoms, sauna, ...) is added to your types, with their fields, the first time you use one. You can define additional custom types to represent any activity you track -- driving, coding, vocal training, etc.

## Creating Custom Types

Custom activity types can be created on the **Activity Types** page (`/activity-types`, **+ Add Type**), via the REST API, MCP tools, or deduction rules. Each type has:

| Field              | Description                                                                                                                                  |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`             | Snake_case identifier (e.g., `sauna`, `hot_bath`, `yin_yoga`)                                                                                |
| `display_name`     | Human-readable name shown on the timeline                                                                                                    |
| `display_category` | Groups types for timeline toggles: `sleep_rest`, `exercise`, `meditation`, `wellness`, `health`, `intake`, `productivity`, `travel`, `other` |
| `color`            | Hex color for timeline rendering (e.g., `#ef4444`)                                                                                           |
| `icon`             | Optional emoji or icon identifier                                                                                                            |
| `show_on_timeline` | Whether activities of this type appear on the timeline (default: true)                                                                       |

`display_name` and `display_category` are required, except for a name from the
[activity type catalogue](activity-type-catalog.md): `POST /activity-types` (or
`add_activity_type`) with only that name creates the type from its catalogue definition, and any
field you give overrides the catalogue's.

Built-in types cannot be deleted but their display metadata (color, icon, display_name, show_on_timeline) can be updated.

Besides those, every Health Connect exercise session type (`running`, `yoga`,
`strength_training`, ...) is a built-in type of the `exercise` category.

### Merging types

A custom type can be merged into another type (`POST /activity-types/merge` with
`{ source, target }`, `merge_activity_type`): every activity of the source moves to the target,
soft-deleted ones included, the aliases are joined, deduction rules, child types and routes follow,
and the source is deleted. The target may be a type from the
[activity type catalogue](activity-type-catalog.md) not used yet; the merge adds it first.

`set_data` gives every moved activity a field value it has no value for yet, so merging `beer` into
`alcohol` with `{ "kind": "beer" }` keeps which drinks were beer. A key is filled only where the
activity has none or `null`; a value it already has is kept. Each key must be a scalar field of the
target's [data schema](#data-schema-and-categorical-fields) and each value must pass that field's
type, choices and bounds, or nothing is merged. When the target has a catalogue name and lacks a
field `set_data` names (an `alcohol` type made before the catalogue, with no `kind`), the merge adds
that one catalogue field to the target first; its other fields are untouched. The answer counts the activities moved
(`activities_reassigned`) and the ones that got a value (`activities_data_set`), live ones only.

### Single lifts are exercises, not types

Early Health Connect versions had 21 session types that are single lifts rather than kinds of
session (`bench_press`, `squat`, `deadlift`, `plank`, `crunch`, `lunge`, `lat_pull_down`, the
dumbbell curls, raises and triceps extensions, `back_extension`, `barbell_shoulder_press`,
`bench_sit_up`, `burpee`, `forward_twist`, `jumping_jack`, `upper_twist`). They are not activity
types: a lift is the `exercise` of a set inside a `strength_training` session, named through the
[exercise catalogue](exercise-catalog.md) where an entry fits (`crunch` becomes `Lying Ab Crunch`)
and by its old display name where none does (`Jumping Jack`).

A database from before this change is upgraded once, after the server starts: every activity of one
of those types (deleted ones too) becomes a `strength_training` session with the lift as its one
set, unless it already has sets, which it keeps. The type itself is then removed, or, while something
still refers to it (an activity that could not be moved because a strength session from the same
source starts at the same moment, a child type, a deduction rule, a goal, a challenge, an autoshare
rule, a route, a shared exercise, a screen-time category, a dashboard or a setting), kept as an
ordinary custom type that can be merged into another or deleted.

## Display Categories

Display categories control how activity types are grouped in the timeline:

- **sleep_rest** -- Sleep, nap, rest
- **exercise** -- Workouts, running, weightlifting, etc.
- **meditation** -- Meditation, breathwork
- **wellness** -- Sauna, hot bath, massage, etc.
- **health** -- Illness, symptoms, pain, injury, etc.
- **intake** -- Caffeine, alcohol, medication, supplements, meals, etc.
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
fields. A `number` field (top-level or item) may carry `min` and `max`, the lowest and highest
allowed value: a write outside them is refused (`Field "severity" value 11 is above the maximum 10`).
They are allowed on number fields only, and `min` must not be above `max`. Writes are validated against the schema: a list value must be an array of objects, and an
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
        {
          "name": "exercise",
          "type": "string",
          "required": true,
          "is_categorical": true,
          "catalog": "exercises"
        },
        { "name": "weight", "type": "number", "unit": "kg" },
        { "name": "reps", "type": "number" },
        { "name": "time", "type": "number", "unit": "s" },
        {
          "name": "set_type",
          "type": "string",
          "label": "Type",
          "enum_values": ["normal", "warmup", "drop_set", "failure"]
        },
        { "name": "rpe", "type": "number", "label": "RPE" },
        { "name": "rir", "type": "number", "label": "RIR" },
        { "name": "distance", "type": "number", "unit": "m" },
        { "name": "note", "type": "string" }
      ]
    }
  ]
}
```

An item field can name a built-in **catalogue** its values are matched against with `catalog`.
The only one is `exercises`, the [exercise catalogue](exercise-catalog.md): the set editor then
suggests catalogue exercises while typing, after the names already logged, and the exercise page
shows the catalogue entry's muscles and equipment. Any text stays valid; validation ignores the flag.
`catalog` is allowed only on a `string` item field without `enum_values`.

`sets` itself is optional, since watch-only strength sessions (Garmin, Health Connect) have none;
`time` is for holds such as planks and `distance` for carries. `set_type` tells warmup, drop and
failure sets from normal ones, `rpe` is the rate of perceived exertion, `rir` the reps in reserve,
and `note` a comment on the one set. [Gravl](../gravl.md) writes sets in this shape. The schema is
seeded on new databases and filled in on existing ones when the type has no schema yet; a schema
still exactly an earlier built-in version (before `exercise` was marked categorical, or before
`set_type`, `rpe`, `rir`, `distance` and `note` were declared) is upgraded in place. Any other
schema counts as edited and is kept: the built-in schema can be extended (e.g. with a `tempo` item
field) on the type's page or with `update_activity_type`. Clearing it entirely does not stick, though: a
`strength_training` type without a schema gets `sets` back on the next deploy, so to drop a field
edit the schema rather than remove it. The built-in `meditation` and `guided_breathing` types get
their fields from the [activity type catalogue](activity-type-catalog.md) the same way: filled in
when the type has no schema, so clearing it entirely does not stick either. The Android Add tab is native and skips list fields; sets are
entered on the web pages. To log a session, live in the gym or afterwards, use the
[strength session pages](strength-logging.md) at `/strength`, which the Android Add tab links to.

The web row editor shows a list's first four item fields, any required one and any that some row
fills in; the rest wait behind **More fields**, which applies to every list field, not only `sets`.
A new row carries over the previous row's values of those main fields only, so a warmup's
`set_type` or a set's `note` does not leak into the next set.

## Exercises and measures

A list field's items can be grouped by an item field marked categorical -- a strength session's
sets by their `exercise`. Such a value is addressed by an **item path**, `<list field>.<item
field>`, e.g. `sets.exercise`. Strength sets are the running example below, but nothing is
specific to the `strength_training` type: any type whose list items use these field names gets
the same measures.

Aurboda also ships a built-in [exercise catalogue](exercise-catalog.md) of strength exercises with
their equipment and muscles; logged exercise names are not yet resolved to it.

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
  measures, records, the previous session with that exercise (its id, start, items and
  measures) and `trend`: per measure the exercise's decaying best (the exercise page's trend,
  half-life `trend_half_life_days`, 120 days) just `before` this session — the earlier sessions'
  best decayed to its day, absent the first time — and `after` it, the higher of that and this
  session's value. Plus `totals` over the whole session. Its records are judged among the sessions of
  the activity's own type (and its descendants), while a sessions query judges them among the
  sessions of the type queried, so a query on a parent type such as `exercise` can mark
  different records.

- `GET /activity-types/:name/records?filter_field=sets.exercise&filter_value=Bench Press` -- the
  best value of each record measure (`e1rm`, `max_weight`, `max_time`, `max_reps`) with the
  start and id of the first session that reached it and the set behind it; `start` limits it to
  the sessions from then on (default all time).

The MCP tools mirror them: `query_activity_sessions` and `list_activity_field_values` take an
item path for `group_by` / `filter_field` / `field`, `get_activity_records` is the records
endpoint and `get_activity_item_history` is the item-history endpoint.

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
with its records, one chart of a chosen measure's weekly best (or total) — titled by the
measure — with, when the measure is the exercise's trend measure (best e1RM, or most reps in a
set, or longest hold, for an exercise without weights, the default pick), its decaying best drawn
over the bars as a line: it decays with a 120-day half-life between sessions and is lifted by each
session that beats it (a measure trend from the [trends API](trends.md), `GET /trends` with
`measure`, `filter_field` and `filter_value`), and the sessions with it; and an activity's page has an exercises section showing each exercise's sets
with record badges and its trend around the session — `Trend e1RM 12.2 kg ↗ 15.2 kg · volume
250 kg ↗ 296 kg`, just the value where the session did not lift it (the longest hold or most reps
for an exercise without weights) — with the full sets table collapsed under it. The chart has a ⋮ menu with **Open in Chart
Explorer** and **Set a goal** for the weekly bars (a measure goal, prefilled on the Goals page),
**Add to dashboard** for the chart as shown (a combined chart of the bars and the line when the
line is drawn, otherwise a bar chart), plus **Set a trend goal** (on the decaying best) and **Open
trend in Chart Explorer** when the line is drawn. An exercise page can be shared at a public link, with its
records, weekly chart with its trend line, and sessions' sets but nothing else of the sessions — see
[Sharing → Shared exercises](./sharing.md#shared-exercises).

### Merging values and aliases

Apps spell the same exercise differently (Gravl's `Dumbbell Bicep Curl` is another app's
`Dumbbell Curl`). Merging one item value into another rewrites every item with the source value
(trimmed, case-insensitive) to the target value, in the type's sessions and those of its
descendant types; soft-deleted activities are left alone. The source then becomes an **alias** of
the target. An alias belongs to the item path (`sets.exercise`), not to an activity type, and
applies to every later write that carries it, from any source: a Gravl import, an
`add_activity` / `update_activity` or the REST equivalents. Such an item is stored with the
target value. Aliases that pointed at the source follow it to the target, so chains stay one
step long, and an alias spelled like the target is dropped, since the target is a value again. A
[shared exercise](./sharing.md#shared-exercises) of the source moves to the target with its name
and slug, unless the target is already shared, in which case the source's share is dropped.

A source that differs from the target only in case or whitespace (`dumbbell curl` into
`Dumbbell Curl`) only unifies the spelling: the items are rewritten and no alias is stored.

Deleting an alias stops the mapping for later writes; the data the merge rewrote stays as it is.

- `POST /activity-types/:name/item-values/merge` -- body `{ field, source, target }`; answers
  with `activities_updated` and the `alias` kept (`null` for a spelling-only merge)
- `GET /activity-types/:name/item-values/aliases?field=sets.exercise` -- the aliases of the item
  path
- `DELETE /activity-types/:name/item-values/aliases/:id` -- delete one alias

The MCP twins are `merge_item_values`, `list_item_value_aliases` and `delete_item_value_alias`.

### Exercise identities

An item field whose data schema names a `catalog` (the built-in `strength_training` sets
`catalog: 'exercises'` on `sets.exercise`) gives every logged name an **identity**: an entry of the
[exercise catalogue](./exercise-catalog.md), or an explicit unmapped state. The identity sits on
the **name**, per user and per item path, and is resolved on read; no activity is rewritten. Like
item value aliases, it is not per activity type: two types that both have `sets.exercise` share
the identities of its names.

| State       | Meaning                                                               | `catalog_key` |
| ----------- | --------------------------------------------------------------------- | ------------- |
| `user`      | the user mapped this name to an entry                                 | the key       |
| `catalog`   | the name equals a catalogue name or alias (case, punctuation ignored) | the key       |
| `dismissed` | the user said this name is not in the catalogue                       | `null`        |
| `unmapped`  | none of the above                                                     | `null`        |

Resolution order: the user's stored decision for the name (compared trimmed and
case-insensitively) wins, and a stored key the current catalogue no longer has resolves as
`unmapped`; otherwise an exact catalogue name or alias; otherwise `unmapped`. Only the user's own
decisions are stored (table `item_value_identities`, a null key meaning dismissed); automatic
matches are computed, so they follow the catalogue as it grows. Source ids on a set (Gravl's
`exercise_id`) are not used.

**Writing by key.** A list item written through `add_activity` / `update_activity` or their REST
equivalents may carry `<item>_key` for a catalogue-backed item field (`sets[n].exercise_key`):

- an unknown key fails the write (`Data validation failed: sets[2].exercise_key: unknown exercise
catalogue key "…"`);
- a key without a name names the set: the user's own name for that key (the most recently decided
  logged name mapped to it, else the most used logged name resolving to it), else the catalogue
  name;
- a key next to a name that does not already resolve to it stores the mapping name -> key
  (state `user`);
- a null key changes nothing, and `<item>_key` is never stored on the item.

Gravl imports do not write keys.

**Merging.** When a merge rewrites a source name that has a stored identity, the identity moves to
the target unless the target has its own, in which case the source's is dropped. A spelling-only
merge keeps it under the new spelling.

- `GET /activity-types/:name/field-values?field=sets.exercise` -- each value also carries
  `catalog_key` and `state`, and the result `catalog` and `catalog_version` (only for a
  catalogue-backed field)
- `GET /activity-types/:name/item-values/identity?field=&value=` -- one name: `catalog_key`,
  `state`, the catalogue `entry` when there is a key, and `other_values`, the other logged names
  resolving to the same entry. The name need not be logged yet
- `PUT /activity-types/:name/item-values/identity` -- body `{ field, value, key }`, `key` a
  catalogue key or `null` to dismiss; answers like the GET
- `DELETE /activity-types/:name/item-values/identity?field=&value=` -- remove the decision, back to
  automatic resolution; 404 when none is stored
- `GET /activity-types/:name/item-values/unmapped?field=sets.exercise` -- the logged names in state
  `unmapped`, most used first, each with up to three suggested entries (word overlap with the
  entry's name or aliases)

A field without a catalogue is a 400. The MCP twins are `get_item_value_identity`,
`set_item_value_identity`, `clear_item_value_identity` and `list_unmapped_item_values`.

In the web app, the exercise page shows a name's identity and changes it (map, change, dismiss,
remove the mapping, undo), and the type page lists the unmapped names with suggestions to map or
dismiss each; see [Exercise catalogue](./exercise-catalog.md#in-the-web-app).

Sets, session groups, item history, measures, records, trends, goals and challenges stay keyed on
the name: a client joins a set to its entry through the field values.

### Muscle groups

Through its [identity](#exercise-identities), a working set of a catalogued exercise counts toward
every muscle group the exercise trains, by the catalogue entry's recruitment weight: a bench press
set is 1 set for the chest and 0.5 for the shoulders. Within one group the highest weight of the
entry's muscles in it counts, so the two heads of the triceps do not count a set twice. The same
weights apply to `volume` and `total_reps`. Warmup sets do not count. A name that resolves to no
entry (unmapped or dismissed), or to an entry without muscle weights, counts fully under **Not in
the catalogue** (`muscle_group: null`), so nothing drops out of the total. Values are rounded to two
decimals.

- `GET /chart-data` with `measure` `set_count`, `volume` or `total_reps` takes the breakdown field
  `sets.exercise.muscle_group` (`<list>.<item>.muscle_group`, a catalogue-backed item path): one
  series per muscle group, named as in the catalogue. It combines with scalar breakdown fields and
  with an exercise filter, but not with another item path; any other measure, or none, is a 400.
  Weekly sets per muscle group:
  `source_type=activity_type&pattern=strength_training&measure=set_count&aggregation=sum&bucket_size=1w&breakdown_fields=sets.exercise.muscle_group`.
  `query_chart_data` and the dashboard's bar chart take the same field.
- `GET /activities/:id/item-history?field=sets.exercise` carries `muscle_groups` for a
  catalogue-backed field: per group its `muscle_group` (null for not in the catalogue), `name` and
  weighted `measures`, most sets first and not in the catalogue last.

On the web, the type page shows a weekly **Sets per muscle group** bar chart for each
catalogue-backed item field (90 days or a year, with Chart Explorer and dashboard entries in its ⋮
menu), an activity's exercises section lists the session's sets per muscle group under the
exercises, and the Chart Explorer offers a **Muscle group** breakdown when a summed measure is
chosen.

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
- `POST /activity-types` -- Create a custom type; with only the name of a catalogue type, from its
  catalogue definition
- `GET /activity-type-catalog?q=` -- The built-in [activity type catalogue](activity-type-catalog.md),
  each entry with `in_use`
- `PATCH /activity-types/:name` -- Update display metadata
- `POST /activity-types/:name/catalog-fields` -- Add the catalogue fields a type of a catalogue
  name lacks (see [Types you already have](activity-type-catalog.md#types-you-already-have))
- `POST /activity-types/merge` -- Merge a custom type into another, with optional `set_data`
  (see [Merging types](#merging-types))
- `DELETE /activity-types/:name` -- Delete a custom type (built-ins protected)
- `GET /activity-types/:name/sessions` -- Sessions with HR summaries and list-item measures;
  `start`/`end` (default all time), `group_by=<field>` for groups, `filter_field` +
  `filter_value` for one value (`(none)` for sessions without one); both fields also take an
  item path such as `sets.exercise`
- `GET /activity-types/:name/records` -- The best value of each record measure with the first
  session that reached it and its set; `filter_field` + `filter_value` for one value (also an
  item path such as `sets.exercise`), `start` (default all time)
- `GET /activity-types/:name/summary?start=&end=` -- The type (subtypes included) rolled up over
  the range: session count, total minutes, total distance, best pace and average speed where the
  sessions carry a distance, and for sleep the average and best night and the average minutes per
  stage; `filter_field` + `filter_value` as for records. Behind the dashboard's activity card
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
- `GET /activity-types/:name/item-values/identity?field=&value=` -- The catalogue identity of a
  logged name
- `PUT /activity-types/:name/item-values/identity` -- Map a name to a catalogue key, or dismiss it
- `DELETE /activity-types/:name/item-values/identity?field=&value=` -- Clear the decision for a name
- `GET /activity-types/:name/item-values/unmapped?field=<item path>` -- Logged names matching no
  catalogue entry, with suggestions

MCP tools: `list_activity_types`, `list_activity_type_catalog`, `add_activity_type`, `add_activity_type_catalog_fields`, `update_activity_type`, `delete_activity_type`, `merge_activity_type`, `query_activity_sessions`, `get_activity_records`, `get_activity_type_summary`, `list_activity_field_values`, `get_activity_neighbors`, `get_activity_item_history`, `merge_item_values`, `list_item_value_aliases`, `delete_item_value_alias`, `get_item_value_identity`, `set_item_value_identity`, `clear_item_value_identity`, `list_unmapped_item_values`.

## Garmin Meditation Recognition

Garmin activities with typeKey `meditation` or `breathwork` are automatically imported as `meditation` activity type instead of generic `exercise`. Previously imported meditation activities can be corrected by changing their activity type via the API or MCP `update_activity` tool.
