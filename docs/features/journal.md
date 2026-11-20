# Journal

A journal for dated entries that never loses a word. It is built on
[comments](./comments.md) rather than a separate store: a journal entry is a
free-standing comment, so an entry is also a comment on that moment on the
Timeline, and a comment written on the Timeline is also in the journal.

Open it from the menu (**Journal**, after Timeline) on the web, or **More → Journal**
in the Android app, which embeds the same page.

## The journal page

`/journal` lists your entries newest first, grouped by day, loading more as you
scroll (or with **Load more**). Each entry shows its time (or "All day"), title,
tags, the start of its text (**Show more** for the rest) and small previews of its
pictures and recordings. At the top:

- **New entry**, and **New entry from template** when you have templates;
- **search** (title and text), a **tag** filter (clicking a `#tag` on an entry adds
  it), **Go to date** (`/journal?date=YYYY-MM-DD` opens there), **Also show
  comments on activities, meals and reports**, and **Photos without text**;
- **On this day**: entries from the same date in earlier years, when there are any;
- **Recently deleted**: deleted entries and templates with the days left before they
  go for good, each with **Restore**;
- **Manage templates**: add, rename, edit and delete them.

## Writing an entry

`/journal/new` (or `/journal/new?template=<id>`, which starts from that template's
text) opens the editor; `/journal/<id>` opens an existing entry. The editor has a
title, the text (markdown, with `#hashtags`), tags, and when: a start and an
optional end time, or **No time of day** with a date. It opens on "now".

- **Autosave**: nothing to press. A change is saved three seconds after you stop
  typing, and at once when you leave the page or a field. The first save creates
  the entry and the address becomes `/journal/<id>`. The status line says _Not
  saved yet_, _Saving…_, _Saved_ or _Not saved yet: will retry_; a failed save is
  retried every ten seconds.
- **Drafts**: every change is also kept in the browser (`localStorage`) until the
  server has confirmed it. If a save never landed -- the tab closed offline, say --
  opening the entry again offers the draft: **Use it** or **Discard**. Drafts are kept
  per account and outlive a sign-out (an expired session must not lose the text), so
  another account in the same browser is never offered them.
- **Conflicts**: if the entry changed elsewhere since you opened it (another tab or
  device), the save answers `409` and nothing is overwritten. The editor shows both
  texts and offers **Keep mine**, **Keep theirs** or **Keep both** (theirs, a `---`
  rule, then yours).
- **History** lists the earlier versions of the text (see revisions below), each
  with **Restore this version**, which makes it the current text through an
  ordinary save.
- **Pictures**: **Add pictures** (several at once, or the camera on a phone), or
  drop or paste them in; they are attached in the order chosen. **Record** captures
  a voice note with the microphone, which the browser asks for the first time.
  Pictures open full size; recordings play inline. Removing one shows **Undo** for
  a few seconds, and it can be restored for 30 days.
- **Delete** removes the entry with an **Undo** notice; it stays in Recently
  deleted for 30 days. An entry left completely empty is removed when you leave it.
- **Replies**: comments on an entry (the same thread the Timeline shows) are listed
  under it.

## On the Timeline

A `time` entry is a comment on the Timeline like any other. A `day` entry has no
time of day, so the Timeline draws it as a 📓 marker at the start of its date, on
the comments track; several on one date are one marker. Clicking it opens the
entry (or, for several, the journal at that date). The comment panel on the
Timeline has **Open in the journal** for any free-standing comment. See
[Timeline](./timeline.md).

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

## Pictures and recordings

An entry (a `time` or `day` thread root) can carry pictures -- a photographed diary
page, say -- and voice recordings. Upload them one file per request,
`POST /notes/:id/attachments` with the file in the multipart field `file`, in page
order: an attachment's `position` is one more than the entry's highest, so upload
order is page order. Entries answer them as `attachments`, live ones in page order,
each with `id`, `kind` (`image` or `audio`), `mime`, `size`, `width`/`height`
(pictures), `position` and `created_at`.

- **Limits**: at most 20 MB per file (`413` beyond; the bundled nginx lets uploads
  to this address through up to 25 MB, and a proxy in front of it must too), 30
  attachments per entry, and
  2 GB for all of an account's attachments, deleted ones counting until they are
  removed for good (`409` for either). The constants are in
  `@aurboda/api-spec` (`note-attachments.ts`).
