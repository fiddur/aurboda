# Auto-share rules

Automatically publish matching activities to the [federated feed](feed.md) once they've
settled — the canonical example: **"share runs longer than 15 minutes."** (#903)

## Model

A per-user set of rules, each combining a **predicate** and a **share template**:

- **Predicate**: activity types (one or more; empty matches any), min/max duration
  (over the **merged span**), min distance (from the `distance` metric over the span),
  and source (e.g. `garmin`).
- **Share template** — exactly the fields of a manual share: `included_metrics`,
  `series_metrics`, `include_chart`/`include_map`, `visibility`, and an optional fixed
  `message` for the created posts.
- Rules are **created disabled**. Enabling is a separate, deliberate act — the UI states
  plainly that matching data will leave the instance without further confirmation — and
  stamps `enabled_at`.

## Evaluation & timing

- Activity mutations (sync, insert, update, merge) already fire a window-based
  notification; auto-share enqueues an evaluation job for that window on the shared
  pg-boss instance with a **stabilisation delay** (`startAfter`, 10 minutes), so the
  created post's scalars and window reflect the settled activity (synced activities are
  frequently merged, enriched, or re-synced shortly after first landing). Evaluation
  reads current state at run time, so churn within the delay is naturally absorbed.
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
- **Never retroactive**, two gates: the anchor row must have been *ingested* after the
  rule's `enabled_at` (`activities.created_at`) AND the activity itself must have
  *ended* after it. The ingest gate makes enabling affect new arrivals only; the
  activity-time gate keeps a first sync or full re-sync of a newly connected source —
  which ingests months of history as fresh rows — from mass-publishing that history.
  A delayed sync of a workout done *after* enabling still shares.
- **Bounded blast radius**: at most 5 posts per evaluation run (logged when hit) —
  federated deliveries can't be recalled, so even an unexpected window can only leak a
  handful of posts, never a firehose.
- The **first matching rule** (in creation order) wins; distance is only resolved when
  some eligible rule constrains it.
- Auto-created posts are ordinary feed posts: they federate through the same delivery
  fan-out as a manual share, are editable/unshareable, and show an **auto-shared**
  marker on the owner's feed.

## Surface

- **Web**: the "Auto-share rules" panel on the Feed page — list with enable toggles
  (with an explicit confirmation of what will be published), post counts per rule,
  and a create form with a **Preview** ("would have matched N activities in the last
  30 days" — regardless of shared status, so the number shows the rule's true reach).
- **REST**: `GET/POST /autoshare-rules`, `PATCH/DELETE /autoshare-rules/:id`,
  `POST /autoshare-rules/preview`.
- **MCP** (parity): `list_autoshare_rules`, `add_autoshare_rule`,
  `update_autoshare_rule`, `delete_autoshare_rule`, `preview_autoshare_rule`.

## Out of scope

Retroactive sharing of historical activities — the preview shows what *would have*
matched; enabling only affects new arrivals. Message-from-activity-notes and
time-of-day/weekday predicates are possible follow-ups.
