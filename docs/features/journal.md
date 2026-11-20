# Journal

A journal for dated entries that never loses a word. It is built on
[comments](./comments.md) rather than a separate store: a journal entry is a
free-standing comment, so an entry is also a comment on that moment on the
Timeline, and a comment written on the Timeline is also in the journal.

This page describes the data model and the API as they stand. Pictures and voice
recordings, templates, the `/journal` page and the Android screen are still to
come ([#1801](https://github.com/fiddur/aurboda/issues/1801)).

## What an entry is

A row in `notes` (see [Data Storage → `notes`](../data-storage.md#notes---comments-on-anything))
of one of two kinds:

- a **`time`** entry, anchored to a moment: `start_time` required, `end_time`
  optional;
- a **`day`** entry, pinned to a calendar date with no time of day: no
  `entity_id`, no times, and a required `date` (`YYYY-MM-DD`). It is a date, not an
  instant, so it stays on that day whatever your timezone is or becomes.

An entry can be switched between the two: `PATCH /notes/:id` with a `date` turns a
`time` entry into a `day` entry, and with a `start_time` turns a `day` entry into a
`time` one. Its replies move with it.

Every entry may have:

- a **`title`** (at most 200 characters);
- **`tags`**: the ones set explicitly, plus every `#hashtag` written in the text.
  Answers carry the union, lowercase, sorted;
- **empty text**, which only free-standing entries may have.

Comments on activities, meals, reports and productivity records are journal
material too: search includes them when `entity_types` names them.

## Never losing a word

- **Stale writes are refused**: an edit sent with `expected_updated_at` that no
  longer matches answers `409` with the entry as it now is, and writes nothing.
- **Revisions**: every edit of the text or title keeps the text it replaced (one
  per 10 minutes of editing, the latest 50); `GET /notes/:id/revisions` lists them.
- **Deleting is recoverable** for 30 days (`DELETED_NOTE_RETENTION_DAYS` in
  `@aurboda/api-spec`): `GET /notes/deleted` lists what can be restored and
  `POST /notes/:id/restore` brings an entry back with its replies. After 30 days the
  daily prune removes it for good; `DELETE /notes/:id?purge=true` does so at once.
  The account export carries deleted entries too.

See [Comments](./comments.md) for the exact rules.

## Finding entries

`GET /notes/search` (MCP `search_notes`) is the journal's one read: newest first,
paged with `next_cursor`, free-standing entries by default. It takes full-text `q`
(title and content, the last word as a prefix, a reply's match returns its root),
`tags` (all of them), `from`/`to` local dates, and `on_this_day` -- entries from the
same month and day in earlier years, 29 February included on a non-leap 28
February. A `day` entry sorts at the start of its date in your timezone. The
full-text index covers the first 100 000 characters of an entry. See
[Comments → Finding comments](./comments.md#finding-comments).

The Timeline's range read (`GET /notes?from=&to=`, MCP `query_notes`) returns the
`day` entries of the window's dates alongside the timed ones; the daily summary
lists the day's `day` entries under `notes`.

## API

| Method   | Path                   | MCP                   |
| -------- | ---------------------- | --------------------- |
| `POST`   | `/notes`               | `add_note`            |
| `PATCH`  | `/notes/:id`           | `update_note`         |
| `DELETE` | `/notes/:id`           | `delete_note`         |
| `POST`   | `/notes/:id/restore`   | `restore_note`        |
| `GET`    | `/notes/deleted`       | `list_deleted_notes`  |
| `GET`    | `/notes/:id/revisions` | `list_note_revisions` |
| `GET`    | `/notes/search`        | `search_notes`        |
| `GET`    | `/notes?from=&to=`     | `query_notes`         |

An entry for today, without a time of day:

```json
POST /notes
{ "entity_type": "day", "date": "2026-11-20", "title": "First snow", "content": "Walked to the lake #winter", "tags": ["family"] }
```
