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
  an override row (editing a synced activity can create one) counts for the group. A
  member replaced by another member — the synced row behind an edit's override — is
  left out, so a value you corrected or cleared never comes back from the original.
- **Max age** (`max_age_hours`, default 24, 1 to 8760): a rule shares an activity only
  when it _ended_ at most this many hours before it _arrived_ (its youngest merge-group
  member's ingest). The waits before sharing — the rule's own wait, the Garmin detail
  wait — do not count against it, so a long wait never eats the max age. A history
  update that makes old activities newly match — an enrich rule run over history that
  adds `session_name`, a re-sync, an import — therefore does not publish them. For an
  activity that arrived earlier and only now starts matching, the limit is the max age
  plus the time a rule may wait (its own wait and the two-hour detail wait), counted
  back from the evaluation. The flip side: an activity whose phone sync is delayed past
  the max age is not shared either. Rules created before the field existed have 24.
- **Wait** (`delay_minutes`, default 10, 10 to 1440): how long after the activity
  arrived (its youngest merge-group member's ingest) the rule waits before sharing it.
  The default equals the stabilisation delay, so it changes nothing; a longer wait gives
  you more time to stop a share from the [pending-share
  notification](#pending-share-notification).
- **Share template** — exactly the fields of a manual share: `included_metrics`,
  `series_metrics`, `include_chart`/`include_map`, `include_exercises` (off by default; a
  strength-training rule can share each exercise's sets, e1RM, volume and records),
  `visibility`, and an optional fixed `message` for the created posts.
- **Tags** (`tags`, nullable): `null` (the default) gives the created posts the owner's
  default tags; a list replaces them for this rule's posts (`[]` for none). The activity
  type tag still follows the owner's `feed_type_tag` setting, and `#tags` in the fixed
  message are added too — see [Hashtags](feed.md#hashtags).
- Rules are **created disabled**. Enabling is a separate, deliberate act — the UI states
  plainly that matching data will leave the instance without further confirmation — and
  stamps `enabled_at`. Only a real off→on transition stamps it: re-sending
  `enabled: true` to a rule that is already on (say, alongside another edit) keeps the
  stamp, so nothing ingested in between is skipped.

## Evaluation & timing

- **An open activity is not shared**: one without an `end_time` is no candidate. A
  [live strength session](strength-logging.md#live-sessions) stays open until it is finished.
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
- **A shared activity that changes later is re-federated** as an `Update` too: a new
  title or data, a merge, a re-sync with different values. The same evaluation pass
  compares each activity post's version with the newest change in its merge group
  (`activities.updated_at`, set only on a real change) and, once that change is 10
  minutes old, re-delivers the post. This applies to **manual shares** as well, has
  **no age limit**, and runs whether or not any rule is enabled.
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
  A delayed sync of a workout done _after_ enabling still shares, as long as it is
  within the rule's max age.
- **Recent activities only**: on top of the two gates, the activity must have ended
  within the rule's `max_age_hours` of its arrival. A rule's cutoff for a group is the
  later of its `enabled_at` and _arrival − max age_, the same in the announce pass and
  in the evaluation, so what was announced is also shared. An arrival further back than
  the waits can explain — the rule's wait plus the two-hour detail wait and its last
  re-check — is a group that only now started matching (an edit, an enrich run), and
  that is measured from _now − that wait budget_ instead. The candidate query already
  leaves out activities that ended before the loosest cutoff over the enabled rules, so
  a first sync's wide window costs one query rather than several per old activity.
- **Bounded blast radius**: at most 5 posts per evaluation run (logged when hit) —
  federated deliveries can't be recalled, so even an unexpected window can only leak a
  handful of posts, never a firehose.
- **Naming a session later shares it then.** An activity that did not match a data
  condition when it settled (say, a yoga session without a `session_name`) is shared
  once you name it: the edit is a mutation like any other and queues an evaluation of
  its window. The never-retroactive gates, the dedupe and the per-run cap still apply.
- The **first matching rule** (in creation order) wins; distance is only resolved when
  some eligible rule constrains it.
- **The rule's wait**: a settled group is shared only once its rule's `delay_minutes`
  have passed since its youngest member was ingested; until then the window is re-queued
  for that time, like an unsettled group.
- Auto-created posts are ordinary feed posts: they federate through the same delivery
  fan-out as a manual share, are editable/unshareable, and show an **auto-shared**
  marker on the owner's feed.

### Pending-share notification

Before an activity is auto-shared you get an `autoshare_pending`
[notification](notifications.md) ("Your new strength training will be shared in about
10 minutes"; "… once its Garmin details have synced" while only the detail wait is
left), with the activity's title, the rule and the visibility, and a **Don't share**
button.

- **When**: every activity mutation also queues an **announce-only pass** over its window
  30 seconds later (`autoshare-announce`), which walks the same guards as the evaluation
  but never shares and never re-queues; it announces every group that matches a rule and
  has no post or suppression. The evaluation announces too whenever it holds a matching
  group back (still settling, or within the rule's wait). The notification is stored
  once per activity (its `dedupe_key` is `autoshare_pending:<activity id>`), and
  announces are capped at 5 per run like posts.
- **Don't share** (`skip`) records the activity and the rest of its merge group in
  `autoshare_suppressions`, so no rule ever shares it; the notification then reads
  "will not be shared". If the share won the race, the answer is "This activity was
  already shared" and the notification links to the post. The same is available as
  `POST /autoshare-rules/skips` / `skip_autoshare` with an `activity_id`.
- **Shared**: once the post is created, the notification is revised in place to "Your
  … was shared", linking to the post, and its button is removed.
- A skipped activity **can still be shared by hand**: the manual share does not consult
  the suppressions.

## Surface

- **Web**: the "Auto-share rules" panel in the Feed page's **Manage** section — list with enable toggles
  (with an explicit confirmation of what will be published), post counts per rule,
  and a create form (with a **Data conditions** list: field, "has a value" / "is" /
  "is not" / "has no value", and a value suggested from the type's known values) and a
  **Preview** ("would have matched N activities in the last
  30 days" — regardless of shared status, `enabled_at` and the max age, so the number
  shows the predicate's true reach). The form's "Only activities that ended within …
  hours" field sets the max age (default 24), and its "Wait before sharing (minutes)"
  field the wait (10 to 1440, default 10). The rule list states the max age ("ended
  within 24 h"), the wait when it is not 10 ("waits 30 min"), along with the tags the rule's posts get: its own list or "your
  default tags", plus any `#tags` typed in the fixed message ("no tags" when that is
  empty). The form shows the same line, live, under **Tags**. Each rule's **Edit**
  button opens the same form prefilled under the rule, to
  see its full settings and change them; **Save** sends an update (a cleared field
  goes back to unset, cleared own tags back to the default tags). An edit applies to
  activities shared from then on; posts the rule already published are not changed,
  and the rule keeps its on/off state. What the form does not show — max duration,
  source, and more than one activity type (listed read-only) — is left as it is;
  those are edited through the REST API or MCP. The Android app embeds this page.
- **REST**: `GET/POST /autoshare-rules`, `PATCH/DELETE /autoshare-rules/:id`,
  `POST /autoshare-rules/preview`, `POST /autoshare-rules/skips` (`{ activity_id }`:
  200 with the merge group's `activity_ids`, 404 for an unknown activity, 409 when it is
  already shared).
- **MCP** (parity): `list_autoshare_rules`, `add_autoshare_rule`,
  `update_autoshare_rule`, `delete_autoshare_rule`, `preview_autoshare_rule`,
  `skip_autoshare`.

## Out of scope

Retroactive sharing of historical activities — the preview shows what _would have_
matched; enabling only affects new arrivals. Message-from-activity-notes and
time-of-day/weekday predicates are possible follow-ups.
