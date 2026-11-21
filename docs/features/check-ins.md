# Check-ins

A check-in form is a short questionnaire you build yourself — "Morning check-in", "How rested am
I", a weekly well-being scale — and fill in from the web, the app or MCP. Each numeric answer can be
logged as a **metric**, so it shows up in charts, dashboards, goals and Analyze like any other
metric, or as an **activity** on the Timeline. A form can have a **schedule**: it is then asked for
with a notification when a slot is due, and stays quiet once that slot is done or skipped.

A form whose answers are preset is a **routine** — "Morning stack: vitamin D 50 µg, magnesium
200 mg", or an as-needed "Ibuprofen 400 mg" — confirmed in one tap, from the page or straight from
its notification.

This page covers forms, routines, answers logged to metrics and activities, scores, schedules,
skipping, the due notification and its actions, and adherence.

## Forms

A form has a `name`, an optional `description`, its `questions` (1 to 40, in the order asked), an
optional `score`, an optional `schedule`, `notify` (default on) and `archived`.

Each question has a stable `key` (lowercase letters, digits and underscores, starting with a
letter, at most 40 characters, unique in the form), a `prompt` (1 to 300 characters), `required`
(default false), an optional `default` (its preset answer, see [Routines](#routines)), an optional
`logs_to`, and a `type` with its settings:

| Type           | Settings                                                                    | Answer                  |
| -------------- | --------------------------------------------------------------------------- | ----------------------- |
| `number`       | optional `min`, `max`, `step`, `unit`                                       | a number within min…max |
| `scale`        | integer `min` < `max`, at most 11 points; optional `min_label`, `max_label` | a whole number in it    |
| `yes_no`       | —                                                                           | `true` or `false`       |
| `choice`       | `options`: 2 to 20, each `{ key, label, value? }`                           | an option key           |
| `multi_choice` | `options` as above                                                          | a list of option keys   |
| `text`         | —                                                                           | text, at most 2000      |

A question's key is never reused for something else: a key removed from a form may come back in a
later version only with the type it had.

### Versions

Changing a question's prompt, type, settings, options, `default`, `logs_to` or required flag, adding or
removing a question, or changing the score makes a new **version** of the form, and the old
definition is kept in `check_in_form_versions`. A check-in is always read against the version it
answered, so an old answer keeps its meaning after the form changes. Renaming the form, changing
its description, reordering the questions, or changing its schedule or `notify` keeps the version.

### Templates

`GET /check-in-templates` (MCP `list_check_in_templates`) lists built-in forms to copy with
`POST /check-in-forms { "template": "<id>" }`; any other field given overrides the template's own.
Each template records its source and licence.

| ID                    | Form                          | What it asks                                                                                                                          |
| --------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `morning`             | Morning check-in              | How rested you feel, 1 to 5, logged to `rested`                                                                                       |
| `mood_energy`         | Mood and energy               | Mood and energy, 1 to 5 each, logged to `mood` and `energy`, and an optional note                                                     |
| `morning_supplements` | Morning supplements (example) | A routine: vitamin D 50 µg and magnesium 200 mg, each logged as a `supplement` activity; change them to your own                      |
| `who_5`               | WHO-5 Well-Being Index        | Five statements about the last two weeks, each from "At no time" (0) to "All of the time" (5); the score, 0 to 100, logged to `who_5` |

The WHO-5 Well-Being Index is included on the owner's decision, in WHO's wording unchanged, with
its source (World Health Organization, 2024) and licence (CC BY-NC-SA 3.0 IGO) recorded on the
template. Any other published questionnaire can be entered as one's own form: `choice` questions
with a `value` per option and a `score`.

Aurboda records answers and scores only: it gives no clinical interpretation or cut-offs.

## Routines

A question's `default` is its preset answer, checked like an answer of its type. A form is a
**routine** when every required question has a default and at least one question has one; the
form's `is_routine` says so. A routine is saved as preset with `POST /check-ins { form_id,
use_defaults: true }` (MCP `submit_check_in` with `use_defaults`): every question with a default
gets it, and `answers` given alongside win per key, so an item can be left out (`0` or `false`) or
its dose changed. `use_defaults` on a form that is not a routine is a 400.

A routine without a schedule is an **as-needed favourite** ("Ibuprofen 400 mg"): `GET
/check-in-forms` marks it with `is_routine` and `schedule: null`, and it is confirmed with the same
`use_defaults` call whenever it is taken.

## Answers logged as metrics

`logs_to: { "metric": "<name>" }` is allowed on `number`, `scale`, `yes_no` (yes is 1, no is 0) and
`choice` when every option has a numeric `value` (the chosen option's value is logged). The name
follows the custom-metric naming rule. It may be a built-in metric, one of your custom metrics, or a
[metric catalogue](metric-catalog.md) name or alias (adopted on first use as usual); any other name
becomes a custom metric the first time an answer is logged to it, with the question's unit (or
`score`) and the form's name as its description. A metric computed from other sources (steps,
calories) cannot be logged to, and a number question's unit must be one the metric accepts; the
form is refused otherwise. A form logs each metric at most once.

Each logged answer is one point at the check-in's `answered_at`, data source `check_in`, written
through the same service as `add_metric`. **An answer of 0, no, or no answer logs nothing.** The
check-in remembers what it wrote in `logged` (per question key the metric and time), so:

- editing its answers or time replaces exactly those points,
- deleting it removes them, and restoring it writes them again.

A point of a metric that syncs to Health Connect (weight, say) is queued for the Android app's
outbound sync, as `add_metric` does; a point a check-in removes is not deleted from Health Connect.
When a step of an edit, delete or restore fails halfway, `logged` and `activity_ids` are written as
they stand at that moment, so they never claim a point or activity that is gone.

An answer that could not be logged (a custom metric's range, say) is reported in the response's
`log_errors` and left out of `logged`.

A metric holds one point per time and source, so two check-ins with the same `answered_at` that log
to the same metric share one point: the later write replaces the earlier, and deleting or editing
either check-in removes it for both. The pages stamp the current time, so this only happens when
check-ins are written with a given `answered_at` (a backfill, say): give each its own time.

## Answers logged as activities

`logs_to: { "activity_type": "<type>", "fields": { … }, "answer_field": "<field>" }` is allowed on
`number`, `scale` and `yes_no`. The type is one of your activity types, or a built-in
[catalogue](activity-type-catalog.md) type (`medication` and `supplement` are the ones made for
this, with `substance`, `dose` and `dose_unit`), added to your types the first time an answer is
logged, as the catalogue does. Where the type has a
[data schema](activity-types.md#data-schema-and-categorical-fields), the form is refused when
`fields` names a field the type does not have or of the wrong kind, `answer_field` is not a number
field, or a required field is neither fixed nor the answer. `answer_field` is not allowed on a
`yes_no` question: yes logs the activity, with `fields` only.

Each taken answer is one activity at the check-in's `answered_at`, data source `check_in`, created
through the same service as `add_activity`, with `fields` as its data and the answer in
`answer_field`. **An answer of 0, no, or no answer logs nothing**, which is how one item of a stack
is skipped. Two items of the same type at the same time stay two activities: each is its own
row in the activity list and on the Timeline ([#1892](https://github.com/fiddur/aurboda/issues/1892)). The check-in
remembers each in `activity_ids` (question key to activity) and answers them as `activities`, each
`{ activity_id, logged }`:

- editing its answers or time deletes the activities it made and logs them again (an edit of only
  the note or slot keeps them),
- deleting it soft-deletes them, and restoring it restores them,
- an activity deleted on its own leaves the answer in the check-in, with `logged: false`, and a
  later restore of the check-in does not bring it back.

An activity that could not be added (a dose below the field's minimum, say) is reported in
`log_errors`. Editing a logged activity on the Timeline makes an override of it, as for any synced
source; the override goes with the activity when the check-in deletes it (an edit of the answers,
or deleting the check-in), and comes back when the check-in is restored. Adding, deleting and
restoring these activities runs [deduction rules](deduction-rules.md) and auto-share rules over
them, as any activity write does.

### Score

`score: { metric, questions, factor? }` sums the numeric answers of the listed questions (`number`,
`scale`, `yes_no`, or `choice` with values) and multiplies by `factor` (default 1). A missing
answer to one of them leaves the score absent. The score is logged to its metric like an answer,
under the key `_score` in `logged`, and a score of 0 is logged. Each check-in carries its `score`.

## Schedule

A `schedule` is read in your time zone (see [Reminders](reminders.md#when-a-reminder-fires)):

- `times`: 1 to 12 `HH:MM` times on the five-minute grid,
- `weekdays`: ISO weekdays, 1 = Monday … 7 = Sunday (default every day),
- optional `start_date` and `end_date` (YYYY-MM-DD),
- `day_starts_at` (default `04:00`): a slot earlier than it belongs to the day before, so a
  `00:30` bedtime slot is part of the evening that started it. The weekdays and dates are those of
  that day.

A time skipped by the spring-forward clock change moves to the instant the clocks jump, and a time
that happens twice uses the first, as for reminders.

Each slot of a day is:

- `upcoming` before its time,
- `due` once its time has passed,
- `done` when a check-in of the form answers it: one whose `scheduled_for` is the slot, or else one
  without `scheduled_for` answered during the slot's day, which counts for the earliest slot of that
  day no other check-in has taken,
- `skipped` when the slot was recorded as skipped (see below),
- `missed` once its day is over without a check-in.

### Skipping

`POST /check-ins { form_id, scheduled_for, status: "skipped" }` records a slot as skipped, which is
different from missed: a check-in with `status: skipped`, no answers, logging nothing (a note may
go with it). `scheduled_for` must be a slot of the form's schedule (400 otherwise), and a slot
already done or skipped answers 409. A skipped slot can still be answered later: a check-in for the
same `scheduled_for` replaces the skip, which is removed. A skipped check-in takes no answers in a
`PATCH`; its `scheduled_for` may move only to another slot of the form that is still open (400 for
an instant that is not a slot, 409 for a slot done or skipped), and never to `null` (400).

Restoring a deleted skip whose slot another check-in has since done or skipped answers 409 and
restores nothing. Restoring an answered check-in for a slot removes the skips of that slot, as a
new answer does.

### Tying a check-in to an activity

`entity_type: "activity"` and `entity_id` on `POST /check-ins` tie the check-in to an activity
("after meditation"); the activity must exist and not be deleted (400 otherwise). `GET
/check-ins?entity_type=activity&entity_id=<id>` lists the check-ins tied to it. Activity is the
only kind of entity for now.

`GET /due?date=YYYY-MM-DD` (MCP `list_due`) lists the slots of every scheduled form on that day,
or without `date` on each form's current day. An archived or deleted form has no slots.

### Due notification

The [reminder](reminders.md) scheduler's five-minute job also raises, for each slot of a form with
`notify` on, a [notification](notifications.md) of type `check_in_due` (group **Reminders**,
labelled **Check-ins**) titled with the form's name and linking to
`/check-ins/<form id>?slot=<scheduled_for>`, which fills the form in for that slot. Its
`data` carries `form_id` and `scheduled_for`, and its dedupe key is
`check_in:<form id>:<slot day>:<HH:MM>`, so each slot is raised once. The reminder rules apply:

- nothing is raised for a slot more than an hour overdue, or one already done or skipped,
- a form created, given a new schedule, switched back to `notify`, unarchived or restored starts
  with its next slot.

Submitting, skipping or editing a check-in marks the notifications of the slots it did or skipped
read and clears their actions. One user's failure in this step is logged and never stops the
reminders or the other users.

For a routine the notification's body lists its preset items in a line ("Vitamin D 50 µg,
Magnesium 200 mg": each prompt with its default and unit, a yes/no by its prompt, items preset to 0
or no left out), and it carries two [actions](notifications.md#actions):

- **Done** saves the check-in as preset, `answered_at` the time it was pressed and `scheduled_for`
  the notification's slot, and the notification then says "Done at HH:MM" (your time zone),
- **Skip** records the slot as skipped, and the notification then says "Skipped".

They work under the web bell and as buttons on the Android notification, with no client change.
Each write to a form or its check-ins (an edit of the form, a submit, an edit, delete or restore of
a check-in, and an action's check of the slot with its save) holds a per-form lock, so two Done
presses at once save once and the second answers that the slot is already done.
When the slot is already done or skipped, the form was deleted, the slot is no longer in the
schedule, or (for Done) the form changed so that it is no longer a routine, the action answers 409
with the reason and the notification says what happened.

## Adherence

`GET /check-in-forms/{id}/adherence?from=YYYY-MM-DD&to=YYYY-MM-DD` (MCP `get_check_in_adherence`)
tells how a form was kept up over a window of local days (by the schedule's `day_starts_at`; at
most 366 days; default the 30 days up to the form's current day):

- `days`: each day of the window with its slots counted `done`, `skipped`, `missed` and `upcoming`
  (today's slots still open, due or not), for a simple chart, and `totals` for the window,
- `questions`: per question of the current version, how many of the answered check-ins in the
  window (`answered_check_ins`, scheduled or not) answered it with something other than 0 or no;
  for a routine, how often each item was taken.

Schedules are not versioned: past days are read against the form's **current** schedule, so a
changed schedule changes how earlier days count. Slots before the form was created count only when
a check-in took them. A form without a schedule has no slots, only its answer counts.

## Deleting

Forms and check-ins are soft-deleted and can be restored for 30 days; the daily prune pass then
removes them for good. A deleted form asks for nothing, and its check-ins stay readable in the
history with its name until the form is purged, which takes its check-ins with it (the metric
points and activities of those still live stay). Deleting a check-in removes the metric points it
logged and soft-deletes its activities; restoring it brings both back. `deleted=true` on the lists shows what can be restored.

## Pages

**Check-ins** is in the main menu (and can be hidden there, see [the menu](menu.md)); in the
[Android app](../android-app.md) it is More → Log → Check-ins, the same page embedded.

- **`/check-ins`**: **As needed** on top, one large button per routine without a schedule, named by
  its preset items ("Ibuprofen 400 mg"): a tap saves it as preset and shows "Logged" with **Undo**
  for 10 seconds (Undo deletes the check-in). Then **Due today**, today's slots from `GET /due` with
  their state (due now, later today at a time, done, skipped, missed); a due slot has **Fill in** and
  **Skip**, and a routine's also **Confirm**, which saves it as preset for that slot. **Your forms**,
  each with its schedule in words ("Every day at 08:00 and 21:00"), when it was last answered (with
  the score when the form has one), **Fill in** (and **Confirm** for a routine), **Edit** and
  **Archive** (archived forms behind a switch); **New form** and **Start from a template**, which
  copies a built-in template and opens it in the editor; and **Recently deleted** at the bottom, the
  deleted forms and check-ins with **Restore**.
- **`/check-ins/<form id>`**: filling in, one screen made for a phone: a scale is a row of large
  numbered buttons with its end labels under the ends, yes/no two large buttons, a choice large
  option buttons (several can be picked for a multi-choice), a number an input with its unit and −/+
  steppers that keep to its min, max and step, and text a text box. Required questions are marked
  with `*`; saving with one unanswered names it. A note and **Answered at** (now unless changed, for
  filling in late) close the form. Opened from a due slot or the due notification
  (`?slot=<scheduled_for>`), the check-in is saved for that slot, and **Skip this time** records the
  slot as skipped. Opened with `?activity=<activity id>` (from an activity's page), it is tied to that
  activity. A routine is filled in as a list of its items, each ticked with its preset dose: untick
  an item not taken, or change a dose, then save (an item that is required and has no "not taken"
  answer stays ticked). Below the form are the **last 30 days** (from the adherence route): for a
  scheduled form a strip of its slots per day (done filled, skipped hatched, missed hollow) with the
  counts, and, per item or question, how many of the check-ins took or answered it. Then the form's
  **history**, newest first, each check-in read against the questions it answered, with **Edit** and
  **Delete** (with **Undo**); a skipped slot shows as **Skipped**, and an answer whose activity was
  deleted on its own is marked "no longer logged". A chart of the score, or else of the first
  question saved as a metric, links to that metric's page.
- **An activity's page** lists the check-ins tied to it and has **Add check-in**: pick a form, and it
  opens tied to the activity.
- **`/check-ins/new`** and **`/check-ins/<form id>/edit`**: the editor. Questions are added,
  removed and moved up and down, each with its prompt, answer type and settings, **Required**, a
  **Preset answer** (any type but several choices), and **Save the answer as**: nothing, a metric
  (its name), or an activity (offered for number, scale and yes/no: the type, the fixed fields of
  that type, and the number field that takes the answer). Once every required question has a preset,
  a line says the form is a routine. **Add medication or supplement** asks for the name, the dose and
  its unit, and whether to log it as an activity (a `medication` or `supplement` activity on the
  Timeline, with `substance` and `dose_unit` fixed and the dose in `dose`) or as a metric (the dose
  per day can be charted; the name is made from the substance and unit, e.g. `ibuprofen_mg`), and
  adds a number question preset to the dose. A question's key is made from its prompt when the form
  is first saved and is never shown. **Add up answers into a score** picks
  the questions, the factor and the score's metric. **Ask for it on a schedule** sets the times
  (five-minute steps), the days, optional start and end dates, when the day starts and whether to be
  notified. A change that starts a new version says so before saving. **Delete form** deletes it,
  with **Undo** on the Check-ins page.
- **Home** shows a **Due today** card while a live form has a schedule and Check-ins is not hidden
  from the menu: the slots still due or coming up today, each with **Fill in**.

The due notification's switches are in Settings → Notifications, under Reminders as **Check-ins**.

## Model

In the user's database: `check_in_forms` (the current definition, schedule, `schedule_not_before`,
`notify`, `archived`, `deleted_at`), `check_in_form_versions` (`form_id`, `version`, `questions`,
`score`; every version, the current one included), and `check_ins` (`form_id`, `form_version`,
`status` (`answered` or `skipped`), `answered_at`, `scheduled_for`, `answers` keyed by question
key, `logged`, `activity_ids`, `entity_type`, `entity_id`, `note`, `deleted_at`).

## API

| Route                                | MCP tool                  | What it does                                                                                                                                     |
| ------------------------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /check-in-forms`                | `list_check_in_forms`     | The forms; `deleted=true` for the deleted ones                                                                                                   |
| `POST /check-in-forms`               | `add_check_in_form`       | Create one from `name` and `questions`, or from a `template`                                                                                     |
| `GET /check-in-forms/{id}`           | `get_check_in_form`       | One form, deleted or not                                                                                                                         |
| `PATCH /check-in-forms/{id}`         | `update_check_in_form`    | Change fields; `questions` replaces them all; `description`, `schedule` and `score` take null                                                    |
| `DELETE /check-in-forms/{id}`        | `delete_check_in_form`    | Soft-delete it                                                                                                                                   |
| `GET /check-in-forms/{id}/adherence` | `get_check_in_adherence`  | Slots done, skipped, missed and upcoming per day, and how often each question was answered                                                       |
| `POST /check-in-forms/{id}/restore`  | `restore_check_in_form`   | Restore a deleted one                                                                                                                            |
| `GET /check-in-templates`            | `list_check_in_templates` | The built-in templates                                                                                                                           |
| `GET /check-ins`                     | `query_check_ins`         | Newest first; `from`, `to`, `form_id`, `entity_type` + `entity_id`, `limit` (default 50), `cursor`, `deleted`                                    |
| `POST /check-ins`                    | `submit_check_in`         | `{ form_id, answers, answered_at?, scheduled_for?, note?, use_defaults?, status?, entity_type?, entity_id? }` against the form's current version |
| `PATCH /check-ins/{id}`              | `update_check_in`         | Change `answers`, `answered_at`, `scheduled_for` or `note`                                                                                       |
| `DELETE /check-ins/{id}`             | `delete_check_in`         | Soft-delete it, remove its points and soft-delete its activities                                                                                 |
| `POST /check-ins/{id}/restore`       | `restore_check_in`        | Restore it, write its points again and restore its activities                                                                                    |
| `GET /due`                           | `list_due`                | The day's slots with their state                                                                                                                 |

A check-in in an answer carries its form's name and the questions of the version it answered, so a
client can show the history without a second call. Answers are refused with a 400 when a required
question is unanswered, a key is not in the form, a number is out of range, or a choice key does not
exist.
