# Journal

A journal for dated entries that never loses a word. It is built on
[comments](./comments.md) rather than a separate store: a journal entry is a
free-standing comment, so an entry is also a comment on that moment on the
Timeline, and a comment written on the Timeline is also in the journal.

Open it from the menu (**Log → Journal**) on the web, or **More → Journal**
in the Android app, which embeds the same page.

## The journal page

`/journal` lists your entries newest first, grouped by day, loading more as you
scroll (or with **Load more**). Each entry shows its time (or "All day"), title,
tags, the start of its text (**Show more** for the rest) and small previews of its
pictures and recordings. At the top:

- **New entry**, and **New entry from template** when you have templates;
- **search** (title and text), a **tag** filter (clicking a `#tag` on an entry adds
  it, as does picking one under **Tags**, which lists them most used first;
  `/journal?tag=<tag>` opens with it), a **Related to** filter (a person or an
  activity, picked from People and Activities tabs), **Go to date** (`/journal?date=YYYY-MM-DD` opens there), **Also show
  comments on activities, meals and reports**, and **Photos without text**;
- **On this day**: entries from the same date in earlier years, when there are any;
- **Recently deleted**: deleted entries and templates with the days left before they
  go for good, each with **Restore**;
- **Manage templates**: add, rename, edit and delete them;
- **Manage tags** (at the foot of **Tags**, `/journal/tags`): every tag with how many
  entries carry it and when it was last used, each opening the journal filtered on
  it, and **Merge into…** another tag (see [Tags](#tags)).

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
- **Related**: chips for the people and activities the entry is about, an
  activity's with its type's icon. **+ Add** picks a person, or an activity of the
  entry's day (last night's sleep listed, and labelled, under the morning it ended);
  typing `@` offers people too. Archived people are not offered for a new link, but
  an entry that already links one keeps the chip. If a save is refused because a
  linked person or activity was removed since (a draft kept from before, say), the
  chip turns red and says so; remove it and the entry saves.

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
  An entry created empty keeps no empty first version: the first revision is the
  first text it had.
- **Deleting is recoverable** for 30 days (`DELETED_NOTE_RETENTION_DAYS` in
  `@aurboda/api-spec`): `GET /notes/deleted` lists what can be restored and
  `POST /notes/:id/restore` brings an entry back with its replies. After 30 days the
  daily prune removes it for good; `DELETE /notes/:id?purge=true` does so at once.
  The account export carries deleted entries too.

See [Comments](./comments.md) for the exact rules.

## Related

An entry can be **related to** any number of people (see [People](./people.md)) and
activities without being a comment on any of them: today's entry mentions a partner,
another is about last night's sleep. A link is made explicitly, never by reading the
text; removing a name from the text does not remove the link, and a link can exist with
nothing about it in the text.

- **Model.** `note_links` holds `note_id`, `entity_type` (`person` or `activity`),
  `entity_id` and `created_at`, one row per note and target. Only a thread root carries
  links (a `day` or `time` entry, or a comment on something); a reply is refused with a
  `400`. Targets are referenced by id and their labels resolved when read, so a renamed
  person or a retyped activity stays right.
- **Making one.** `related` on `POST /notes` and `PATCH /notes/:id` (MCP `add_note`,
  `update_note`) is the full list of `{ entity_type, entity_id }`, at most 30,
  duplicates collapsed: it replaces the links when present, `[]` removes them all, and
  leaving it out leaves them. An unknown, malformed or deleted target is a `400` naming
  it (`Unknown person: <id>`, `Unknown activity: <id>`). A change of links follows the
  same `expected_updated_at` check as the text (a stale one is the usual `409`); it bumps
  `updated_at` but keeps no text revision.
- **Where it shows.** Every thread root in an answer carries `related`: each target's
  `entity_type`, `entity_id` and a `label` -- the person's name, or the activity's title
  (else its type's name) with its local date, "Evening walk, 2026-11-20" (a sleep is dated
  by the morning it ended), and for an activity its `activity_type`. `GET /people/:id`
  (MCP `get_person`) and the activity detail (`GET /activities/:id`,
  `GET /activities/:id/full`, MCP `get_activity_detail`) carry `journal_entries`: the
  related entries newest first, at most 50, each with `id`, `title`, `entity_type`,
  `date` or `start_time`, and `excerpt` (the first non-empty line, at most 200
  characters). A merged activity lists the entries related to any of its source rows,
  and merging activities relates their entries to the merged one. On the Timeline
  nothing changes: an entry stays where its own time puts it.
- **The filter.** `GET /notes/search` takes `related_type` (`person` or `activity`) with
  `related_id`, both or neither, and combines them with every other filter. An activity
  is matched by the id given.
- **Deleted targets.** A link to a soft-deleted person or activity is hidden while its
  target is deleted and back on restore; it goes when the target is removed for good
  (for an activity a database trigger removes it, whatever removes the activity: a
  purge, a source's delete, a rule's regeneration or an orphaned override).
  Replacing an entry's links only touches the visible ones, so a hidden link survives
  an edit and comes back with its target.
  A deleted entry's links are out of sight with it and come back with it.
- **Privacy.** As the rest of People: links never leave your account. A note is never
  shared, and nothing about its links goes into an activity's share, the feed or
  anything federated.

## Finding entries

`GET /notes/search` (MCP `search_notes`) is the journal's one read: newest first,
paged with `next_cursor`, free-standing entries by default. It takes full-text `q`
(title and content, the last word as a prefix, a reply's match returns its root),
`tags` (all of them), `from`/`to` local dates, `related_type`/`related_id` (see
[Related](#related)), and `on_this_day` -- entries from the
same month and day in earlier years, 29 February included on a non-leap 28
February. A `day` entry sorts at the start of its date in your timezone. The
full-text index covers the first 100 000 characters of an entry. See
[Comments → Finding comments](./comments.md#finding-comments).

An open entry links to the one before and after it in that same order, unfiltered:
`←` the older, `→` the newer, and the arrow keys step through them when no text field
has focus. `GET /notes/:id/neighbors` (MCP `get_note_neighbors`) answers them as
`previous` (older) and `next` (newer), each with its `date` or `start_time`, `title`
and `excerpt`; an id that is not a live entry is a `404`.

## Tags

A tag is either set explicitly or written as a `#hashtag` in the text; both count
the same. `GET /notes/tags` (MCP `list_note_tags`) lists them most used first, each
with `count` (the live notes carrying it, each note once) and `last_used` (the
newest carrying note's time, a `day` entry at the start of its date in `tz`). Like
search it reads the free-standing entries unless `entity_types` names more.

`POST /notes/tags/merge` (MCP `merge_note_tags`) with `{ "from": ["running", "jog"],
"into": "run" }` gives every live note carrying a `from` tag -- entries, comments
and replies alike -- `into` instead: explicit tags are replaced, and each `#running`
or `#jog` in the text is rewritten to `#run` (not inside code or a URL). A rewritten
text keeps its previous version as a revision. Renaming is a merge with one `from`.
It answers how many notes `changed`; `into` among `from` is a `400`. A synced
comment (from Oura and the like) is left alone.

The Timeline's range read (`GET /notes?from=&to=`, MCP `query_notes`) returns the
`day` entries of the window's dates alongside the timed ones; the daily summary
lists the day's `day` entries under `notes`, each with its `attachments` like any
other read.

## Pictures and recordings

An entry (a `time` or `day` thread root) can carry pictures -- a photographed diary
page, say -- and voice recordings. Upload them one file per request,
`POST /notes/:id/attachments` with the file in the multipart field `file`, in page
order: an attachment's `position` is one more than the entry's highest, so upload
order is page order. Uploads to one account are taken one at a time for the
count, position and space checks, so parallel uploads cannot share a position or
pass a cap together. Every answer of an entry -- reads, the daily summary, and the
`POST /notes` that creates it (`[]`) -- carries them as `attachments`, live ones in
page order, each with `id`, `kind` (`image` or `audio`), `mime`, `size`,
`width`/`height` (pictures), `position` and `created_at`.

- **Limits**: at most 20 MB per file (`413` beyond; the bundled nginx lets uploads
  to this address through up to 25 MB, and a proxy in front of it must too), 30
  attachments per entry, and
  2 GB for all of an account's attachments, deleted ones counting until they are
  removed for good (`409` for either). The constants are in
  `@aurboda/api-spec` (`note-attachments.ts`).
- **A picture** (PNG, JPEG, WebP or GIF, recognised by its content, not the type
  the client claims) is turned upright from its EXIF orientation, is fitted inside
  3000 px -- enough to keep a photographed page legible -- and is stored as WebP.
  It keeps its metadata (EXIF such as when and where it was taken and the camera,
  ICC and XMP), with the orientation reset so a viewer does not turn it again:
  the journal is private, so that is the owner's to keep. The user setting
  `journal_strip_metadata` (Settings → Journal, "Remove metadata from Journal
  pictures"; `PATCH /user/settings`, MCP `update_user_settings`; default `false`)
  removes it from pictures added from then on; pictures already stored stay as
  they are. The downscaled previews (`?max_edge=`) and the copy an assistant gets
  carry no metadata either way.
- **A recording** is stored exactly as recorded, as WebM, Ogg, MP4/M4A, MP3 or WAV
  -- the type its first bytes say, not the client's -- with whatever metadata the
  recorder wrote into the file (a phone's voice memo can carry where it was made),
  whatever the setting says. An MP4 with a video track (a `hdlr` box naming the
  `vide` handler) is a video, not a recording, and is refused. Anything else is a
  `400`.
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
For anything larger than a few hundred kB, or a file on disk, `create_upload_url`
(`POST /uploads`) with `target: "note_attachment"` and the entry's `note_id` mints a
single-use URL good for 15 minutes; the client sends the raw bytes there
(`curl -T page.jpg '<upload_url>'`) and gets back the attachment, up to 20 MB. See
[Uploading files](../mcp-server.md#uploading-files).

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
| `GET`    | `/notes/:id/neighbors`                          | `get_note_neighbors`            |
| `GET`    | `/notes/search`                                 | `search_notes`                  |
| `GET`    | `/notes/tags`                                   | `list_note_tags`                |
| `POST`   | `/notes/tags/merge`                             | `merge_note_tags`               |
| `GET`    | `/notes?from=&to=`                              | `query_notes`                   |
| `POST`   | `/notes/:id/attachments`                        | `add_note_attachment`           |
| `POST`   | `/uploads` (`target: note_attachment`)          | `create_upload_url`             |
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
