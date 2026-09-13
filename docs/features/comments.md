# Comments

A comment is a short piece of free text you attach to something you tracked --
or to a bare moment, when there is nothing to attach it to yet. Comments are
what turn a wall of numbers into a record you can read back: *"felt dizzy right
after this"*, *"third night in a row with the window open"*, *"this meal was way
too salty"*.

Internally they live in the `notes` table (the API and MCP tools still call them
notes), one row per comment. See
[Data Storage → `notes`](../data-storage.md#notes---comments-on-anything) for the
columns and constraints.

## The three shapes

### On an entity

Attach a comment to anything Aurboda stores: an **activity** (a run, a sleep
session, a tag like "Sauna"), a **productivity** record, a **metric** data point,
a **report** ([lab results](./lab-reports.md)), or a **meal**.

The comment inherits its parent's `start_time`/`end_time`, so it shows up
wherever that stretch of time is shown. The times are a cache of the parent's --
they are rewritten whenever the parent moves, and cannot be edited on their own.
(For metric comments there is nothing to inherit: the time is already encoded in
the composite `entity_id`, `<iso_time>|<metric>|<source>`.)

### On a moment

Sometimes the thing worth recording is not attached to anything. A comment with
`entity_type: "time"` has no entity at all -- just a `start_time` (required) and
an optional `end_time` for a span rather than an instant. Those times are yours:
you type them, and you can move the comment later.

### A reply

A reply is a comment on a comment: `entity_type: "note"` with `entity_id` set to
the comment being replied to. It inherits the root's times, so the whole thread
sits at one point on the timeline, while its own `created_at` records when you
actually wrote it -- which is how a thread reads as a conversation with yourself
across days.

**Threads are exactly one level deep.** Replying to a reply silently re-anchors
to that reply's root rather than nesting further, so a thread never turns into a
tree.

## Where comments show up

- **Entity pages** -- each activity, meal, report or metric point lists its own
  comments, each with its thread nested under `replies` (oldest first).
- **Daily summary** -- the day's comments appear under `notes`. A comment already
  shown under an activity or a meal in that day's lists is not repeated at day
  level, so nothing is said twice.
- **Timeline** -- a 💬 track for comments anchored in the visible window, so a
  remark sits next to the heart-rate spike it is about: a column of its own in
  vertical mode, a lane at the very top in horizontal. Clicking a bubble opens
  the thread -- reply, edit, move a `time` comment, or follow the link back to
  whatever the comment hangs off. Right-clicking (or long-pressing) anywhere on
  the chart adds a comment, an activity or a metric at that moment. The legend's
  **Comments** toggle hides the track and skips the fetch.
  See [Timeline](./timeline.md).

Replies never appear as top-level entries anywhere -- not in the day's `notes`,
not in an entity's `comments`, not in the outbound Health Connect notes join.
They surface only nested under their root.

## Synced comments

Comments that arrived from a data source carry a `source` (`health_connect`,
`oura`, …). They are ordinary thread roots -- you can reply to them -- but their
content stays owned by the source and is not editable through the notes API.
Replacing an activity's user-typed notes leaves synced comments, and their
replies, untouched.

## Deleting

Deleting a thread root deletes the replies hanging off it. Deleting a reply
removes only that reply.

Deleting the **thing** a comment is about depends on whether that thing can come
back. An activity or productivity record is soft-deleted and restorable, so its
comments are kept and reappear with it. A **meal** is removed for good, so
deleting one deletes its comments and their replies too — otherwise they would
keep drawing a Timeline bubble linking to a meal page that no longer exists, and
list forever as loose day-level notes in the daily summary.

## REST API

| Method   | Path          | What it does                                                                                         |
| -------- | ------------- | ---------------------------------------------------------------------------------------------------- |
| `GET`    | `/notes`      | `?entity_type=&entity_id=` for one entity's comments, or `?from=&to=` for every comment in a window   |
| `POST`   | `/notes`      | Create a comment in any of the three shapes                                                          |
| `PATCH`  | `/notes/:id`  | Change `content`; `start_time`/`end_time` only on a `time` comment                                    |
| `DELETE` | `/notes/:id`  | Delete a comment (and, for a root, its replies)                                                      |

Both `GET` shapes return thread roots with `replies` nested. Setting times on a
comment that is anchored to an entity is a `400`.

## MCP tools

`add_note`, `get_notes`, `query_notes`, `update_note`, `delete_note` -- same
capabilities as the REST endpoints. `query_notes` takes `from`/`to` and is the
tool to reach for when asking "what did I comment on yesterday?". See
[MCP Server](../mcp-server.md#comment-tools).
