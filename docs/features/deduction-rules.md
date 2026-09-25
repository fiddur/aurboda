# Deduction Rules

Deduction rules automatically create activities when data conditions are met, or [enrich](#enrich-mode) or [retype](#retype-mode) existing ones. Define rules like "when I have a sauna tag, create a sauna activity" or "when I'm meditating and listening to Holosync, create a binaural meditation activity."

## How It Works

Each rule has one or more **conditions** that resolve to time ranges. When all conditions overlap in time (AND logic), an activity is created for the overlapping period.

```
Rule: "Binaural Meditation"
  Conditions:
    - activity type "meditation" exists
    - tag "Holosync" exists
  Output: activity type "binaural_meditation"

Timeline:
  meditation:  |------9:00--------10:00------|
  Holosync:         |---9:15--------10:15---|
  result:           |---9:15--------10:00---|  <-- intersection
```

## Condition Types

| Kind                  | Description                                                                                       | Example                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `activity`            | Matches time ranges of an activity type, optionally filtered by data fields and title             | `{kind: "activity", activity_type: "meditation"}`                                   |
| `activity_data`       | Matches activities of a type whose data field matches (`eq`, `neq`, `exists`, `not_exists`)       | `{kind: "activity_data", activity_type: "run", field: "route", operator: "exists"}` |
| `screentime_category` | Matches screentime in a hierarchical category                                                     | `{kind: "screentime_category", category: ["Work", "Programming"]}`                  |
| `location`            | Matches visits to a named location                                                                | `{kind: "location", location_name: "Gym"}`                                          |
| `after_date`          | Restricts matches to after a date                                                                 | `{kind: "after_date", date: "2024-06-01"}`                                          |
| `scrobble`            | Matches Last.fm scrobbles by artist/track, each covering `duration_seconds`                       | `{kind: "scrobble", artist: ["Holosync"], duration_seconds: 210}`                   |
| `media`               | Matches [media plays](../media.md) (MPRIS pushes and non-duplicate Last.fm scrobbles) — see below | `{kind: "media", url_host: ["truenakedyoga.com"], min_played_secs: 600}`            |

An `activity` condition's `title` matches case-insensitively, per `match_mode`: `contains` (the default) or `exact`.

### Media plays

A `media` condition matches plays whose fields satisfy every matcher given (unset matchers match anything):

| Field              | Match                                                                                                                                                                                          |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `url_host`         | Any of these hosts, or a subdomain of one (`www.truenakedyoga.com` matches `truenakedyoga.com`). Plays without a parsable URL (all Last.fm plays) never match                                  |
| `title`            | Per `match_mode` (`contains`, the default, or `exact`), case-insensitive                                                                                                                       |
| `artist`           | Any of these, per `match_mode`                                                                                                                                                                 |
| `player`           | Any of these, exact and case-insensitive (`firefox`, `mpv`)                                                                                                                                    |
| `min_played_secs`  | `played_secs` at least this. Plays without `played_secs` (Last.fm) never pass                                                                                                                  |
| `min_played_ratio` | `played_secs / track_secs` at least this (0–1). **Skipped** when the track length is unknown (Last.fm, some mpv files) — combine it with `min_played_secs` for a threshold that always applies |

A matching play covers `started_at`–`ended_at`; a Last.fm play (no end) covers one minute.

## Enrich Mode

With `mode: "enrich"`, a rule creates nothing: it patches data onto existing activities of `output_activity_type`
that overlap the matched ranges. `output_data` keys are only filled when missing, and `data._enriched_by` records
the rule id.

### Copying a play title (`output_media_field`)

In enrich mode, a rule with at least one `media` condition can copy the title of a matching play into a data field:

```json
"output_media_field": { "field": "session_name", "strip_pattern": "\\s*—\\s*True Naked Yoga$" }
```

- For each enriched activity, the plays matching **every** `media` condition within the activity's matched span are
  considered, and the one with the most `played_secs` wins (ties: the earliest). Several videos in one session
  therefore give the longest one's title.
- `strip_pattern` is a JavaScript regular expression (flags `giu`, at most 200 characters); every match is
  removed, then whitespace is collapsed and trimmed. An empty result writes nothing.
- The field is filled when missing, and **overwritten when the rule wrote it before** (`_enriched_by` is this
  rule), so re-evaluating after editing the pattern updates old values. A value set by anyone else is never
  overwritten. Unchanged values are not rewritten.
- `_enriched_by` holds a single rule id: the last rule that enriched the activity. If another enrich rule later
  touches the same activity, this rule no longer recognises the value as its own and falls back to fill-only there —
  it never overwrites a value it did not write. To refresh such a value, clear the field on the activity and
  re-evaluate.
- The API rejects `output_media_field` outside enrich mode, without a `media` condition, or with a pattern that does
  not compile.

See [Media plays](../media.md) for a full example.

## Retype Mode

With `mode: "retype"`, a rule changes the type of existing activities to `output_activity_type`. The rule needs
exactly one `activity` condition, which selects the activities to change; the other conditions only narrow it down
in time (an activity is retyped when it overlaps their intersection). For example, to turn Garmin activities recorded
with a custom "Sex" profile — which Garmin reports as its base sport, `other` (stored as `other_workout`), titled
"Sex" or "`<place> Sex`" — into the `sex` type:

```json
{
  "name": "Sex from Garmin",
  "mode": "retype",
  "conditions": [{ "kind": "activity", "activity_type": "other_workout", "title": "sex" }],
  "output_activity_type": "sex",
  "output_title": "Sex"
}
```

- A synced activity (Garmin, Health Connect, …) gets an aurboda override carrying the new type, exactly like a manual
  type change, so the next sync of the source row does not undo it. An aurboda activity is changed in place.
- `output_title`, when set, replaces the title; `output_data` only fills fields that are missing. `data._retyped_by`
  records the rule id.
- Activities already overridden are reached through their override, rows produced by rules are never retyped, and an
  activity already of the target type is skipped, so re-evaluation changes nothing twice.
- The new type's data schema applies, as for a manual type change: if it has required fields the activity lacks,
  that activity is not retyped and an audit-log warning names it. Supply them in `output_data`.
- Deleting or disabling the rule does not change retyped activities back; edit them like any other activity.

## Merge Gap

When `merge_gap_seconds` is set, nearby matching time ranges are coalesced into a single activity. For example, with a 10-minute merge gap, two sauna tags 5 minutes apart produce one sauna activity spanning the full period.

## Rule Chaining

Rules are evaluated in **priority order** (0 first, then 1, then 2). Activities created by priority-0 rules are visible to priority-1 rules, enabling chaining:

- **Priority 0:** Tag "sauna" -> `sauna` activity
- **Priority 1:** `sauna` activity + tag "cold_plunge" -> `contrast_therapy` activity

Maximum chain depth is 2 (priorities 0, 1, 2).

## Retroactive Evaluation

When a rule is created or updated, it is immediately evaluated against the last 90 days of historical data. Existing activities produced by the rule are cleaned up and re-created.

## Examples

**Simple tag-to-activity conversion:**

```json
{
  "name": "Sauna sessions",
  "conditions": [{ "kind": "tag", "tag_name": "sauna" }],
  "output_activity_type": "sauna"
}
```

**Multi-condition with merge gap:**

```json
{
  "name": "Binaural Meditation",
  "conditions": [
    { "kind": "activity", "activity_type": "meditation" },
    { "kind": "tag", "tag_name": "Holosync" }
  ],
  "output_activity_type": "binaural_meditation",
  "merge_gap_seconds": 300
}
```

**Screentime-based activity:**

```json
{
  "name": "Coding sessions",
  "conditions": [{ "kind": "screentime_category", "category": ["Work", "Programming"] }],
  "output_activity_type": "coding",
  "merge_gap_seconds": 600
}
```

## API

- `GET /deduction-rules` -- List all rules
- `POST /deduction-rules` -- Create a rule (triggers retroactive evaluation)
- `PATCH /deduction-rules/:id` -- Update a rule (re-evaluates retroactively)
- `DELETE /deduction-rules/:id` -- Delete a rule and its generated activities
- `POST /deduction-rules/evaluate` -- Manually trigger full re-evaluation

MCP tools: `list_deduction_rules`, `add_deduction_rule`, `update_deduction_rule`, `delete_deduction_rule`, `evaluate_deduction_rules`.

## Technical Details

- Generated activities use `source: "deduction-rule"` and store the rule ID in `data.rule_id`
- The unique constraint `(source, activity_type, start_time)` prevents duplicate activities
- Stale activities (from previous evaluations that no longer match) are automatically cleaned up
- Rule evaluation is debounced per-user (5-second window) when triggered by data syncs
- The `output_activity_type` must reference an existing [custom activity type](activity-types.md)
