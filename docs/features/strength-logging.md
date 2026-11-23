# Strength session logging

The pages under `/strength` log a strength training session, either live in the gym (one set at a
time) or after the fact (quick entry such as "3 × 8 at 60"). They work in the browser (**Training → Strength** in the menu) and embedded
in the Android app (More → Training → Strength, and the Add tab's **Log a strength session** opens `/strength/workouts` in the More tab's web
view). They write the built-in `strength_training` type's `sets` list (see
[Activity types](activity-types.md#data-schema-and-categorical-fields)); the generic add and edit forms with the sets
table stay for corrections.

The Strength page has four tabs, each at its own address, under the heading **Strength**:

| Tab       | Address               | What it shows                                                                                          |
| --------- | --------------------- | ------------------------------------------------------------------------------------------------------ |
| Muscles   | `/strength`           | The score card, a status line and one list of every muscle group: recovery, sets and score (see below) |
| Workouts  | `/strength/workouts`  | Start: an unfinished session, planned and saved workouts, a session without a plan, recent sessions    |
| Progress  | `/strength/progress`  | The [strength score](strength-score.md) over time, what moved, lifts about to leave, sets per week     |
| Exercises | `/strength/exercises` | "Your exercises": every exercise done, filtered by name, muscle group and equipment (see below)        |

The tabs are plain links, so each can be bookmarked and the back button steps between them; on a
phone the tab bar scrolls sideways. The old address `/strength/muscles` leads to `/strength`, keeping
its query string. Beside the heading, every tab but Workouts has one button: **Start a session**
(to `/strength/workouts`), or **Continue session** when a session is unfinished. The session, log
and plan pages below have no tab bar.

### The Muscles tab

- **Planned today**: above the score card, one card per open plan for today (local day) with its
  name, one line "{summary}. {readiness line}." (see [the Workouts tab](#the-workouts-tab)) and a
  **Start** button to the live session. Not shown while a session is unfinished.
- **Score card**, a link to Progress: the [strength score](strength-score.md), its change over 30
  days, a sparkline of the year and the strongest and weakest group. Without sex or a bodyweight it
  is the notice saying what to add; with no score at all it says "No strength score yet".
- **Status line**: the groups below the ready percent of [muscle recovery](muscle-recovery.md),
  least recovered first ("Every muscle is ready to train." when none is), and the groups last
  trained 30 or more days ago, longest first; at most four names each.
- **The list**, one row per muscle group: its name and when it was last trained (in the warning
  colour from 30 days), its recovery with a bar (and the hours or day until ready when below the
  ready percent), its sets of the last 7 days with the weekly average over 13 weeks, and the score
  of the score group that holds it with its 30-day change (Lats and Middle back both show Back).
  The sets come from daily buckets of the last 91 local days, cut into 13 rolling windows of 7
  days, the last one ending today. In body order the rows are grouped by region (Chest and
  shoulders, Back, Arms, Core, Legs), with groups never trained in a last "Never trained" section;
  the other orders (least recovered, behind on sets, longest since trained, weakest score) are one
  flat list.
- **A row opens** (one at a time) to its recovery and newest session, the 13 weekly windows as
  bars, the score group's lifts as the [score page](strength-score.md) lists them, and links to the
  muscle group page and the Exercises tab.
- A line under the list counts the sets of exercises not matched to the catalogue, with a link to
  match them.

### The Progress tab

Top to bottom, under the line "Best lifts of the last 90 days":

- **The score cards**: the [strength score](strength-score.md), its change over 30 days and the
  strongest and weakest group. Without sex or a bodyweight, the notice saying what to add instead,
  and nothing below but the sets chart.
- **Score over time**: overall, one muscle group, or "All muscle groups" (one line per group, with
  a legend), over 90 days, a year or three years. For overall or one group its ⋮ menu opens the
  stored score metric in the Chart Explorer, adds it to a dashboard as a chart or a sparkline card,
  or sets a goal on it.
- **What moved in 30 days**: the groups whose score differs from 30 days ago, first or lost scores
  first, then the largest change: "91 → 110 +19" with the reason, a new best lift of the last 30
  days ("New best: Bench press, 80 kg × 5 on" and the day, linking to the session), a better lift
  that left the 90 days (and the best one now), or every lift having left. A closing line names
  the unchanged groups and those with no score yet.
- **Leaving the 90 days soon**: the counted lifts whose best set leaves the 90 days within 30 days,
  soonest first, with their points, groups, set and "leaves in N days".
- **Sets per week**: the weekly sets per muscle group as stacked bars, as on the type page, with
  its period and ⋮ menu.
- The explanation of the score, with a link to the exercises not matched to the catalogue.

### The Exercises tab

"Your exercises" lists every exercise done in the period (90 days, 1 year, 2 years or all time),
from the grouped sessions answer (`GET /activity-types/strength_training/sessions?group_by=sets.exercise`),
filtered on the page:

- **Controls**: a search field, **Muscle group** ("All muscles" or one of the 17 groups; kept in
  the address as `?muscle=<group>`, which the Muscles tab's rows link to), **Equipment** ("Any
  equipment" or what the listed exercises use), **Period** and **Sort** (recently done, most done,
  best e1RM, max weight, best set, volume, points, name).
- **A muscle group** keeps the exercises that work it: those that mainly work it (recruitment
  weight 0.75 or more) first, then those that also work it, with a line counting both. The "No
  exercise" row shows only without a muscle or equipment filter.
- **Each exercise** shows its name (to the exercise page), its muscle groups (the main ones first,
  the others muted, at most four and "+n"; "Not matched" links to matching it to the catalogue),
  Done, Last, Best e1RM, Max weight, Best set ("24 kg × 9", the working set the best e1RM comes
  from), Volume, Sets and Points: the
  [strength score](strength-score.md) of the lift it counts as, today's whatever the period,
  muted when the lift is not among its group's counted lifts and "–" when it is no scoring lift.
  From 700 px wide this is a table; narrower, each exercise is a three-line row.
- **Not done in the last 90 days**: with a muscle group chosen that belongs to a score group, the
  lifts of that group without a set in the score's window.
- The aliases of exercise names are listed under it, each deletable.

### The Workouts tab

Top to bottom: the unfinished session card, if any, then the [planned and saved
workouts](strength-plans.md#in-the-web-app), then the sessions without a plan, then **Recent
sessions** and a link to all strength sessions. Every Start and Repeat asks to finish an unfinished
session first.

- **With an open plan**: "Planned" lists the plans with a day, "Saved workouts" the plans without
  one (each with "Last done …" or "Not done yet"), and "Without a plan" offers **Start an empty
  session** and **Log a past session**. A plan card shows its name and day, the summary ("5
  exercises · 15 sets"), the exercise names, the readiness line, the note, and **Start** and
  **Edit**; Start is the primary button only for a plan whose day is today or has passed.
- **Without one**: **Start an empty session** (primary) and **Log a past session** come first,
  then "Planned and saved workouts" says nothing is planned or saved yet, with a "Plan a workout"
  link.
- **The readiness line** says whether the muscle groups the plan mainly works (its
  `muscle_groups`) are ready, from [muscle recovery](muscle-recovery.md): "Chest, shoulders and
  triceps are ready", or "Still recovering: triceps (20 h), chest (5 h)" with only the groups below
  the ready percent, most hours first. No line when the plan's exercises match no catalogue entry.
- **Recent sessions**: the latest five finished sessions with sets of the last 90 days, each with
  **Save as a workout** (to `/strength/plan/new?from=<id>`) and **Repeat**. A session started from
  a saved workout that is still open shows "Saved as {name}" instead of Save as a workout.

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
planned sets, for a day or as a saved workout without one, which the user or an assistant over MCP
writes.

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
- Supersets are shown, not created; there are no programmes, and the rest default
  is per device, not a user setting.
