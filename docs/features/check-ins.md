# Check-ins

A check-in form is a short questionnaire you build yourself — "Morning check-in", "How rested am
I", a weekly well-being scale — and fill in from the web, the app or MCP. Each numeric answer can be
logged as a **metric**, so it shows up in charts, dashboards, goals and Analyze like any other
metric. A form can have a **schedule**: it is then asked for with a notification when a slot is
due, and stays quiet once that slot is done.

This page covers forms, answers logged to metrics, scores, schedules and the due notification.

## Forms

A form has a `name`, an optional `description`, its `questions` (1 to 40, in the order asked), an
optional `score`, an optional `schedule`, `notify` (default on) and `archived`.

Each question has a stable `key` (lowercase letters, digits and underscores, starting with a
letter, at most 40 characters, unique in the form), a `prompt` (1 to 300 characters), `required`
(default false), an optional `logs_to`, and a `type` with its settings:

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

Changing a question's prompt, type, settings, options, `logs_to` or required flag, adding or
removing a question, or changing the score makes a new **version** of the form, and the old
definition is kept in `check_in_form_versions`. A check-in is always read against the version it
answered, so an old answer keeps its meaning after the form changes. Renaming the form, changing
its description, reordering the questions, or changing its schedule or `notify` keeps the version.

### Templates

`GET /check-in-templates` (MCP `list_check_in_templates`) lists built-in forms to copy with
`POST /check-in-forms { "template": "<id>" }`; any other field given overrides the template's own.
Each template records its source and licence.

| ID            | Form             | What it asks                                                                      |
| ------------- | ---------------- | --------------------------------------------------------------------------------- |
| `morning`     | Morning check-in | How rested you feel, 1 to 5, logged to `rested`                                   |
| `mood_energy` | Mood and energy  | Mood and energy, 1 to 5 each, logged to `mood` and `energy`, and an optional note |

Only instruments whose licence allows use on a paid service are built in. A published questionnaire
that is not (the WHO-5 Well-Being Index, which WHO publishes under a non-commercial licence) can
still be entered as one's own form: `choice` questions with a `value` per option and a `score`.

Aurboda records answers and scores only: it gives no clinical interpretation or cut-offs.

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

An answer that could not be logged (a custom metric's range, say) is reported in the response's
`log_errors` and left out of `logged`.

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
- `missed` once its day is over without a check-in.

`GET /due?date=YYYY-MM-DD` (MCP `list_due`) lists the slots of every scheduled form on that day,
or without `date` on each form's current day. An archived or deleted form has no slots.

### Due notification

The [reminder](reminders.md) scheduler's five-minute job also raises, for each slot of a form with
`notify` on, a [notification](notifications.md) of type `check_in_due` (group **Reminders**,
labelled **Check-ins**) titled with the form's name and linking to `/check-ins/<form id>`. Its
`data` carries `form_id` and `scheduled_for`, and its dedupe key is
`check_in:<form id>:<slot day>:<HH:MM>`, so each slot is raised once. The reminder rules apply:

- nothing is raised for a slot more than an hour overdue, or one already done,
- a form created, given a new schedule, switched back to `notify`, unarchived or restored starts
  with its next slot.

Submitting or editing a check-in marks the notifications of the slots it did read. One user's
failure in this step is logged and never stops the reminders or the other users.

## Deleting

Forms and check-ins are soft-deleted and can be restored for 30 days; the daily prune pass then
removes them for good. A deleted form asks for nothing, and its check-ins stay readable in the
history with its name until the form is purged, which takes its check-ins with it (the metric
points of those still live stay). Deleting a check-in removes the metric points it logged;
restoring it writes them back. `deleted=true` on the lists shows what can be restored.

## Model

In the user's database: `check_in_forms` (the current definition, schedule, `schedule_not_before`,
`notify`, `archived`, `deleted_at`), `check_in_form_versions` (`form_id`, `version`, `questions`,
`score`; every version, the current one included), and `check_ins` (`form_id`, `form_version`,
`status`, `answered_at`, `scheduled_for`, `answers` keyed by question key, `logged`, `note`,
`deleted_at`). `status` is always `answered` for now.

## API

| Route                               | MCP tool                  | What it does                                                                                   |
| ----------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------- |
| `GET /check-in-forms`               | `list_check_in_forms`     | The forms; `deleted=true` for the deleted ones                                                 |
| `POST /check-in-forms`              | `add_check_in_form`       | Create one from `name` and `questions`, or from a `template`                                   |
| `GET /check-in-forms/{id}`          | `get_check_in_form`       | One form, deleted or not                                                                       |
| `PATCH /check-in-forms/{id}`        | `update_check_in_form`    | Change fields; `questions` replaces them all; `description`, `schedule` and `score` take null  |
| `DELETE /check-in-forms/{id}`       | `delete_check_in_form`    | Soft-delete it                                                                                 |
| `POST /check-in-forms/{id}/restore` | `restore_check_in_form`   | Restore a deleted one                                                                          |
| `GET /check-in-templates`           | `list_check_in_templates` | The built-in templates                                                                         |
| `GET /check-ins`                    | `query_check_ins`         | Newest first; `from`, `to`, `form_id`, `limit` (default 50), `cursor`, `deleted`               |
| `POST /check-ins`                   | `submit_check_in`         | `{ form_id, answers, answered_at?, scheduled_for?, note? }` against the form's current version |
| `PATCH /check-ins/{id}`             | `update_check_in`         | Change `answers`, `answered_at`, `scheduled_for` or `note`                                     |
| `DELETE /check-ins/{id}`            | `delete_check_in`         | Soft-delete it and remove its points                                                           |
| `POST /check-ins/{id}/restore`      | `restore_check_in`        | Restore it and write its points again                                                          |
| `GET /due`                          | `list_due`                | The day's slots with their state                                                               |

A check-in in an answer carries its form's name and the questions of the version it answered, so a
client can show the history without a second call. Answers are refused with a 400 when a required
question is unanswered, a key is not in the form, a number is out of range, or a choice key does not
exist.
