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
- **search** (title and text; `/journal?q=<text>` opens with it), a **tag** filter
  (clicking a `#tag` on an entry adds it, as does picking one under **Tags**, which
  lists them most used first; `/journal?tag=<tag>` opens with it, `?tag=<tag>,<tag>` with
  several), a **Related to** filter (a person or an activity, picked from People and
  Activities tabs), **Go to date** (`/journal?date=YYYY-MM-DD` opens there), **Also show
  comments on activities, meals and reports** (`/journal?comments=1` opens with it on), and
  **Photos without text**;
- **Chart**: the [Chart page](#charts) charting the entries the filters keep;
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
- **Pictures**: a picture pasted or dropped into the text (or picked with the
  picture button above it) goes into the text where the cursor is; **Add pictures**
  (several at once, or the camera on a phone) adds them below the text instead, in
  the order chosen, and **Put in text** moves one of those to the end of the text.
  See [Pictures in the text](#pictures-in-the-text). **Record** captures
  a voice note with the microphone, which the browser asks for the first time.
  Pictures open full size; recordings play inline. Removing one shows **Undo** for
  a few seconds, and it can be restored for 30 days.
- **Delete** removes the entry with an **Undo** notice; it stays in Recently
  deleted for 30 days. A new entry you leave empty is deleted when you leave it; a
  saved entry is never deleted by leaving its page.
- **Replies**: comments on an entry (the same thread the Timeline shows) are listed
  under it.
- **Related**: chips for the people, activities, meals, reports and check-ins the
  entry is about, an activity's with its type's icon. **+ Add** has a tab per kind: a
  person; an activity of the entry's day (last night's sleep listed, and labelled,
  under the morning it ended); a meal or a check-in of the entry's day (another day
  can be picked); a report, newest first, searchable by type. Typing `@` offers
  people too. Archived people are not offered for a new link, but an entry that
  already links one keeps the chip. A chip opens its target: a check-in's opens its
  form's page, where its history is. If a save is refused because a linked target
  was removed since (a draft kept from before, say), the chip turns red and says so;
  remove it and the entry saves.
