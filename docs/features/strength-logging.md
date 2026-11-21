# Strength session logging

The pages under `/strength` log a strength training session, either live in the gym (one set at a
time) or after the fact (quick entry such as "3 × 8 at 60"). They work in the browser (**Training → Strength** in the menu) and embedded
in the Android app (More → Training → Strength, and the Add tab's **Log a strength session** opens `/strength` in the More tab's web
view). They write the built-in `strength_training` type's `sets` list (see
[Activity types](activity-types.md#data-schema-and-categorical-fields)); the generic add and edit forms with the sets
table stay for corrections.

The Strength page has four tabs, each at its own address, under the heading **Strength**:

| Tab       | Address               | What it shows                                                                                              |
| --------- | --------------------- | ---------------------------------------------------------------------------------------------------------- |
| Train     | `/strength`           | Start: an unfinished session, start now, log a past session, planned workouts, repeat a session            |
| Progress  | `/strength/progress`  | The [strength score](strength-score.md) of `sets.exercise`: cards, the score over time, each group's lifts |
| Exercises | `/strength/exercises` | "Your exercises": every exercise done, with a search field, sortable, over 90 days to all time             |
| Muscles   | `/strength/muscles`   | [Muscle recovery](muscle-recovery.md) of every group, and sets per muscle group                            |

The tabs are plain links, so each can be bookmarked and the back button steps between them; on a
phone the tab bar scrolls sideways. The session, log and plan pages below have no tab bar.

| Page                   | What it is                                                                        |
| ---------------------- | --------------------------------------------------------------------------------- |
| `/strength/live`       | A live session that has no logged set yet (nothing is saved)                      |
| `/strength/log`        | A past session being entered, not saved yet                                       |
| `/strength/session/ID` | A saved session: live while in progress, edit form otherwise, read-only if synced |

Entry points: **Log a session** on the strength training type page, a line above the sets table on
the Add page, **Continue** on the detail page of a session in progress and **Edit sets** on a
finished one logged in Aurboda. A logged session merged with a watch's activity keeps **Edit sets**
when the group holds exactly one Aurboda row with logged sets that is not an override; it edits that
row and returns to the merged page on Save or Cancel.

The logged sets feed the [strength score](strength-score.md): per reference lift the best
estimated one-rep max of the last 90 days against a reference by sex and bodyweight.
They also feed [muscle recovery](muscle-recovery.md): per muscle group how far the fatigue of
the working sets of the last days has worn off.

A workout can also be planned ahead: [strength plans](strength-plans.md) are named lists of
planned sets, for a day or as a routine, which the user or an assistant over MCP writes.

## Exercise blocks

The stored list is flat, in order. The pages group consecutive sets with the same exercise name
(trimmed, case and punctuation ignored) into one block; an exercise that comes back later is a
second block, so the order is kept exactly, and saving flattens the blocks in that order. Keys the
pages do not know (Gravl's `superset_id`, `exercise_id`) survive a load and a save. Blocks whose
sets share a `superset_id` are labelled **Superset**; the pages do not create supersets.

**+ Add exercise** opens a picker: the exercises of the last three sessions, then the user's own
names (most recently used first), then, while typing or with a muscle group or equipment filter,
the [exercise catalogue](exercise-catalog.md), 20 at a time ("Show more" loads the next). A
catalogue pick sends its key as `exercise_key`
with the block's sets until one save has carried it, which maps the name to the entry.

## Live sessions

A live session is an **open activity**: the first logged set creates it with the time **Start a
session now** was pressed as `start_time`, no `end_time`, and

```json
{ "sets": [...], "in_progress": true, "last_set_at": "2026-11-10T17:34:00.000Z" }
```

Every later change sends the whole `sets` list and `last_set_at` (the time of the newest logged
set) with a `PATCH`; **Finish** sets `end_time` to now and `in_progress: false`. A session left
unfinished shows on the start page for seven days, where **Finish it** ends it at `last_set_at`.
`in_progress` and `last_set_at` are undeclared data keys, not part of the type's `data_schema`.

While a session is open:

- [Auto-share](auto-share-rules.md) ignores it (it has no `end_time`), so it is never shared half
  done.
- It is kept out of merging: an overlapping session another source delivers (a watch, Health
  Connect) is listed next to it rather than merged with it, so another device still finds the open
  session by its id and start time and offers it for **Continue**. The finishing update merges them.
- No [Health Connect](../health-connect.md) write is queued while the stored data has
  `in_progress: true`; the finishing update queues the normal one. A type change still deletes the
  old type's record, for an activity that was synced before it was set back in progress.

Each block shows last time's sets and the best e1RM for the exercise, its muscles when the name
resolves to a catalogue entry, and, after each save, the records the session set (from the
session's item history). The next set is prefilled from the block's previous set, else the planned
set when the session was started with **Repeat** or from a plan, else the set at that position last
time (weight, reps and time). A planned set's type (warmup, drop set, failure) is also preselected
for that set, and the planned line shows it ("planned: 14 kg × 10 (warmup)"); a set logged without
changing it keeps that type. An exercise last done as timed holds asks for seconds instead of reps. A rest
timer (default two minutes, **+30 s**, **Skip**) counts from `last_set_at`, so it survives a
reload, and vibrates at zero where the browser can; the page asks to keep the screen awake.

**Repeat** starts a live session with another session's blocks in order and their sets as planned
sets, greyed and not saved, which disappear one by one as sets are logged. Their notes are not
carried over.

## What is stored on the device

| Key                            | What                                                            |
| ------------------------------ | --------------------------------------------------------------- |
| `aurboda_strength_live`        | The live draft: its id once saved, start time, blocks, last set |
| `aurboda_strength_log`         | The unsaved past-session form (an edit keeps nothing locally)   |
| `aurboda_strength_weight_step` | The weight step (0.5, 1, 2.5 or 5 kg)                           |
| `aurboda_strength_rest_s`      | The rest length                                                 |

The live page's state is the source of truth and is mirrored to the device after every change; each
change saves the whole list. One save runs at a time and a change during a save queues one more
with the newest state. A failed save is retried when the device comes back online, when the page
becomes visible again, and every 15 seconds, and the header says `saved`, `saving…` or `not saved
yet, will retry`. A repeated create lands on the same row (the server upserts on type and start
time), but after a create of unknown outcome the page first looks for an open strength session with
the same start time and adopts it, so the retry is an update. Opening
a session in progress on a device that holds unsaved changes to it keeps those changes and saves
them; otherwise the server copy wins.

A past session sends nothing until **Save**, which creates (or, in edit mode, updates)
`start_time`, `end_time` (start plus the minutes entered) and `sets`, then opens the session's page.
Edit mode is offered only for sessions logged in Aurboda that are not an override of a synced one;
a synced session's sets are changed with the generic edit form.

## Limits

- One live draft per device; two devices editing one live session at once is last write wins.
- Weights are in kg.
- Supersets are shown, not created; there are no saved routines or programmes, and the rest default
  is per device, not a user setting.
