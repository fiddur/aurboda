# MCP Server

Aurboda includes an MCP (Model Context Protocol) server that enables AI assistants like Claude to access all capabilities of the platform -- querying data, creating activities, managing rules, and more.

In practice: connect Claude (or another assistant that speaks MCP) to your account and ask about your data in plain language -- "did the evening runs help my sleep this month?", "log that I just had a coffee". On Claude.ai, add a custom connector with the URL `https://aurboda.net/mcp` (or `/mcp` on your own server) and sign in with your Aurboda account; see [Connecting Claude.ai](#oauth-21-for-claudeai-custom-connectors). Everything the MCP tools do is also in the REST API, documented interactively at [aurboda.net/apispec](https://aurboda.net/apispec) (`/apispec` on your own server).

## Overview

The MCP server exposes 200+ tools covering all of Aurboda's functionality. Tool descriptions, parameters, and schemas are self-documented via the MCP protocol itself -- AI assistants discover available tools automatically.

Key areas covered by MCP tools:

- **Querying** -- daily summaries, metrics, activities, tags, meals, reports, correlations, trends, chart data
- **Tracking** -- add/update/delete activities, tags, metrics, meals, comments
- **Activity types** -- manage custom activity type definitions
- **Deduction rules** -- create rules that auto-generate activities from data conditions
- **Screentime** -- manage category rules and recategorize
- **Sync** -- trigger data syncs from Garmin, Oura, Strava, Gravl, Home Assistant, Last.fm, RescueTime, calendars
- **Settings** -- user preferences, HR zones, training load configuration
- **Export** -- `export_data_dump` links a download of your whole database as SQL ([data export](data-export.md))
- **Account** -- `delete_my_account` deletes your account for good; admins can `delete_user` ([deleting accounts](admin.md#deleting-accounts))
- **Single sign-on** (admins) -- `list_oidc_providers`, `add_oidc_provider`, `update_oidc_provider`, `delete_oidc_provider` ([sso.md](sso.md))

### Tool discovery

The `tools/list` answer is abbreviated to keep it small: each tool shows the first sentence of its description and its top-level parameters only, each with its type, enum, format and a one-line description. Nested objects and arrays appear as `object` or `array` (with the item type), without their inner fields. `describe_tools` returns the full description and the complete JSON input schema -- nested objects, enums, formats, examples -- for up to 20 tool names, and lists any names it does not know under `unknown`. The server's `initialize` instructions tell the assistant to call it before using a tool whose parameters are objects or arrays. It is the one MCP tool without a REST twin: it is protocol plumbing, and REST's equivalent is the OpenAPI document.

```json
{
  "name": "describe_tools",
  "arguments": { "names": ["add_deduction_rule", "query_chart_data"] }
}
```

### Sleep tools

| Tool               | What it does                                                                                                                                                                                               |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_latest_sleep` | "How did I sleep last night?" -- the most recent sleep ending within 36 hours: timing, score, stage timeline and minutes, resting HR and HRV against 30-day baselines, Body Battery at bedtime and wake-up |
| `get_sleep_debt`   | "How much sleep do I owe?" -- sleep debt per night against the `sleep_need_minutes` setting, with the debt and severity after the last date; defaults to the two weeks up to today                         |

### Chart data tools

| Tool               | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `query_chart_data` | Bucketed counts, sums, means or maxima of an activity type, metric (including computed `hr_zone_<n>_sec`) or screentime category, the same as `GET /chart-data`. For an activity type with list items, `measure` (`e1rm`, `volume`, …) charts that measure per session, `filter_field`/`filter_value` (`sets.exercise` = `Bench Press`) narrows it to one exercise, a `sets.exercise` breakdown gives a series per exercise, and with `set_count`, `volume` or `total_reps` a `sets.exercise.muscle_group` breakdown gives a series per muscle group, while `filter_field=sets.exercise.muscle_group` with a group key (`chest`) as `filter_value` charts that one group, optionally per exercise (see [Muscle groups](features/activity-types.md#muscle-groups)). `tz` (IANA, e.g. `Europe/Stockholm`) makes daily, weekly and monthly buckets start at local midnight, local Monday and the local 1st, and hourly ones at the local hour; omitted, buckets are UTC. The web app sends the browser's zone |

### Dashboard tools

See [Dashboard](features/dashboard.md#period-dashboards).

| Tool                 | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_dashboard_data` | The data each widget renders, keyed by widget id, for the home dashboard or a shared one (`dashboard_id`), the same as `GET /dashboard/data` and `GET /shared-dashboards/:id/data`. A period dashboard answers its latest finished period unless `period` (`2026-10`, `2026-W44`, `2026`) is given, with each figure compared against the previous period. A day overview is answered only with `visible_to_visitors`; a latest activities card always, with each activity's id (visitors get it only with `visible_to_visitors`, without ids) |
| `get_data_presence`  | Whether each named metric and activity type (subtypes included) has ever recorded anything, the same as `GET /dashboard/data-presence`; the dashboard leaves out the cards whose sources never have                                                                                                                                                                                                                                                                                                                                            |

### Top list and places tools

See [Media](media.md#querying), [Screentime categories](features/screentime-categories.md#top-apps) and [Places](features/places.md#places-summary).

| Tool                 | What it does                                                                                                                                                                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `query_top_media`    | Plays over `start`..`end` grouped by artist, album or track (`by`): total plays, the distinct count and the `limit` most played; `source` (`lastfm` or `mpris`) counts one source only                                                                                               |
| `query_top_apps`     | Screen time over `start`..`end` per app: total hours, distinct apps and the `limit` most used, leaving out categories excluded from screen time                                                                                                                                      |
| `get_places_summary` | Where each night of `start`..`end` was spent (the place at 03:00 in `tz`, a phone at rest included): nights per named place, elsewhere and without data, at home (`home_location`, default `Home`) and away; distinct named places, visits to them and the five with the most nights |

### Activity session tools

See [Activity types -- sessions overview](features/activity-types.md#sessions-overview).

| Tool                          | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `query_activity_sessions`     | Sessions of one type, each with length, avg/max HR, HR-zone seconds and a box-plot summary of its HR samples; with `group_by` (a categorical data field, or `place`) also one group per value, to compare repeats or pick a session by length and effort                                                                                                                                                                                                                          |
| `get_activity_records`        | The best value of each record measure (e1RM, max weight, longest hold, most reps) of a type, optionally one item value (`sets.exercise` = `Bench Press`), with the date, session and set that first reached it; `start` and `end` limit it to a range                                                                                                                                                                                                                             |
| `get_activity_type_summary`   | Roll-up of one type (descendants included) over `start`..`end`: session count, total duration, total distance, best pace and average speed where sessions carry distance, and for sleep the average and best night and average minutes per stage; `filter_field` + `filter_value` narrow it (also an item path)                                                                                                                                                                   |
| `get_recent_activities`       | The latest activities, newest first, as short rows (type, title, start, duration, distance, sets, average HR, calories, the detail id): today's so far (`window: today`, in `tz`) or the most recent over `lookback_days` (`latest`); by default the types a day overview draws as icons, else exactly `types` with subtypes, minus `exclude_types`; `manual_only` keeps hand-logged ones. The read behind the dashboard's latest activities card (REST `GET /activities/recent`) |
| `get_activity_neighbors`      | The previous and next activity of the same type, optionally only those sharing a data field value (`same_field`, e.g. `session_name`)                                                                                                                                                                                                                                                                                                                                             |
| `list_activity_field_values`  | The values a data field (e.g. `session_name`) has taken across a type and its subtypes, most recently used first, with counts -- for reusing a value instead of spelling a new variant                                                                                                                                                                                                                                                                                            |
| `get_activity_item_history`   | One activity's list items grouped by an item value (`field=sets.exercise`): per value the items, their measures (volume, e1RM, max weight, set count, longest hold), the records set and the previous session with it, plus totals and, for a catalogue-backed field, `muscle_groups`                                                                                                                                                                                             |
| `merge_item_values`           | Merge one value of a categorical item path (`field=sets.exercise`) into another across a type and its subtypes; the source becomes an alias, so later writes carrying it are stored as the target                                                                                                                                                                                                                                                                                 |
| `list_item_value_aliases`     | The aliases kept for an item path (`field=sets.exercise`)                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `delete_item_value_alias`     | Delete an alias; the data the merge rewrote stays rewritten                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `get_item_value_identity`     | Which exercise catalogue entry a logged name of a catalogue-backed item path (`field=sets.exercise`) stands for, and why (`user`, `catalog`, `dismissed`, `unmapped`), with the other names resolving to it                                                                                                                                                                                                                                                                       |
| `set_item_value_identity`     | Map a logged name to a catalogue key, or dismiss it with key `null`; no activity is rewritten                                                                                                                                                                                                                                                                                                                                                                                     |
| `clear_item_value_identity`   | Remove the mapping or dismissal of a name, back to automatic resolution                                                                                                                                                                                                                                                                                                                                                                                                           |
| `list_unmapped_item_values`   | The logged names matching no catalogue entry, most used first, each with up to three suggested entries; paged by `limit` (default 50, max 200) and `offset`, with the `total`                                                                                                                                                                                                                                                                                                     |
| `list_muscle_groups`          | Every muscle group of the exercise catalogue with `last_trained`, the start of the latest session of the type in which a catalogue-backed item path (`field=sets.exercise`) gave it weighted sets                                                                                                                                                                                                                                                                                 |
| `get_muscle_group_history`    | One muscle group over `start`..`end` (default the last 90 days): weighted totals, every exercise logged that trains it with its weight and measures, and the sessions that trained it, newest first                                                                                                                                                                                                                                                                               |
| `get_strength_score`          | The [strength score](features/strength-score.md) at `at` (default now): per reference lift the best estimated one-rep max of working sets with a weight (reps above 12 count as 12) in the last 90 days against a reference by sex and bodyweight (100 points: a solid recreational lifter), per muscle group the mean of its best three lifts, overall the mean of the groups; `missing` lists `sex` and/or `bodyweight` when a score cannot be given                            |
| `get_strength_score_history`  | The strength score at `end` and every `step_days` (default 7) before it down to `start` (default 365 days before `end`), oldest first, each point over its own 90 days; at most 500 points                                                                                                                                                                                                                                                                                        |
| `get_muscle_recovery`         | [Muscle recovery](features/muscle-recovery.md) at `at` (default now, or later for the recovery to come): per muscle group 100 × (1 − fatigue), the fatigue of the working sets of the last 10 days by recruitment weight and effort, halving every 24 or 36 hours; 80 and above is ready, `ready_at` says when a group gets there, `sources` the sessions that still tire it                                                                                                      |
| `get_muscle_recovery_history` | Muscle recovery of every group at `end` (default now, may lie ahead) and every `step_hours` (default 6) before it down to `start` (default 14 days before `end`), oldest first; at most 1000 points                                                                                                                                                                                                                                                                               |

### Strength plan tools

See [Strength plans](features/strength-plans.md).

| Tool                   | What it does                                                                                                                                                                                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_strength_plans`  | Planned strength workouts with their sets and the sessions started from them; `status` `open` (default: routines and plans with a day without a session) or `all`; days first, then routines by name                                          |
| `get_strength_plan`    | One plan by `id`                                                                                                                                                                                                                              |
| `create_strength_plan` | Plan a workout: `name`, `sets` in order (`exercise`, `exercise_key`, `reps` or `time`, `weight` in kg, `set_type`, `note`), `planned_for` for a day (left out for a routine), `note`; it shows on the strength start page with a Start button |
| `update_strength_plan` | Change a plan: fields left out stay, an empty `planned_for` or `note` clears it, `sets` replaces the list                                                                                                                                     |
| `delete_strength_plan` | Delete a plan; sessions started from it are kept                                                                                                                                                                                              |

### Activity track tools

See [Routes and segments](features/routes-and-segments.md).

| Tool                       | What it does                                                                                                                                                           |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_activity_track`       | An activity's full-resolution GPS track: `lat`, `lon`, `alt` and `t` (seconds since the activity start) per point, with `length_m` and `point_count`                   |
| `backfill_activity_tracks` | Build missing tracks from stored raw records (Garmin details at full resolution, Strava polylines shape-only), time the user's segments on them, and return the counts |

### Route tools

A route is a course run more than once, recognised from the tracks. See
[Routes and segments](features/routes-and-segments.md#phase-2-routes). `query_activities`
takes a `route_id` to list a route's activities. `query_activities` and
`query_activity_sessions` also take a `category` that keeps the runs carrying that run
category (`low_hr`, `intervals`, `long`, `tempo`, `hard`, or any rule's `output_category`);
see [run features and categories](features/routes-and-segments.md#phase-3-run-features-and-categories).

| Tool           | What it does                                                                                                                              |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `list_routes`  | Every route with its type, length, run count and latest run; filter by `activity_type` (with subtypes), order by `sort`                   |
| `get_route`    | One route with its line and its runs, newest first: elapsed seconds, average heart rate and pace (s/km) per run                           |
| `update_route` | Rename a route                                                                                                                            |
| `delete_route` | Delete a route; its runs are kept, stay attached to it and are not matched again                                                          |
| `merge_routes` | Move every run of `source_route_id` onto the route `id` and delete the source                                                             |
| `match_routes` | Match every tracked activity without a route (attach to a covering route, or pair two unrouted tracks into a new one); returns the counts |

### Segment tools

A segment is a directional stretch timed on every pass, cut from an activity's track or a
route. See [Routes and segments](features/routes-and-segments.md#phase-4-segments).
`get_activity_detail` carries the activity's `segment_efforts`.

| Tool                        | What it does                                                                                                                                                     |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_segments`             | Every segment with its type, length, effort count, best time and latest effort; filter by `activity_type` (with subtypes), order by `sort`                       |
| `get_segment`               | One segment with its line, the named locations near its ends and its efforts, newest first, the best one marked                                                  |
| `create_segment`            | Cut a segment from an activity (`activity_id`, `start_offset_s`, `end_offset_s`) or a route (`route_id`, `start_km`, `end_km`) and time history on it            |
| `update_segment`            | Rename a segment                                                                                                                                                 |
| `delete_segment`            | Delete a segment and its efforts                                                                                                                                 |
| `match_segment`             | Time every tracked activity of the segment's type on it again; returns the counts                                                                                |
| `list_suggested_segments`   | Pending suggestions: stretches at least three activities of one type pass the same way on different routes, with line, length, activity count and a nearby place |
| `promote_suggested_segment` | Add a suggestion as a segment, optionally trimmed (`start_km`, `end_km`) and named, and time history on it                                                       |
| `dismiss_suggested_segment` | Dismiss a suggestion; the stretch is not suggested again                                                                                                         |
| `scan_suggested_segments`   | Look through tracked activities not yet looked at (about 20 s per call); returns `scanned`, `suggested`, `remaining`                                             |

### Exercise catalogue tools

See [Exercise catalogue](features/exercise-catalog.md). Logged exercise names on sets stay free text.

| Tool                         | What it does                                                                                                                                                                                                                                                                                         |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search_exercise_catalog`    | Search the built-in catalogue by `q` (word prefixes, plurals, written together or apart, db/bb/kb; best matches first), `similar_to` (entries closest to a logged name), exact `name` or alias, `equipment`, `muscle` (a muscle or a group, weight ≥ 0.5), `category`; paged by `limit` and `offset` |
| `get_exercise_catalog_entry` | One catalogue exercise by its stable `key`: name, aliases, category, equipment, muscles with recruitment weights, and the same exercise in other datasets                                                                                                                                            |

### Activity type catalogue tools

See [Activity type catalogue](features/activity-type-catalog.md). A catalogue type is added to the user's types the first time `add_activity` uses its name, or with `add_activity_type` given only the name.

| Tool                               | What it does                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `list_activity_type_catalog`       | The built-in activity types for things logged by hand, each with its fields, `in_use` (whether the user already has a type of that name), `missing_fields` (the catalogue fields that type lacks) and `variants` (names that are the type with a field value set, `beer` is `alcohol` with kind beer); `q` filters by word prefixes, variants included |
| `add_activity_type_catalog_fields` | Add the catalogue fields a type of a catalogue name lacks (`name`); fields the type has are never changed                                                                                                                                                                                                                                              |
| `merge_activity_type`              | Merge a custom type into another (`source`, `target`); the target may be a catalogue type not used yet, and `set_data` (e.g. `{ "kind": "beer" }`) gives each moved activity the values it has none for, adding the catalogue field to a target that lacks it                                                                                          |
| `add_activity_type`                | With a variant's name (`beer`) it creates nothing and answers with the built-in type and data to use instead; `separate_type: true` creates the type anyway                                                                                                                                                                                            |

`add_activity` and `update_activity` refuse a type name the user does not have and the catalogue does not know; when the name is a variant, the error names the built-in type and the `data` to log instead.

### Metric catalogue tools

See [Metric catalogue](features/metric-catalog.md). A catalogue metric is added to the user's custom metrics the first time `add_metric`, `add_metrics_bulk` or a report entry uses its name, display name or an alias.

| Tool                  | What it does                                                                                                                                                                                                                     |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_metric_catalog` | The built-in metrics for lab values, circumferences and body composition, each with the unit it is stored in, the units it accepts with their conversion, `in_use` and, when in use, `in_use_unit`; `q` filters by word prefixes |
| `add_metric`          | `unit` (optional) is the unit the value is given in: an accepted unit of a catalogue metric is converted to the metric's unit, any other unit that differs is refused                                                            |
| `add_metrics_bulk`    | The same `unit`, per item                                                                                                                                                                                                        |
| `add_custom_metric`   | With an alias of a catalogue metric (`ldl`) it creates nothing and answers with the built-in metric to use instead; `separate_metric: true` creates the metric anyway                                                            |

### Comment tools

Comments (stored as "notes") hang off anything, or off a bare point in time or a
whole day, and can be threaded one level deep. Journal entries are free-standing
comments. See [Comments](features/comments.md) for the data model and
[Journal](features/journal.md).

| Tool                  | What it does                                                                                                                                                                                                                                                                                                                                                         |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `add_note`            | Add a comment in one of four shapes: on an entity (`entity_type` + `entity_id`), a reply (`entity_type: "note"`, `entity_id` = the comment's id), about a moment (`entity_type: "time"`, `start_time` required, `end_time` optional) or a day (`entity_type: "day"`, `date` required); optional `title`, `tags` and (not on a reply) `related` people and activities |
| `get_notes`           | All comments on one entity, each with its thread nested in `replies` (oldest first)                                                                                                                                                                                                                                                                                  |
| `get_note`            | One comment by id: a thread root with its replies and attachments, or a single reply                                                                                                                                                                                                                                                                                 |
| `query_notes`         | Every comment anchored in a `from`/`to` time range, and the `day` comments on its dates (the window's end exclusive, `tz` an IANA name) -- threads nested, replies never listed separately                                                                                                                                                                           |
| `search_notes`        | Search and list thread roots newest first: full-text `q`, `tags`, `from`/`to` dates, `on_this_day`, `entity_types`, `related_type`/`related_id`, paged with `cursor`                                                                                                                                                                                                 |
| `update_note`         | Change a comment's content, title, tags and `related` people and activities; times on a `time` comment, `date` on a `day` one (switching kinds); `expected_updated_at` refuses a stale edit; moving one moves its whole thread                                                                                                                                       |
| `delete_note`         | Delete a comment, restorable for 30 days; deleting a thread root deletes its replies too; `purge: true` removes it for good                                                                                                                                                                                                                                          |
| `restore_note`        | Restore a deleted comment with the replies deleted with it                                                                                                                                                                                                                                                                                                           |
| `list_deleted_notes`  | The deleted comments that can still be restored, with `deleted_at` and `purge_at`                                                                                                                                                                                                                                                                                    |
| `list_note_revisions` | A comment's earlier texts, newest first                                                                                                                                                                                                                                                                                                                              |

Pictures and recordings on journal entries, and entry templates:

| Tool                            | What it does                                                                                                                                                                                                         |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `add_note_attachment`           | Attach a picture or recording (base64 `data`) to a `time` or `day` entry; at most 5 MB decoded, about 3 MB in practice under the 4 MB request limit; larger files go through [`create_upload_url`](#uploading-files) |
| `get_note_attachment`           | A picture as MCP image content (JPEG, at most 2000 px) with its metadata; a recording as its metadata only                                                                                                           |
| `delete_note_attachment`        | Delete an attachment, restorable for 30 days; `purge: true` removes it for good                                                                                                                                      |
| `restore_note_attachment`       | Restore a deleted attachment, unless the entry already holds 30                                                                                                                                                      |
| `list_deleted_note_attachments` | An entry's deleted attachments, with `deleted_at` and `purge_at`                                                                                                                                                     |
| `list_note_templates`           | The entry templates by name; `deleted: true` lists the deleted ones                                                                                                                                                  |
| `add_note_template`             | Add a template: `name` and markdown `content`                                                                                                                                                                        |
| `update_note_template`          | Change a template's name or text                                                                                                                                                                                     |
| `delete_note_template`          | Delete a template, restorable for 30 days; `purge: true` removes it for good                                                                                                                                         |
| `restore_note_template`         | Restore a deleted template                                                                                                                                                                                           |

To transcribe photographed diary pages: `search_notes` with `needs_text: true`, then
`get_note_attachment` for each page in `position` order, then `update_note` with the
text and `expected_updated_at`. The photos stay attached.

### Notification tools

The bell's notifications and per-type switches. See [Notifications](features/notifications.md).

| Tool                          | What it does                                                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `list_notifications`          | Newest first with `unread_count` and `next_cursor`; `unread_only`, `after`, `push_only` and `ids` filter, like `GET /notifications`   |
| `mark_notification_read`      | Mark one notification read by `id`                                                                                                    |
| `mark_all_notifications_read` | Mark every unread notification read                                                                                                   |
| `list_notification_types`     | The types this user can receive with their in-app and push switches                                                                   |
| `set_notification_preference` | Turn a `type` on or off in-app and/or as a push                                                                                       |
| `run_notification_action`     | Run one of a notification's `actions` by `id` and `key` (the keys come from `list_notifications`), e.g. `skip` on `autoshare_pending` |
| `list_push_subscriptions`     | The browsers subscribed to browser push, with a readable browser label                                                                |
| `delete_push_subscription`    | Remove a subscribed browser by `id`                                                                                                   |
| `send_test_push`              | Send a test push to every subscribed browser; answers `reached` and `total`                                                           |

### Reminder tools

Recurring reminders delivered as `reminder` notifications. See [Reminders](features/reminders.md).

| Tool              | What it does                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------ |
| `list_reminders`  | The reminders with `next_due_at`, the earliest of those and the time zone, like `GET /reminders` |
| `add_reminder`    | Create one: `title`, `time_of_day` (HH:MM, five-minute steps), `weekdays` (default every day), … |
| `update_reminder` | Change a reminder by `id`; only the given fields; `body` and `link` take null to clear           |
| `delete_reminder` | Delete a reminder by `id`                                                                        |

### Check-in tools

Check-in forms whose answers are logged as metrics or activities, with schedules, routines, skipping and adherence. See [Check-ins](features/check-ins.md).

| Tool                                                                                                                                     | What it does                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_check_in_forms`, `get_check_in_form`, `add_check_in_form`, `update_check_in_form`, `delete_check_in_form`, `restore_check_in_form` | Manage the forms, like `/check-in-forms`; `add_check_in_form` takes a `template`                                                                                                      |
| `list_check_in_templates`                                                                                                                | The built-in forms to copy, like `GET /check-in-templates`                                                                                                                            |
| `submit_check_in`, `query_check_ins`, `update_check_in`, `delete_check_in`, `restore_check_in`                                           | Fill in a form and manage the check-ins, like `/check-ins`; answers with `logs_to` become metric points or activities; `use_defaults` saves a routine, `status: skipped` skips a slot |
| `list_due`                                                                                                                               | The scheduled slots of a day with their state, like `GET /due`                                                                                                                        |
| `get_check_in_adherence`                                                                                                                 | A form's slots done, skipped and missed and how often each question was answered, like `GET /check-in-forms/{id}/adherence`                                                           |

### People tools

Private profiles of the people in your life, their dates and the activities you did with them.
See [People](features/people.md). Each tool has a REST twin under `/people`.

| Tool                     | What it does                                                                              |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| `list_people`            | The people by name; `archived` includes archived ones, `deleted` lists deleted ones       |
| `get_person`             | One person with their dates, the 20 latest activities with them and their journal entries |
| `add_person`             | Add a person: `name`, `relationship`, `birth_date`, `pronouns`, `handle`, …               |
| `update_person`          | Change the given fields; null clears an optional one                                      |
| `delete_person`          | Delete, restorable for 30 days; `purge` removes it for good                               |
| `restore_person`         | Restore a deleted person                                                                  |
| `add_person_date`        | Add a date (`label`, `kind`, `month`, `day`, optional `year` and `notify_days_before`)    |
| `update_person_date`     | Change a date                                                                             |
| `delete_person_date`     | Delete a date for good                                                                    |
| `list_important_dates`   | Every date and birthday occurring between `from` and `to`                                 |
| `list_person_posts`      | The person's recent posts from your timeline, when they have a fediverse handle           |
| `list_person_activities` | Every activity with the person, newest first, paged by `before` cursor, with `total`      |

`add_activity` and `update_activity` take `people` (person IDs), and `query_activities` and
`get_activity_detail` carry `people: [{ id, name }]`. `query_activities` takes `person_id` to keep
the activities with that person; `get_person` carries `activity_count` and `activity_types`.

### Auto-share tools

The rules that publish new activities to the feed. See [Auto-share rules](features/auto-share-rules.md).

| Tool                                                                                                                     | What it does                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `list_autoshare_rules`, `add_autoshare_rule`, `update_autoshare_rule`, `delete_autoshare_rule`, `preview_autoshare_rule` | Manage the rules, like `/autoshare-rules`                                                               |
| `skip_autoshare`                                                                                                         | Keep one activity (`activity_id`) and its merge group from being auto-shared; fails when already shared |

### Uploading files

MCP carries a file base64-encoded inside a JSON request of at most 4 MB, so `add_note_attachment`
and `add_feed_image` suit small files only. For anything larger than a few hundred kB, or a file
on disk, `create_upload_url` (REST: `POST /uploads`) mints a short-lived, single-use URL for one
target, and the client sends the raw bytes there with any HTTP client:

| `target`           | Needs          | Stores                                    | Answers like                  |
| ------------------ | -------------- | ----------------------------------------- | ----------------------------- |
| `note_attachment`  | `note_id`      | A picture or recording on a journal entry | `add_note_attachment` (20 MB) |
| `feed_image`       |                | A picture to embed in markdown            | `add_feed_image` (10 MB)      |
| `challenge_banner` | `challenge_id` | The banner of a hosted challenge          | `POST /challenges/:id/banner` |
| `profile_avatar`   |                | The profile picture                       | `POST /profile/avatar`        |

The tool answers `{ success, data: { upload_url, expires_at, max_bytes, target, method } }`.
The URL works once, within 15 minutes, and needs no `Authorization` header: the token in it is
the credential (only its SHA-256 is stored). Send the file with `curl -T photo.jpg '<upload_url>'`
(`PUT`, raw bytes, any content type) or `curl -F file=@photo.jpg '<upload_url>'` (`POST`
multipart, field `file`). The upload answers `201` with `{ success, data: { target, ... } }`
holding what the target's own upload would (`attachment`, `image`, `challenge` or `url`), or
that upload's error. A body over `max_bytes` (`413`) or an empty one (`400`) leaves the URL
usable; any other answer uses it up. An unknown, expired or used URL answers `404`. Minting draws
on the account's upload budget; the uploads themselves are limited per client IP.

## Endpoint

The MCP server is available at `/mcp` and uses the Streamable HTTP transport:

- `POST /mcp` - Handle JSON-RPC requests
- `GET /mcp` - SSE stream for server notifications
- `DELETE /mcp` - End session

Request bodies are limited to 4 MB; a larger body gets HTTP 413 with a JSON-RPC `-32600` error.

A request is also refused before any tool runs, with HTTP 413 and the JSON-RPC error
`{ "code": -32600, "message": "Request too large" }`, when it is a batch of more than 20 messages,
nests deeper than 64 levels, or holds more than 100,000 elements in all (every array item and every
object property counts as one). A 10,000-point `add_metrics_bulk` is about 50,000 elements.

## Authentication

The MCP server supports two authentication methods:

### OAuth 2.1 (for Claude.ai Custom Connectors)

The server implements OAuth 2.1 with PKCE (S256) for clients that support it, such as Claude.ai custom connectors.

**Discovery:** `GET /.well-known/oauth-authorization-server` returns the authorization server metadata.

**OAuth endpoints:**

| Endpoint     | Method | Description                              |
| ------------ | ------ | ---------------------------------------- |
| `/register`  | POST   | Dynamic client registration (RFC 7591)   |
| `/authorize` | GET    | Serves login form with OAuth params      |
| `/authorize` | POST   | Handles login + redirects with auth code |
| `/token`     | POST   | Exchanges auth code or refresh token     |

**Supported grants:** `authorization_code` (with PKCE S256), `refresh_token`

**Token lifetimes:** Access tokens expire after 1 hour, refresh tokens after 30 days.

**Connecting Claude.ai:**

1. In Claude.ai, add a custom connector with the MCP URL: `https://aurboda.net/mcp`
2. Claude.ai will auto-discover the OAuth endpoints via `/.well-known/oauth-authorization-server`
3. On first use, you will be redirected to sign in with your Aurboda credentials
4. Claude.ai handles token refresh automatically

### Bearer Token (for Claude Desktop / API clients)

For direct API access, use the existing AES-256-GCM Bearer token:

1. Obtain a token via `POST /api/login`
2. Include the token in the `Authorization` header: `Authorization: Bearer <token>`

Both authentication methods are supported simultaneously. Each MCP session is scoped to the authenticated user.

## Available Metrics

The following metrics are available for querying and manual entry:

| Metric                     | Unit        | Description                    |
| -------------------------- | ----------- | ------------------------------ |
| `heart_rate`               | bpm         | Heart rate in beats per minute |
| `resting_heart_rate`       | bpm         | Resting heart rate             |
| `hrv_rmssd`                | ms          | Heart rate variability (RMSSD) |
| `weight`                   | kg          | Body weight                    |
| `body_fat`                 | percent     | Body fat percentage            |
| `bone_mass`                | kg          | Bone mass                      |
| `lean_body_mass`           | kg          | Lean body mass                 |
| `body_water_mass`          | kg          | Body water mass                |
| `height`                   | m           | Height in meters               |
| `steps`                    | count       | Step count                     |
| `distance`                 | m           | Distance traveled              |
| `floors_climbed`           | count       | Floors climbed                 |
| `calories_active`          | kcal        | Active calories burned         |
| `calories_total`           | kcal        | Total calories burned          |
| `calories_basal`           | kcal        | Basal metabolic calories       |
| `spo2`                     | percent     | Blood oxygen saturation        |
| `respiratory_rate`         | breaths/min | Respiratory rate               |
| `body_temperature`         | celsius     | Body temperature               |
| `basal_body_temperature`   | celsius     | Basal body temperature         |
| `blood_glucose`            | mmol/L      | Blood glucose level            |
| `blood_pressure_systolic`  | mmHg        | Systolic blood pressure        |
| `blood_pressure_diastolic` | mmHg        | Diastolic blood pressure       |
| `vo2_max`                  | mL/kg/min   | VO2 max                        |
| `readiness_score`          | score       | Readiness score (0-100)        |
| `resilience_score`         | score       | Resilience score (0-100)       |
| `productivity_score`       | score       | Productivity score (0-100)     |

## Connecting with Claude Desktop

To connect Claude Desktop to your Aurboda MCP server:

1. Start the Aurboda backend server
2. Obtain an authentication token via the login endpoint
3. Configure Claude Desktop with the MCP server URL and Bearer token

Example Claude Desktop configuration (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "aurboda": {
      "type": "http",
      "url": "http://localhost:3000/mcp",
      "headers": {
        "Authorization": "Bearer <your-token-here>"
      }
    }
  }
}
```

## Example Conversations

Once connected, you can ask Claude questions like:

- "What was my heart rate yesterday?"
- "Show me a summary of my health data for January 15th"
- "How many steps did I take last week?"
- "Log that I just had a coffee"
- "Record my weight as 75.5 kg"
- "I meditated for 30 minutes starting at 2pm - add that as a tag"
- "Note that I felt dizzy around 11:40 this morning"
- "What did I comment on yesterday?"

## Input conventions

String values are trimmed of leading and trailing whitespace before validation, in MCP tool arguments as
well as in REST request bodies and query strings, at any depth (inside `data` records and arrays too).
Whitespace inside a value is kept, and a value that is only whitespace becomes empty, so a required field
still rejects it. Phone keyboards append a space after an autocompleted word: `"yoga "` reaches the tool
as `"yoga"`.

These keys keep their value exactly as sent, wherever they appear: passwords (`password`,
`current_password`, `new_password`), regular expressions and patterns (`pattern`, `regex`, `rule_regex`,
`strip_pattern`, `message_pattern`, `outcome_pattern`), markdown (`content`, `markdown`) and the WebAuthn
`response_json`.

## Error Handling

The MCP server returns standard JSON-RPC error responses:

- Invalid metric names will list all valid metrics in the error message
- Invalid date formats will prompt for ISO 8601 format
- Authentication errors return HTTP 401
- Session mismatch errors return HTTP 403