- **A picture** (PNG, JPEG, WebP or GIF, recognised by its content, not the type
  the client claims) is turned upright from its EXIF orientation, loses all its
  metadata (camera, GPS position), is fitted inside 3000 px -- enough to keep a
  photographed page legible -- and is stored as WebP.
- **A recording** is stored exactly as recorded, as WebM, Ogg, MP4/M4A, MP3 or WAV
  -- the type its first bytes say, not the client's. Anything else is a `400`.
- **Where the bytes live**: in `note_attachments` in your own database, so the
  account export carries them. See
  [Data Storage → `note_attachments`](../data-storage.md#note_attachments---pictures-and-recordings-on-journal-entries).
- **Reading**: `GET /notes/:id/attachments/:attachment_id` serves the file to its
  owner only, privately cached for a year (the bytes never change);
  `?max_edge=400` or `2000` gives a picture downscaled as WebP. A deleted
  attachment, or one on a deleted entry, is a `404`.
- **Deleting is recoverable**: `DELETE /notes/:id/attachments/:attachment_id` hides
  it for 30 days, `GET /notes/:id/attachments?deleted=true` lists what can come
  back with `deleted_at` and `purge_at`, and
  `POST /notes/:id/attachments/:attachment_id/restore` brings it back (a `409` when
  the entry already holds 30). `?purge=true` removes it at once. Deleting the
  entry needs nothing more: its attachments come back when it is restored, and go
  when it is purged.

### Transcribing a photographed page

The server does not read pictures. An assistant does it over MCP:
`search_notes` with `needs_text: true` lists the entries with a picture and no
text yet; `get_note_attachment` hands it each page, in `position` order, as an
image (JPEG, at most 2000 px); `update_note` with the transcription and
`expected_updated_at` writes it. The photos stay attached as the original. A
recording is listed over MCP by its metadata only: it is played in the app.

`add_note_attachment` takes a file base64-encoded, at most 5 MB decoded -- in
practice about 3 MB, since an MCP request is limited to 4 MB of JSON.

## Templates

A template is a `name` (1 to 120 characters, trimmed) and markdown `content` (1 to
20 000 characters) that a new entry starts from. `GET /note-templates` lists them by
name, `POST`, `PATCH /note-templates/:id` and `DELETE` change them. Deleting is
recoverable for 30 days: `?deleted=true` lists the deleted ones with `purge_at`,
`POST /note-templates/:id/restore` brings one back, and `?purge=true` on the delete
removes it at once. Aurboda ships no templates of its own.

## API

| Method   | Path                                            | MCP                             |
| -------- | ----------------------------------------------- | ------------------------------- |
| `POST`   | `/notes`                                        | `add_note`                      |
| `PATCH`  | `/notes/:id`                                    | `update_note`                   |
| `DELETE` | `/notes/:id`                                    | `delete_note`                   |
| `POST`   | `/notes/:id/restore`                            | `restore_note`                  |
| `GET`    | `/notes/:id`                                    | `get_note`                      |
| `GET`    | `/notes/deleted`                                | `list_deleted_notes`            |
| `GET`    | `/notes/:id/revisions`                          | `list_note_revisions`           |
| `GET`    | `/notes/search`                                 | `search_notes`                  |
| `GET`    | `/notes?from=&to=`                              | `query_notes`                   |
| `POST`   | `/notes/:id/attachments`                        | `add_note_attachment`           |
| `GET`    | `/notes/:id/attachments/:attachment_id`         | `get_note_attachment`           |
| `DELETE` | `/notes/:id/attachments/:attachment_id`         | `delete_note_attachment`        |
| `POST`   | `/notes/:id/attachments/:attachment_id/restore` | `restore_note_attachment`       |
| `GET`    | `/notes/:id/attachments?deleted=true`           | `list_deleted_note_attachments` |
| `GET`    | `/note-templates`                               | `list_note_templates`           |
| `POST`   | `/note-templates`                               | `add_note_template`             |
| `PATCH`  | `/note-templates/:id`                           | `update_note_template`          |
| `DELETE` | `/note-templates/:id`                           | `delete_note_template`          |
| `POST`   | `/note-templates/:id/restore`                   | `restore_note_template`         |

An entry for today, without a time of day:

```json
POST /notes
{ "entity_type": "day", "date": "2026-11-20", "title": "First snow", "content": "Walked to the lake #winter", "tags": ["family"] }
```