- **Suggested**: under Related, once the entry is saved, dashed chips suggest links it
  does not have yet -- a person named in the text ("named in the text"), the night's
  sleep ("last night") and the day's activities ("that day"); see
  [Suggested links](#suggested-links). A tap adds it to Related, as the picker does;
  **×** stops suggesting it for this entry. There is no row when there is nothing to
  suggest, and the chips are read again after each save.

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
  A plain `DELETE` of a blank note (no text, title or tags, and no attachments, links
  or replies, deleted ones included) removes it for good, as there is nothing to
  restore. The server decides that, not the client.
  The account export carries deleted entries too.

See [Comments](./comments.md) for the exact rules.

## Related

An entry can be **related to** any number of people (see [People](./people.md)),
activities, meals, reports and check-ins without being a comment on any of them:
today's entry mentions a partner, another is about last night's sleep, the lunch that
did not agree with you, a blood panel's results or this morning's mood check-in. A link is made explicitly, never by reading the
text; removing a name from the text does not remove the link, and a link can exist with
nothing about it in the text.

- **Model.** `note_links` holds `note_id`, `entity_type` (`person`, `activity`,
  `meal`, `report` or `check_in`), `entity_id` and `created_at`, one row per note and
  target. Only a thread root carries
  links (a `day` or `time` entry, or a comment on something); a reply is refused with a
  `400`. Targets are referenced by id and their labels resolved when read, so a renamed
  person or a retyped activity stays right.
- **Making one.** `related` on `POST /notes` and `PATCH /notes/:id` (MCP `add_note`,
  `update_note`) is the full list of `{ entity_type, entity_id }`, at most 30,
  duplicates collapsed: it replaces the links when present, `[]` removes them all, and
  leaving it out leaves them. An unknown, malformed or deleted target is a `400` naming
  it (`Unknown person: <id>`, `Unknown activity: <id>`, `Unknown meal: <id>`,
  `Unknown report: <id>`, `Unknown check-in: <id>`). A change of links follows the
  same `expected_updated_at` check as the text (a stale one is the usual `409`); it bumps
  `updated_at` but keeps no text revision.
- **Where it shows.** Every thread root in an answer carries `related`: each target's
  `entity_type`, `entity_id` and a `label`, made when read in your timezone -- the
  person's name; the activity's title (else its type's name) with its local date,
  "Evening walk, 2026-11-20" (a sleep is dated by the morning it ended); the meal's type
  and local time, "Lunch 12:30"; the report's type and local date, "Blood Panel,
  2026-11-20"; the check-in's form name and local time, "Morning 07:45". An activity
  carries its `activity_type` too, for its icon, and a check-in its `form_id`, for its
  page. `GET /people/:id` (MCP `get_person`), the activity detail (`GET /activities/:id`,
  `GET /activities/:id/full`, MCP `get_activity_detail`), `GET /meals/:id` (MCP
  `get_meal`) and `GET /reports/:id` (MCP `get_report`) carry `journal_entries`: the
  related entries newest first, at most 50, each with `id`, `title`, `entity_type`,
  `date` or `start_time`, and `excerpt` (the first non-empty line, at most 200
  characters). A merged activity lists the entries related to any of its source rows,
  and merging activities relates their entries to the merged one. On the Timeline
  nothing changes: an entry stays where its own time puts it. A check-in has no page
  of its own, so its related entries are read with the filter below
  (`related_type=check_in`).
- **The filter.** `GET /notes/search` (MCP `search_notes`) takes `related_type`
  (`person`, `activity`, `meal`, `report` or `check_in`) with `related_id`, both or
  neither, and combines them with every other filter. An activity is matched by the id
  given. The journal's **Related to** filter is the same, with a tab per kind, and
  `/journal?meal=<id>` (or `person`, `activity`, `report`, `check_in`) opens the journal
  filtered so; a meal's or a report's page links there under its related entries.
- **Deleted targets.** A link to a soft-deleted person, activity or check-in is hidden
  while its target is deleted and back on restore; it goes when the target is removed
  for good. For an activity, a meal, a report and a check-in a database trigger removes
  it, whatever removes the target: for an activity a purge, a source's delete, a rule's
  regeneration or an orphaned override; a meal or a report is deleted outright; a
  check-in is purged 30 days after its deletion, replaced when it was a skip and its
  slot is answered, or purged with its form. The `note_links` check on `entity_type`
  was widened in place, so an older build still running beside a newer one writes only
  the kinds it knows.
  Replacing an entry's links only touches the visible ones, so a hidden link survives
  an edit and comes back with its target.
  A deleted entry's links are out of sight with it and come back with it.
- **Privacy.** As the rest of People: links never leave your account. A note is never
  shared, and nothing about its links goes into an activity's share, the feed or
  anything federated.
  A journal [chart](#charts) card placed on a shared dashboard shows its visitors the
  counts and, unless masked, the tag and people names of its series.

### Suggested links

Aurboda suggests links, and only suggests them: a link is still made by a tap in the
editor or by `related` on a save, never from the text by itself, and a suggestion never
changes the text.

- **What is suggested.** For a journal entry (a `time` or `day` note):
  - a person whose name is written in the title or text, as a whole word, case aside,
    also with a possessive `s`, `'s` or `’s` ("Saras", "Sara's"). The first name alone
    counts when the name has more words, the first name has at least three letters and
    no one else among your people has it. Archived people are never suggested.
    Reason `name_in_text`, in the order they are first named.
  - for a `time` entry before noon (in your timezone), the sleep that ended that
    morning, at or before the entry (the one ending last). Reason `night_sleep`.
  - the activities other than sleep that started on the entry's day (a `day` entry's
    date, a `time` entry's local date), in time order, at most 12. Location visits and
    screen-time spans are left out. Reason `same_day`. Activities are read as the
    activity list reads them, so merges and rules apply.

  What the entry is already related to, and what was dismissed for it, is left out.
  Each suggestion is a `related` item (`entity_type`, `entity_id`, `label`, an
  activity's `activity_type`) plus its `reason`.

- **One entry.** `GET /notes/:id/link-suggestions` (MCP `get_note_link_suggestions`);
  a `404` for anything but a live journal entry.
- **Dismissing.** `POST /notes/:id/link-suggestions/dismissals` with
  `{ entity_type, entity_id }` (MCP `dismiss_note_link_suggestion`) stops suggesting it
  for that entry; dismissing twice is the same as once. Dismissals live in
  `note_link_dismissals` (`note_id`, `entity_type`, `entity_id`, `created_at`) and go
  with the entry when it is removed for good.
- **Many entries.** `GET /notes/link-suggestions` (MCP `list_note_link_suggestions`)
  pages through the journal newest first, as search does: `from`/`to` (local dates),
  `tz`, `cursor` and `limit` (default 20, at most 50 entries looked at per page).
  `unlinked_only` (default `true`) leaves out entries already related to anything.
  Each listed entry carries `id`, `entity_type`, `title`, `date` or `start_time`,
  `excerpt`, `updated_at`, its current `related` and its `suggestions`. Only entries with
  a suggestion are listed, so a page can be short, or empty, while `next_cursor` is
  still set: keep paging until it is absent.

#### Going through old entries with an assistant

An assistant (through MCP) can relate the archive in passes, with you deciding:

1. `list_note_link_suggestions` with `from`/`to` for the stretch to go through
   (`unlinked_only` stays `true`), following `next_cursor` to the end.
2. Show the proposals grouped per entry -- its date, title or excerpt, and each
   suggestion's label and reason -- and ask which to keep, entry by entry or for a
   batch at once.
3. For each entry with accepted links, `update_note` with `related` set to its current
   links **plus** the accepted ones (`related` replaces the list) and
   `expected_updated_at` set to the entry's `updated_at`. A conflict means the entry
   changed meanwhile: read it again and ask again.
4. `dismiss_note_link_suggestion` for each refused suggestion, so the next pass skips it.

The assistant never edits an entry's text or title to make a link, and links nothing
you have not agreed to.

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

## Charts

The journal is a chart source next to activity types and metrics: `source_type=journal`
in `GET /chart-data` (MCP `query_chart_data`), in `GET /trends` (MCP `get_trend`), and in a
dashboard's bar, trend and combined chart cards. It takes no `pattern`.

**What is counted** is what [search](#finding-entries) lists: the live thread roots of the
chosen types (free-standing `time` and `day` entries by default) whose parent is live;
replies never count. An entry falls in the bucket of its anchor -- a `day` entry the start
of its date, a timed one its `start_time` -- in `tz` (UTC when omitted; the web app sends
the browser's zone).

- `aggregation=count` counts entries; `sum` sums the words written, counted in the entry's
  own text (not its title or replies), an empty entry 0. `mean` and `max` are refused.
- `breakdown_fields` takes `@tags` (one series per tag, explicit or `#hashtag`, an entry
  counted under each of its tags and `(none)` when untagged) and `@people` (one series per
  live person the entry is [related](#related) to, `(none)` for no one, same-named people
  kept apart). Both give `<tag> / <person>` series. A journal breakdown keeps at most 8
  series: the 7 with the highest total over the range, sorted by name, and the rest summed
  as `Other`, listed last.
- The filters are search's, prefixed: `journal_tags` (comma-separated, entries carrying all
  of them), `journal_related_type` with `journal_related_id`, `journal_q` (full text) and
  `journal_entity_types` (default `time,day`). They are refused with another source, and
  `@tags` is refused with another source too. `measure`, `filter_field` and
  `filter_value` do not apply.

A **trend** is the EMA of the daily count (or words), zero-filled from the day of the first
matching entry, so days before the journal started are not zeros; `display_unit` is
`per week` (or `words per week`). With a breakdown it answers `breakdown_series` and
`breakdown_histories`, the series folded to the cap before the EMA. `missing_days` and
`include_flagged` do not apply.

On a **dashboard**, a bar, trend or combined chart card with `source_type: "journal"`
carries the `journal_*` filters in its config; on a shared dashboard `@tags` and `@people`
can be listed in `masked_breakdown_fields`. Goals and challenges do not take the journal
as a source.

```http
GET /chart-data?source_type=journal&start=2026-01-01T00:00:00Z&end=2026-12-31T23:59:59Z&bucket_size=1M&aggregation=sum&journal_tags=travel&tz=Europe/Stockholm
```

### On the web

The journal page's **Chart** link (next to **Tags**) opens the Chart page on the journal,
entries per week over the last year, filtered as the list is: its tags, **Related to**, the
search text and **Also show comments…** come along; **Go to date** and **Photos without
text** do not.

On the Chart page (`/chart`), **Journal** is a source next to Activity Type and Metric.
With it the source row has **Related to** and **Tags** (the journal page's own pickers, the
picked tags shown as chips to remove), **Search text**, **Also count comments on
activities, meals and reports**, and **Breakdown by:** **Tags** and **With** (With only
when you have people). **Aggregation** is **Entries** or **Words**; Bars and Trend both
work, Sessions does not. A breakdown's bars are stacked. The URL names the filters as the
API does, so a chart link reads like the query:

```text
/chart?source_type=journal&chart_type=bar&bucket_size=1w&lookback_days=365&journal_tags=travel&journal_related_type=person&journal_related_id=<id>&journal_q=lake&journal_entity_types=time,day,activity,meal,report
```

A related filter counts comments as the journal page's does. Clicking a bar opens the
journal at that bar: gone to its last day (`/journal?date=`, which lists that day and
older, so the bar's entries come first), with the chart's tags (`tag=`), related filter,
search (`q=`) and comments (`comments=1`), and, in a breakdown by tag, the clicked tag
added (not for `(none)` or `Other`).

**Add to dashboard** saves the chart as a card titled `Journal entries` or `Journal words`
(followed by the tags, e.g. `Journal entries · #travel`) unless you type a title; a
breakdown by Tags or With starts masked for shared boards. See
[Dashboard](./dashboard.md#trend-chart).

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
- **A HEIC picture** (an iPhone photo; HEVC-coded HEIF, recognised by the brands
  its `ftyp` box names) is taken too. The bundled libvips cannot decode HEVC, so
  the server decodes it in-process with `heic-decode` (libheif compiled to
  WebAssembly), turned and mirrored as the file says, and then treats it like any
  other picture: fitted inside 3000 px and stored as WebP. The decoder hands over
  pixels only, so a HEIC picture keeps **no metadata** -- no time, camera or GPS
  position -- whatever `journal_strip_metadata` says. A HEIC with more pixels
  than any upload may have (16383 × 16383) is refused before it is decoded, and
  one that does not decode is a `400` like any other unreadable file. Avatars,
  feed pictures and challenge banners still refuse HEIC. An AVIF is not a HEIC
  and is refused, as before.
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

### Pictures in the text

Every picture is an attachment of its entry; the text shows one in place with a
markdown image whose URL names it: `![caption](attachment:<attachment id>)`. It
only ever refers to an attachment of the same entry. The web draws it from the
attachment's bytes (fetched with the token, like the thumbnails), in the list at
400 px and in the entry at 2000 px, and a tap opens it full size; an attachment
that is gone shows "Picture missing". Pictures the text shows this way are left
out of the thumbnails below it, and the entry's excerpt (on a person's or an
activity's page, and the previous/next links) skips lines that are only pictures.
Over REST and MCP it is the same: upload with `POST /notes/:id/attachments` or
`add_note_attachment`, then put the line in `content` with `update_note`. Deleting
the line leaves the attachment, back among the thumbnails.

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
| `GET`    | `/notes/:id/link-suggestions`                   | `get_note_link_suggestions`     |
| `POST`   | `/notes/:id/link-suggestions/dismissals`        | `dismiss_note_link_suggestion`  |
| `GET`    | `/notes/link-suggestions`                       | `list_note_link_suggestions`    |
| `GET`    | `/notes/search`                                 | `search_notes`                  |
| `GET`    | `/notes/tags`                                   | `list_note_tags`                |
| `POST`   | `/notes/tags/merge`                             | `merge_note_tags`               |
| `GET`    | `/chart-data?source_type=journal`               | `query_chart_data`              |
| `GET`    | `/trends?source_type=journal`                   | `get_trend`                     |
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
