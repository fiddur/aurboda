# Auto-share rules

Automatically publish matching activities to the [federated feed](feed.md) once they've
settled — the canonical example: **"share runs longer than 15 minutes."** (#903)

## Model

A per-user set of rules, each combining a **predicate** and a **share template**:

- **Predicate**: activity types (one or more; empty matches any), min/max duration
  (over the **merged span**), min distance (from the `distance` metric over the span),
  source (e.g. `garmin`), and **data conditions** on the activity's structured `data`
  (`data_filters`, up to 16, all must hold) — e.g. "yoga sessions that have a session
  name". Each condition is a field (a data key such as `session_name`) and one of
  `exists` (has a value), `eq` (is), `neq` (is not) or `not_exists` (has no value);
  `eq`/`neq` need a `value`. A **blank** value — missing, `null`, or a string that is
  empty after trimming — counts as missing, so `exists` means the field has a value.
  `eq` compares the trimmed string forms case-sensitively (numbers and booleans compare
  through their string form), and `neq` is its negation, so a missing field is "not
  equal". Conditions are checked against the merge group's **combined data**: each key
  takes the first non-blank value walking the members anchor first, so a field set on
  an override row (editing a synced activity can create one) counts for the group.
- **Share template** — exactly the fields of a manual share: `included_metrics`,
  `series_metrics`, `include_chart`/`include_map`, `visibility`, and an optional fixed
  `message` for the created posts.
- Rules are **created disabled**. Enabling is a separate, deliberate act — the UI states
  plainly that matching data will leave the instance without further confirmation — and
  stamps `enabled_at`. Only a real off→on transition stamps it: re-sending
  `enabled: true` to a rule that is already on (say, alongside another edit) keeps the
  stamp, so nothing ingested in between is skipped.

## Evaluation & timing

- Activity mutations (sync, insert, update, merge) already fire a window-based
  notification; auto-share enqueues an evaluation job for that window on the shared
  pg-boss instance (`startAfter`, 10 minutes). Evaluation reads current state at run
  time, so churn within the delay is naturally absorbed.
- **Settled means settled per activity**, not per window: Health Connect pushes about
  once a minute, so some job always matures within the next minute. A merge group is
  only evaluated once its **youngest member was ingested** at least 10 minutes earlier
  (the stabilisation delay, measured from `activities.created_at`), so the created
  post's scalars and window reflect the settled activity (synced activities are
  frequently merged, enriched, or re-synced shortly after first landing).
- **Garmin-backed activities wait for their detail.** A group with a member carrying
  `data.garmin_activity_id` but no `data.detail_synced: true` (GPS, per-second HR and
  distance not fetched yet) is deferred and re-checked every 10 minutes, for up to
  **two hours** after the anchor was ingested; past that it is shared as is.
- A deferred group **re-queues the window**: one new job per run, starting at the
  earliest time any deferred group can settle. A group that already has a post, or whose
  anchor was ingested before every enabled rule's `enabled_at` (a history backfill), is
  skipped before the settling wait, so it never re-queues.
- A post whose activity gains its Garmin detail later (or whose detail is re-synced by
  hand) is **re-federated as an `Update`**, so remote servers pick up the new scalars
  and attachments — see [Feed](feed.md).
- **Merge-group aware**: matching and the created post both use the group's **anchor**
  (earliest start) and its merged span — the same window a manual share of the merged
  activity covers.
- **Hard dedupe**: at most one post per activity/merge-group EVER. The created post
  records the rule in `feed_posts.autoshare_rule_id`, and evaluation skips any group
  with an existing post referencing any member — manual or auto — so a re-sync, merge,
  or edit can never double-post, and a manually-shared activity is never auto-shared.
  Deleting a post records the activity in `autoshare_suppressions` (post rows are
  hard-deleted), so **a share the user removed never comes back** either. Evaluation is
  idempotent; overlapping windows are safe.
- **Never retroactive**, two gates: the anchor row must have been _ingested_ after the
  rule's `enabled_at` (`activities.created_at`) AND the activity itself must have
  _ended_ after it. The ingest gate makes enabling affect new arrivals only; the
  activity-time gate keeps a first sync or full re-sync of a newly connected source —
  which ingests months of history as fresh rows — from mass-publishing that history.
  A delayed sync of a workout done _after_ enabling still shares. The candidate query
  already leaves out activities that ended before the earliest `enabled_at`, so a
  first sync's wide window costs one query rather than several per old activity.
- **Bounded blast radius**: at most 5 posts per evaluation run (logged when hit) —
  federated deliveries can't be recalled, so even an unexpected window can only leak a
  handful of posts, never a firehose.
- **Naming a session later shares it then.** An activity that did not match a data
  condition when it settled (say, a yoga session without a `session_name`) is shared
  once you name it: the edit is a mutation like any other and queues an evaluation of
  its window. The never-retroactive gates, the dedupe and the per-run cap still apply.
- The **first matching rule** (in creation order) wins; distance is only resolved when
  some eligible rule constrains it.
- Auto-created posts are ordinary feed posts: they federate through the same delivery
  fan-out as a manual share, are editable/unshareable, and show an **auto-shared**
  marker on the owner's feed.

## Surface

- **Web**: the "Auto-share rules" panel on the Feed page — list with enable toggles
  (with an explicit confirmation of what will be published), post counts per rule,
  and a create form (with a **Data conditions** list: field, "has a value" / "is" /
  "is not" / "has no value", and a value suggested from the type's known values) and a
  **Preview** ("would have matched N activities in the last
  30 days" — regardless of shared status, so the number shows the rule's true reach).
- **REST**: `GET/POST /autoshare-rules`, `PATCH/DELETE /autoshare-rules/:id`,
  `POST /autoshare-rules/preview`.
- **MCP** (parity): `list_autoshare_rules`, `add_autoshare_rule`,
  `update_autoshare_rule`, `delete_autoshare_rule`, `preview_autoshare_rule`.

## Out of scope

Retroactive sharing of historical activities — the preview shows what _would have_
matched; enabling only affects new arrivals. Message-from-activity-notes and
time-of-day/weekday predicates are possible follow-ups.
