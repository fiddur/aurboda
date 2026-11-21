# Comments

A comment is a short piece of free text you attach to something you tracked --
or to a bare moment or a whole day, when there is nothing to attach it to yet. Comments are
what turn a wall of numbers into a record you can read back: _"felt dizzy right
after this"_, _"third night in a row with the window open"_, _"this meal was way
too salty"_.

Internally they live in the `notes` table (the API and MCP tools still call them
notes), one row per comment. The [journal](./journal.md) is built on the same
rows: a journal entry is a free-standing comment. See
[Data Storage → `notes`](../data-storage.md#notes---comments-on-anything) for the
columns and constraints.

## The four shapes

### On an entity

Attach a comment to anything Aurboda stores: an **activity** (a run, a sleep
session, a tag like "Sauna"), a **productivity** record, a **metric** data point,
a **report** ([lab results](./lab-reports.md)), or a **meal**.

A comment can also be about a [**person**](./people.md) (`entity_type: "person"`
with the person's ID). A person has no time, so such a note has none either: it is
not on the Timeline or in search, and is read through the person. A note about an
unknown or deleted person is refused as not found.

The comment inherits its parent's `start_time`/`end_time`, so it shows up
wherever that stretch of time is shown. The times are a cache of the parent's --
they are rewritten whenever the parent moves, and cannot be edited on their own.
(For metric comments there is nothing to inherit: the time is already encoded in
the composite `entity_id`, `<iso_time>|<metric>|<source>`.)

### On a moment

Sometimes the thing worth recording is not attached to anything. A comment with
`entity_type: "time"` has no entity at all -- just a `start_time` (required) and
an optional `end_time` for a span rather than an instant. Those times are yours:
you type them, and you can move the comment later. An `end_time` before the
`start_time` is refused with a `400`.

### On a day

A comment with `entity_type: "day"` is pinned to a calendar date with no time of
day: no `entity_id`, no `start_time`/`end_time`, and a required `date`
(`YYYY-MM-DD`, a real calendar date). It is a date, not an instant, so it stays on
that day whatever your timezone is or becomes. A `time` comment and a `day`
comment can be switched into each other: giving a `time` comment a `date` makes it
a `day` comment (its times are dropped), and giving a `day` comment a `start_time`
makes it a `time` comment (its date is dropped). Sending a `date` together with
times is a `400`.

`time` and `day` comments are the **free-standing** ones, and the only ones whose
text may be empty (`""`): a journal entry can exist before its text does.

### A reply

A reply is a comment on a comment: `entity_type: "note"` with `entity_id` set to
the comment being replied to. It inherits the root's times (or, under a `day`
comment, its `date`), so the whole thread
sits at one point on the timeline, while its own `created_at` records when you
actually wrote it -- which is how a thread reads as a conversation with yourself
across days.

**Threads are exactly one level deep.** Replying to a reply silently re-anchors
to that reply's root rather than nesting further, so a thread never turns into a
tree.

## Titles and tags

A thread root of any shape can have a `title` (at most 200 characters, trimmed; an
empty one or `null` clears it). A reply cannot: that is a `400`.

`tags` are the ones you set explicitly (at most 20, each letters, digits and `_`,
not only digits; stored lowercase without `#`; an invalid one is a `400`). Every
`#hashtag` written in the content is a tag too, recognised exactly as the feed
recognises a post's hashtags (not inside a word, a URL or markdown code) and
recomputed whenever the content changes. Every answer's `tags` is the union of
both, deduplicated and sorted, and tag filters match against that union.

## Related people and activities

A thread root can be related to people and activities without being a comment on
them: `related` on `POST /notes` and `PATCH /notes/:id` is the full list of
`{ entity_type: "person" | "activity", entity_id }` (at most 30; present replaces,
`[]` clears, absent leaves). A reply cannot carry it (`400`), nor an unknown or deleted
target (`400` naming it). Every thread root in an answer carries `related` with a
display `label` for each live target. See [Journal → Related](./journal.md#related).

## Where comments show up

- **Entity pages** -- each activity, meal, report or metric point lists its own
  comments, each with its thread nested under `replies` (oldest first).
- **Daily summary** -- the day's comments appear under `notes`, the `day`
  comments for that date included. A comment already
  shown under an activity or a meal in that day's lists is not repeated at day
  level, so nothing is said twice.
- **Timeline** -- a 💬 track for comments anchored in the visible window, so a
  remark sits next to the heart-rate spike it is about: a column of its own in
  vertical mode, a lane at the very top in horizontal. Clicking a bubble opens
  the thread -- reply, edit, move a `time` comment, or follow the link back to
  whatever the comment hangs off. Right-clicking (or long-pressing) anywhere on
  the chart adds a comment, an activity or a metric at that moment. The legend's
  **Comments** toggle hides the track and skips the fetch.
  See [Timeline](./timeline.md). The range read also returns the `day` comments
  of the window's dates; the Timeline does not draw those yet.
- **Search** -- `GET /notes/search` (MCP `search_notes`) lists and searches thread
  roots; see [Finding comments](#finding-comments).

Replies never appear as top-level entries anywhere -- not in the day's `notes`,
not in an entity's `comments`, not in the outbound Health Connect notes join.
They surface only nested under their root.

## Synced comments

Comments that arrived from a data source carry a `source` (`health_connect`,
`oura`, …). They are ordinary thread roots -- you can reply to them -- but their
content stays owned by the source and is not editable through the notes API.
Replacing an activity's user-typed notes leaves synced comments, and their
replies, untouched. When the source moves the comment in time, its replies move
with it; when the source clears it, the comment and its replies are deleted.

## Deleting

**Deleting a comment can be undone.** Anything that takes more than a few
seconds to write again is soft-deleted: `DELETE /notes/:id` (MCP `delete_note`)
sets `deleted_at` on the comment, and on a thread root also on its replies that
are not already deleted, with the same timestamp. A deleted comment is gone from
every read -- entity pages, the Timeline, the daily summary, search, the Health
Connect notes join -- and cannot be edited or replied to (`404`, as if absent).
Its revisions go out of sight with it.

- `GET /notes/deleted` (MCP `list_deleted_notes`) lists what can be restored,
  newest deletion first: deleted thread roots (each with the replies deleted with
  it), and deleted replies whose root is live. Each carries `deleted_at` and
  `purge_at` (`deleted_at` + 30 days).
- `POST /notes/:id/restore` (MCP `restore_note`) brings a comment back. A root
  brings back the replies deleted with it (the same `deleted_at`); a reply deleted
  on its own before stays deleted. Restoring a reply whose root is deleted is a
  `409` ("restore the comment it replies to first"). Restoring a comment that is
  not deleted answers it as it is.
- 30 days after `deleted_at`, the daily prune pass removes the comment for good,
  with the replies of the roots it removes.
- `DELETE /notes/:id?purge=true` (MCP `delete_note` with `purge: true`) removes a
  comment and its replies for good at once, deleted or not -- for when something
  must be erased now.

The [account export](../data-export.md) is a dump of your whole database, so it
carries soft-deleted comments (with their `deleted_at`) too.

Deleting the **thing** a comment is about depends on whether that thing can come
back:

- An **activity** or **productivity** record is soft-deleted and restorable, so
  its comments are kept, but hidden from the time-range read (the Timeline, the
  daily summary's day-level `notes`, `GET /notes?from=&to=` and `query_notes`) and
  from search while it is deleted. Restoring it brings them back; nothing about
  the comments changes in between.
- A **meal** or a **report** is removed for good, so deleting one deletes its
  comments and their replies in the same transaction, deleted ones included.
- A comment whose parent does not exist at all is left out of the time-range read
  and search too, so no bubble ever links to something that 404s. Nothing is
  re-anchored. Metric comments carry no times and are never in either.

## Never losing text

- **Stale writes are refused.** `PATCH /notes/:id` takes an optional
  `expected_updated_at` -- the `updated_at` the edit started from. When the comment
  has changed since (compared to the millisecond), nothing is written and the
  answer is a `409`:
  `{ "success": false, "error": "This comment was changed elsewhere", "data": <the comment as it now is> }`.
  The check and the write are one transaction. A move or a switch of kind is also
  refused with a `409` when the comment's kind changed under it (another edit
  switched it between `time` and `day` meanwhile), with or without
  `expected_updated_at`. MCP `update_note` answers the same as an error whose text
  carries the current comment.
- **Revisions.** Whenever an edit changes the content or the title, the text it
  replaces is kept in `note_revisions`, in the same transaction -- unless the
  newest revision is less than 10 minutes old: an editor that saves every few
  seconds keeps one revision per burst, the text as it stood before it. The latest
  50 per comment are kept. `GET /notes/:id/revisions` (MCP `list_note_revisions`)
  lists them newest first (`id`, `content`, `title`, `saved_at`); going back to one
  is an ordinary update with its text. A change of `related` alone keeps no revision. Synced comments are not editable, so they
  have none.

## Finding comments

`GET /notes/search` (MCP `search_notes`) answers thread roots with their replies
nested, newest first, and `next_cursor` for the next page. With no parameter it
lists the free-standing comments (`time` and `day`), which is what the journal
reads.

| Parameter                    | What it does                                                                                                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `q`                          | Full-text search over title and content (PostgreSQL `websearch_to_tsquery`, `simple` configuration, so any language); the last word also matches as a prefix. A match in a reply returns its root |
| `tags`                       | Comma-separated: only comments carrying all of them                                                                                                                                               |
| `from`, `to`                 | Local dates, inclusive: a `day` comment's `date`, else its `start_time`'s date in `tz`                                                                                                            |
| `on_this_day`                | A date: comments on the same month and day in earlier years (on 28 February of a non-leap year, 29 February counts too)                                                                           |
| `entity_types`               | Comma-separated root types, default `time,day`; add `activity`, `meal`, … to include comments on those. `note` is refused                                                                         |
| `tz`                         | The timezone local dates are read in (default: your timezone)                                                                                                                                     |
| `limit`                      | 1--200, default 50                                                                                                                                                                                |
| `cursor`                     | The `next_cursor` of the previous page                                                                                                                                                            |
| `needs_text`                 | `true`: only entries with a live picture and no text yet (the range read `GET /notes?from=&to=` takes it too)                                                                                     |
| `related_type`, `related_id` | Both or neither: only comments related to that person or activity (by its own id; a deleted target matches nothing)                                                                               |

The order is newest first by anchor -- a `day` comment's anchor is the start of
its date in `tz` -- then by `created_at` and `id`. Comments with no anchor at all
(metric comments) are never listed.

## Pictures, recordings and templates

A journal entry -- a `time` or `day` thread root, never a reply or a comment on an
entity -- can carry pictures and voice recordings, and the answers for such a root
carry them as `attachments` (in page order). Entries can also start from a
template. Both, with their limits and their recoverable deletion, are described in
[Journal → Pictures and recordings](./journal.md#pictures-and-recordings) and
[Journal → Templates](./journal.md#templates).

## REST API

| Method   | Path                   | What it does                                                                                                                                        |
| -------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/notes`               | `?entity_type=&entity_id=` for one entity's comments, or `?from=&to=` (optional `tz`) for every comment in a window and the `day` ones on its dates |
| `GET`    | `/notes/:id`           | One comment: a thread root with its `replies` and `attachments`, or a single reply                                                                  |
| `GET`    | `/notes/search`        | List and search thread roots (see [Finding comments](#finding-comments))                                                                            |
| `GET`    | `/notes/deleted`       | The deleted comments that can still be restored                                                                                                     |
| `POST`   | `/notes`               | Create a comment in any of the four shapes, with an optional `title`, `tags` and (not on a reply) `related`                                         |
| `PATCH`  | `/notes/:id`           | Change `content`, `title`, `tags`, `related`; times on a `time` comment, `date` on a `day` one (switching kinds as above); `expected_updated_at`    |
| `DELETE` | `/notes/:id`           | Delete a comment (and, for a root, its replies), restorable for 30 days; `?purge=true` removes it for good                                          |
| `POST`   | `/notes/:id/restore`   | Restore a deleted comment                                                                                                                           |
| `GET`    | `/notes/:id/revisions` | A comment's earlier texts, newest first                                                                                                             |

Both `GET /notes` shapes return thread roots with `replies` nested. In the window
read, `to` is exclusive for `day` comments too: a window ending exactly at a local
midnight does not take in the next date's. `tz` must be an IANA name (`400`
otherwise; a tool error over MCP). Setting times on a
comment that is anchored to an entity is a `400`, and so is an `entity_id` that is
not a UUID for an entity type keyed by one (everything but `metric`, whose key is
composite). `PATCH` on a comment that does not exist (or is deleted) is a `404`,
and on one changed since `expected_updated_at` a `409`. `GET /notes/:id` on one that
does not exist (or is deleted) is a `404`.

## MCP tools

`add_note`, `get_note`, `get_notes`, `query_notes`, `search_notes`, `update_note`,
`delete_note`, `restore_note`, `list_deleted_notes`, `list_note_revisions` -- same
capabilities as the REST endpoints. `query_notes` takes `from`/`to` and is the
tool to reach for when asking "what did I comment on yesterday?"; `search_notes`
for "when did I write about the river?". See
[MCP Server](../mcp-server.md#comment-tools).
