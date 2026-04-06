# Deduction Rules

Deduction rules automatically create activities when data conditions are met. Define rules like "when I have a sauna tag, create a sauna activity" or "when I'm meditating and listening to Holosync, create a binaural meditation activity."

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

| Kind | Description | Example |
|---|---|---|
| `activity` | Matches time ranges of an activity type | `{kind: "activity", activity_type: "meditation"}` |
| `tag` | Matches time ranges of a tag (duration tags use their span; point tags get 1-minute window) | `{kind: "tag", tag_name: "sauna"}` |
| `screentime_category` | Matches productivity records in a hierarchical category | `{kind: "screentime_category", category: ["Work", "Programming"]}` |

More condition types (location, metric thresholds, scrobble patterns) are planned.

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
  "conditions": [{"kind": "tag", "tag_name": "sauna"}],
  "output_activity_type": "sauna"
}
```

**Multi-condition with merge gap:**
```json
{
  "name": "Binaural Meditation",
  "conditions": [
    {"kind": "activity", "activity_type": "meditation"},
    {"kind": "tag", "tag_name": "Holosync"}
  ],
  "output_activity_type": "binaural_meditation",
  "merge_gap_seconds": 300
}
```

**Screentime-based activity:**
```json
{
  "name": "Coding sessions",
  "conditions": [{"kind": "screentime_category", "category": ["Work", "Programming"]}],
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
